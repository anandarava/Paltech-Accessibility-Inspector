import { describe, expect, it } from "vitest";
import { elementKind, groupByCause, issueCause } from "@shared/cause";
import { makeIssue } from "./support/factories";

describe("issueCause", () => {
  it("groups text contrast by colour pair", () => {
    const a = makeIssue({ ruleId: "CLR-01", data: { foreground: "#3677a9", background: "#1e2933", ratio: 3.9 } });
    const b = makeIssue({ ruleId: "CLR-01", data: { foreground: "#3677a9", background: "#1e2933", ratio: 3.9 } });
    const c = makeIssue({ ruleId: "CLR-01", data: { foreground: "#0d870d", background: "#1e2933", ratio: 3.1 } });
    expect(issueCause(a).key).toBe(issueCause(b).key);
    expect(issueCause(a).key).not.toBe(issueCause(c).key);
    expect(issueCause(a).label).toBe("Text #3677a9 on #1e2933 · 3.9:1");
  });

  it("groups obscured focus by the covering element", () => {
    const a = makeIssue({ ruleId: "KBD-06", data: { obscuredBy: "<div#onetrust-banner-sdk>" } });
    expect(issueCause(a).label).toBe("Covered by <div#onetrust-banner-sdk>");
  });

  it("groups duplicate ids by id", () => {
    expect(issueCause(makeIssue({ ruleId: "STR-08", data: { id: "nav" } })).label).toBe('id "nav"');
  });

  it("falls back to the kind of element and the message without per-element values", () => {
    const row = (id: string) =>
      makeIssue({
        ruleId: "ARIA-03",
        element: { html: `<a class="s-link js-row q-${id}" id="q-${id}">x</a>` },
        data: { checks: [{ message: `ARIA attribute element ID does not exist on the page: aria-describedby="q-${id}"` }] },
      });
    expect(issueCause(row("1")).key).toBe(issueCause(row("2")).key);
    expect(issueCause(row("1")).label).toBe("Same element <a.s-link.js-row>");
  });

  it("keeps different rules apart", () => {
    const a = makeIssue({ ruleId: "CLR-01", data: { foreground: "#777777", background: "#ffffff" } });
    const b = makeIssue({ ruleId: "CLR-02", data: { foreground: "#777777", background: "#ffffff" } });
    expect(issueCause(a).key).not.toBe(issueCause(b).key);
  });
});

describe("elementKind", () => {
  it("keeps the tag and stable classes, drops generated ones", () => {
    expect(elementKind('<li class="item item-42 active" id="x">')).toBe("<li.item.active>");
    expect(elementKind("plain text")).toBe("");
  });
});

describe("groupByCause", () => {
  it("keeps every item, grouped in order of first appearance", () => {
    const issues = ["#111111", "#222222", "#111111"].map((fg) => makeIssue({ ruleId: "CLR-01", data: { foreground: fg, background: "#ffffff" } }));
    const groups = groupByCause(issues, issueCause);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(3);
  });
});
