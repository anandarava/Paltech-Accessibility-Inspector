import { describe, expect, it } from "vitest";
import { announce, buildTranscript, lineInView, transcriptText, type SrNode } from "@shared/announce";
import { linkableIssues, toSrNode } from "@src/background/screen-reader";
import { buildPageTree } from "@src/content/screen-reader";
import { makeIssue, setBody } from "./support/factories";

/** A small tree: node(id, role, name, children, extra). */
function node(id: string, role: string, name = "", children: string[] = [], extra: Partial<SrNode> = {}): SrNode {
  return { id, role, name, ignored: false, props: {}, children, ...extra };
}

function transcriptOf(nodes: SrNode[], links = []) {
  return buildTranscript(nodes, nodes[0].id, { source: "tree", url: "https://example.test/", title: "Example", links, now: new Date(0) });
}

describe("announcements", () => {
  it("says role, states, name, value, position and description in that order", () => {
    const field = node("1", "textbox", "Email", [], {
      props: { required: true, invalid: "true" },
      value: "me@",
      description: "Enter a valid email",
    });
    expect(announce(field, "textbox")).toBe('edit, required, invalid entry, "Email", me@, "Enter a valid email"');
  });

  it("gives headings their level", () => {
    expect(announce(node("1", "heading", "Allergies", [], { props: { level: 2 } }), "heading")).toBe('heading, level 2, "Allergies"');
  });

  it("reads check state for radios and checkboxes, and expanded / pressed / unavailable for others", () => {
    expect(announce(node("1", "radio", "Yes", [], { props: { checked: "false" } }), "radio")).toBe('radio button, not checked, "Yes"');
    expect(announce(node("1", "checkbox", "Agree", [], { props: { checked: "mixed" } }), "checkbox")).toBe('check box, half checked, "Agree"');
    expect(announce(node("1", "button", "Menu", [], { props: { expanded: false, hasPopup: "menu" } }), "button")).toBe('button, collapsed, submenu, "Menu"');
    expect(announce(node("1", "button", "Bold", [], { props: { pressed: "true", disabled: true } }), "button")).toBe('button, pressed, unavailable, "Bold"');
  });
});

describe("transcript", () => {
  it("lists landmarks, headings, controls and text in reading order", () => {
    const t = transcriptOf([
      node("r", "RootWebArea", "Example", ["nav", "main"]),
      node("nav", "navigation", "Main", ["home"]),
      node("home", "link", "Home", ["home-text"]),
      node("home-text", "StaticText", "Home"),
      node("main", "main", "", ["h1", "p", "btn"]),
      node("h1", "heading", "Patient intake", ["h1-text"], { props: { level: 1 } }),
      node("h1-text", "StaticText", "Patient intake"),
      node("p", "paragraph", "", ["t1", "t2"]),
      node("t1", "StaticText", "Fill in"),
      node("t2", "StaticText", "every field."),
      node("btn", "button", "Submit"),
    ]);
    expect(t.lines.map((l) => l.text)).toEqual([
      'navigation landmark, "Main"',
      'link, "Home"',
      "main landmark",
      'heading, level 1, "Patient intake"',
      "Fill in every field.",
      'button, "Submit"',
    ]);
    expect(t.lines.map((l) => l.depth)).toEqual([0, 1, 0, 1, 1, 1]);
  });

  it("skips ignored nodes but still reads their exposed children", () => {
    const t = transcriptOf([
      node("r", "RootWebArea", "", ["wrap", "hidden"]),
      node("wrap", "generic", "", ["btn"], { ignored: true }),
      node("btn", "button", "Save"),
      node("hidden", "generic", "", ["secret"], { ignored: true }),
      node("secret", "StaticText", "Hidden text", [], { ignored: true }),
    ]);
    expect(t.lines.map((l) => l.text)).toEqual(['button, "Save"']);
  });

  it("counts list items and table rows and columns", () => {
    const t = transcriptOf([
      node("r", "RootWebArea", "", ["list", "table"]),
      node("list", "list", "", ["li1", "li2"]),
      node("li1", "listitem", "", ["a"]),
      node("a", "StaticText", "One"),
      node("li2", "listitem", "", ["b"]),
      node("b", "StaticText", "Two"),
      node("table", "table", "Prices", ["row1", "row2"]),
      node("row1", "row", "", ["c1", "c2"]),
      node("c1", "columnheader", "Item"),
      node("c2", "columnheader", "Price"),
      node("row2", "row", "", ["c3", "c4"]),
      node("c3", "cell", ""),
      node("c4", "cell", ""),
    ]);
    expect(t.lines[0].text).toBe("list, 2 items");
    expect(t.lines.find((l) => l.role === "table")?.text).toBe('table, 2 rows, 2 columns, "Prices"');
  });

  it("flags controls and images with no name", () => {
    const t = transcriptOf([node("r", "RootWebArea", "", ["btn", "img"]), node("btn", "button", ""), node("img", "image", "")]);
    expect(t.lines.map((l) => l.text)).toEqual(["button", "graphic"]);
    expect(t.lines.every((l) => l.problems.some((p) => p.code === "no-name"))).toBe(true);
  });

  it("flags a control inside another control and lists the inner one under it (the nested hx-radio case)", () => {
    const t = transcriptOf([
      node("r", "RootWebArea", "", ["group"]),
      node("group", "group", "Known allergies", ["outer1", "outer2"]),
      // The inner input is named by the label around it (its empty aria-label is ignored).
      node("outer1", "radio", "Yes (Patient has Known Allergies)", ["inner1"], { props: { checked: "false" } }),
      node("inner1", "radio", "Yes (Patient has Known Allergies)", [], { props: { checked: "false" } }),
      node("outer2", "radio", "No", ["inner2"], { props: { checked: "false" } }),
      node("inner2", "radio", "No", [], { props: { checked: "false" } }),
    ]);
    const texts = t.lines.map((l) => l.text);
    expect(texts).toEqual([
      'grouping, "Known allergies"',
      'radio button, not checked, "Yes (Patient has Known Allergies)", 1 of 2',
      'radio button, not checked, "Yes (Patient has Known Allergies)"',
      'radio button, not checked, "No", 2 of 2',
      'radio button, not checked, "No"',
    ]);
    expect(t.lines[1].problems.map((p) => p.code)).toEqual(["nested-control"]);
    expect(t.lines[2].problems).toEqual([]);
    expect(t.lines[2].depth).toBe(t.lines[1].depth + 1);
  });

  it("does not treat a combo box's own popup and options as nested controls", () => {
    const t = transcriptOf([
      node("r", "RootWebArea", "", ["combo"]),
      node("combo", "combobox", "Country", ["popup"], { value: "India" }),
      node("popup", "MenuListPopup", "", ["opt"]),
      node("opt", "MenuListOption", "India"),
    ]);
    expect(t.lines.map((l) => l.text)).toEqual(['combo box, "Country", India']);
    expect(t.lines[0].problems).toEqual([]);
  });

  it("attaches findings to their element's line, or to the nearest ancestor that has a line", () => {
    const t = transcriptOf(
      [node("r", "RootWebArea", "", ["btn"]), node("btn", "button", "Go", ["icon"]), node("icon", "image", "", [], { ignored: true })],
      [
        { nodeId: "btn", issue: { id: "i1", ruleId: "LNK-02", title: "Button with no name" } },
        { nodeId: "icon", issue: { id: "i2", ruleId: "IMG-01", title: "Missing alt" } },
      ] as never,
    );
    expect(t.lines[0].issues.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("filters lines into the screen reader lists", () => {
    const t = transcriptOf([
      node("r", "RootWebArea", "", ["nav", "h", "link", "field"]),
      node("nav", "navigation", "", []),
      node("h", "heading", "Title", [], { props: { level: 1 } }),
      node("link", "link", "Help"),
      node("field", "textbox", "Name"),
    ]);
    const roles = (view: Parameters<typeof lineInView>[1]) => t.lines.filter((l) => lineInView(l, view)).map((l) => l.role);
    expect(roles("landmarks")).toEqual(["navigation landmark"]);
    expect(roles("headings")).toEqual(["heading"]);
    expect(roles("links")).toEqual(["link"]);
    expect(roles("forms")).toEqual(["edit"]);
  });

  it("copies as plain text with problems and findings after each line", () => {
    const t = transcriptOf([node("r", "RootWebArea", "", ["btn"]), node("btn", "button", "")]);
    expect(transcriptText(t)).toContain('1. button  [No name: a screen reader says only "button".]');
  });
});

describe("Chrome tree nodes", () => {
  it("flattens the debugger's AX node format", () => {
    const n = toSrNode({
      nodeId: "5",
      ignored: false,
      role: { type: "role", value: "checkbox" },
      name: { type: "computedString", value: "Agree" },
      properties: [
        { name: "checked", value: { type: "tristate", value: "true" } },
        { name: "focusable", value: { type: "booleanOrUndefined", value: true } },
      ],
      childIds: ["6"],
      backendDOMNodeId: 42,
    });
    expect(n).toMatchObject({ id: "5", role: "checkbox", name: "Agree", props: { checked: "true", focusable: true }, children: ["6"], backendNodeId: 42 });
  });

  it("links only open top-frame findings a screen reader user meets", () => {
    const keep = makeIssue({ ruleId: "FRM-01", category: "Forms" });
    const nested = makeIssue({ ruleId: "KBD-10", category: "Keyboard and Focus" });
    const contrast = makeIssue({ ruleId: "CLR-01", category: "Color and Contrast" });
    const ignored = makeIssue({ ruleId: "FRM-02", category: "Forms", status: "ignored" });
    const inFrame = makeIssue({ ruleId: "FRM-04", category: "Forms", frameId: 3 });
    expect(linkableIssues([keep, nested, contrast, ignored, inFrame])).toEqual([keep, nested]);
  });
});

describe("tree from the HTML (fallback)", () => {
  function htmlTranscript(selectors: string[] = []) {
    const tree = buildPageTree(selectors);
    return { tree, t: buildTranscript(tree.nodes, tree.rootId, { source: "html", url: "", title: "", now: new Date(0) }) };
  }

  it("reads landmarks, headings, labelled fields and buttons", () => {
    setBody(`
      <nav aria-label="Main"><a href="/">Home</a></nav>
      <main>
        <h1>Patient intake</h1>
        <p>Fill in <em>every</em> field.</p>
        <label for="email">Email</label><input id="email" type="email" required>
        <button type="submit">Submit</button>
      </main>`);
    const texts = htmlTranscript().t.lines.map((l) => l.text);
    expect(texts).toContain('navigation landmark, "Main"');
    expect(texts).toContain('link, "Home"');
    expect(texts).toContain('heading, level 1, "Patient intake"');
    expect(texts).toContain("Fill in every field.");
    expect(texts).toContain('edit, required, "Email"');
    expect(texts).toContain('button, "Submit"');
  });

  it("leaves out hidden content", () => {
    setBody(`<div aria-hidden="true"><button>Hidden</button></div><div style="display:none">Gone</div><button>Shown</button>`);
    expect(htmlTranscript().t.lines.map((l) => l.text)).toEqual(['button, "Shown"']);
  });

  it("finds the nested radio of a custom radio component and resolves finding selectors", () => {
    setBody(`
      <fieldset><legend>Known allergies</legend>
        <div id="yes" role="radio" aria-checked="false" tabindex="0"><label><input type="radio" tabindex="-1" aria-label="" value="Yes"> Yes (Patient has Known Allergies)</label></div>
      </fieldset>`);
    const { tree, t } = htmlTranscript(["#yes", "#missing"]);
    // Two radio buttons for one option: the outer one is flagged, and both are announced.
    const radios = t.lines.filter((l) => l.text === 'radio button, not checked, "Yes (Patient has Known Allergies)"');
    expect(radios).toHaveLength(2);
    expect(radios[0].problems.map((p) => p.code)).toEqual(["nested-control"]);
    expect(Object.keys(tree.matches)).toEqual(["#yes"]);
  });
});
