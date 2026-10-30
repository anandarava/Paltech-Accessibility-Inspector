/**
 * Screen reader simulator: turns an accessibility tree into the lines a screen
 * reader would announce, in reading order (see SCREEN_READER_PLAN.md).
 *
 * The tree comes from Chrome itself (Accessibility.getFullAXTree through the
 * debugger, `source: "tree"`) or, when the debugger is not available, from the
 * page's HTML (`source: "html"`). Both are reduced to SrNode first, so the
 * wording, the problem markers and the links to scan findings are the same.
 *
 * Wording is neutral and close to NVDA with Chrome: role, states, "name",
 * value, position, description. It is a guide to what assistive technology is
 * told, not a word-for-word copy of any one screen reader.
 */

/** One node of an accessibility tree. */
export interface SrNode {
  id: string;
  /** Chrome role ("button", "heading", "StaticText", "RootWebArea", ...). */
  role: string;
  name: string;
  description?: string;
  value?: string;
  /** Not exposed to assistive technology (hidden, presentational); its children may still be. */
  ignored: boolean;
  /** Flattened Chrome AX properties: checked, expanded, level, required, invalid, ... */
  props: Record<string, string | number | boolean>;
  children: string[];
  /** Known for trees built from the HTML: the element is displayed inline. */
  inline?: boolean;
  /** Chrome's DOM node id (debugger tree), used to show the element on the page. */
  backendNodeId?: number;
}

export type LineKind = "landmark" | "heading" | "link" | "control" | "image" | "structure" | "text";

export interface LineProblem {
  code: "no-name" | "nested-control";
  message: string;
}

/** A scan finding shown next to the line for its element. */
export interface LineIssue {
  id: string;
  ruleId: string;
  title: string;
}

export interface TranscriptLine {
  index: number;
  kind: LineKind;
  /** Spoken role ("button", "navigation landmark"); empty for text. */
  role: string;
  name: string;
  /** The full announcement. */
  text: string;
  /** Nesting inside landmarks and other containers, for indenting. */
  depth: number;
  /** SrNode id; the HTML tree's content script finds the element by it. */
  nodeId: string;
  backendNodeId?: number;
  problems: LineProblem[];
  issues: LineIssue[];
}

export interface Transcript {
  source: "tree" | "html";
  url: string;
  title: string;
  createdAt: string;
  lines: TranscriptLine[];
  /** The page was larger than the node limit; the end is missing. */
  truncated: boolean;
}

/** A tree built from the page's HTML by the content script (the fallback). */
export interface PageTree {
  nodes: SrNode[];
  rootId: string;
  /** Node id of the element each requested selector matched. */
  matches: Record<string, string>;
  truncated: boolean;
}

/** A finding to attach, already resolved to the tree node of its element. */
export interface IssueLink {
  nodeId: string;
  issue: LineIssue;
}

const LANDMARKS: Record<string, string> = {
  banner: "banner landmark",
  navigation: "navigation landmark",
  main: "main landmark",
  contentinfo: "content information landmark",
  complementary: "complementary landmark",
  search: "search landmark",
  // Only announced when named, as screen readers do.
  region: "region",
  form: "form landmark",
};
const NAMED_ONLY_LANDMARKS = new Set(["region", "form"]);

/** Controls read as one item; their content is the name, not separate lines. */
const CONTROLS: Record<string, string> = {
  button: "button",
  link: "link",
  checkbox: "check box",
  radio: "radio button",
  switch: "switch",
  textbox: "edit",
  searchbox: "search edit",
  combobox: "combo box",
  slider: "slider",
  spinbutton: "spin button",
  tab: "tab",
  menuitem: "menu item",
  menuitemcheckbox: "menu item check box",
  menuitemradio: "menu item radio button",
  option: "option",
  treeitem: "tree view item",
  progressbar: "progress bar",
  meter: "meter",
};

/** Containers announced on entry; their content follows as separate lines. */
const STRUCTURES: Record<string, string> = {
  list: "list",
  table: "table",
  grid: "grid",
  treegrid: "tree grid",
  group: "grouping",
  radiogroup: "grouping",
  dialog: "dialog",
  alertdialog: "alert dialog",
  alert: "alert",
  figure: "figure",
  article: "article",
  tablist: "tab control",
  menu: "menu",
  menubar: "menu bar",
  listbox: "list box",
  tree: "tree view",
  toolbar: "tool bar",
  iframe: "frame",
  math: "math",
};
/** Containers only worth a line when they have a name. */
const NAMED_ONLY_STRUCTURES = new Set(["group", "radiogroup", "figure", "article", "toolbar"]);

/** Roles a person can operate; used for the no-name and nested-control checks. */
const INTERACTIVE = new Set([...Object.keys(CONTROLS).filter((r) => r !== "progressbar" && r !== "meter"), "listbox"]);

/** Roles that must have a name to be usable (WCAG 4.1.2, 1.1.1). */
const NEEDS_NAME = new Set([...INTERACTIVE, "image", "dialog", "alertdialog", "iframe"]);

/** Interactive descendants that are part of the control itself, not a second control. */
const ALLOWED_INSIDE: Record<string, Set<string>> = {
  combobox: new Set(["textbox", "searchbox", "listbox", "option", "menulistpopup", "menulistoption"]),
  treeitem: new Set(["treeitem"]),
  listbox: new Set(["option"]),
};

/** Text-level elements: inside them, plain wrappers do not start a new line. */
const TEXT_BLOCKS = new Set([
  "paragraph",
  "listitem",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "caption",
  "labeltext",
  "legend",
  "term",
  "definition",
  "figcaption",
  "blockquote",
  "heading",
]);

/** Never announced and never walked into. */
const SKIPPED = new Set(["listmarker", "inlinetextbox", "separator", "menulistpopup"]);

/** Chrome and the HTML tree name a few roles differently; compare on these keys. */
export function normalizeRole(role: string): string {
  const r = role.toLowerCase();
  if (r === "img" || r === "graphics-document" || r === "svgroot") return "image";
  if (r === "popupbutton") return "combobox";
  if (r === "presentation") return "none";
  return r;
}

function isTrue(v: string | number | boolean | undefined): boolean {
  return v === true || v === "true";
}

function isFalse(v: string | number | boolean | undefined): boolean {
  return v === false || v === "false";
}

/** States in the order a screen reader says them. */
export function statesOf(node: SrNode, role: string): string[] {
  const p = node.props;
  const states: string[] = [];
  if (role === "checkbox" || role === "radio" || role === "switch" || role === "menuitemcheckbox" || role === "menuitemradio") {
    if (p.checked === "mixed") states.push("half checked");
    else if (isTrue(p.checked)) states.push("checked");
    else states.push("not checked");
  }
  if (p.pressed !== undefined) {
    if (p.pressed === "mixed") states.push("half pressed");
    else if (isTrue(p.pressed)) states.push("pressed");
    else if (isFalse(p.pressed)) states.push("not pressed");
  }
  if (p.expanded !== undefined) {
    if (isTrue(p.expanded)) states.push("expanded");
    else if (isFalse(p.expanded)) states.push("collapsed");
  }
  if (isTrue(p.selected) && (role === "option" || role === "tab" || role === "treeitem" || role === "gridcell")) states.push("selected");
  if (typeof p.hasPopup === "string" && p.hasPopup !== "false" && role !== "combobox") {
    states.push(p.hasPopup === "menu" || p.hasPopup === "true" ? "submenu" : "has pop-up");
  }
  if (isTrue(p.multiselectable)) states.push("multi-select");
  if (isTrue(p.disabled)) states.push("unavailable");
  if (isTrue(p.readonly) && (role === "textbox" || role === "searchbox" || role === "combobox" || role === "spinbutton")) states.push("read only");
  if (isTrue(p.required)) states.push("required");
  if (p.invalid !== undefined && !isFalse(p.invalid) && p.invalid !== "") states.push("invalid entry");
  return states;
}

function quote(s: string): string {
  return `"${s}"`;
}

function compact(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

interface BuildContext {
  byId: Map<string, SrNode>;
  parent: Map<string, string>;
  lines: TranscriptLine[];
  /** Text waiting to become one line. */
  text: { parts: string[]; nodeId: string; backendNodeId?: number; depth: number } | null;
  /** Line index per node id that produced a line. */
  lineOf: Map<string, number>;
}

function roleOf(ctx: BuildContext, id: string): string {
  const n = ctx.byId.get(id);
  return n ? normalizeRole(n.role) : "";
}

function children(ctx: BuildContext, node: SrNode): SrNode[] {
  return node.children.map((c) => ctx.byId.get(c)).filter((c): c is SrNode => c !== undefined);
}

/** Exposed descendants with role `role`, through wrappers, not entering nested `stop` containers. */
function countRole(ctx: BuildContext, node: SrNode, role: string, stop: Set<string>): number {
  let n = 0;
  for (const c of children(ctx, node)) {
    const r = normalizeRole(c.role);
    if (!c.ignored && r === role) n++;
    else if (c.ignored || !stop.has(r)) n += countRole(ctx, c, role, stop);
  }
  return n;
}

function tableSize(ctx: BuildContext, table: SrNode): { rows: number; columns: number } {
  let rows = 0;
  let columns = 0;
  const cells = new Set(["cell", "gridcell", "columnheader", "rowheader"]);
  const visit = (node: SrNode): void => {
    for (const c of children(ctx, node)) {
      const r = normalizeRole(c.role);
      if (r === "table" || r === "grid" || r === "treegrid") continue;
      if (r === "row" && !c.ignored) {
        rows++;
        columns = Math.max(columns, children(ctx, c).filter((cell) => cells.has(normalizeRole(cell.role))).length);
      } else visit(c);
    }
  };
  visit(table);
  return { rows, columns };
}

const SET_CONTAINERS: Record<string, Set<string>> = {
  radio: new Set(["radiogroup", "group"]),
  tab: new Set(["tablist"]),
  option: new Set(["listbox"]),
  menuitem: new Set(["menu", "menubar"]),
  menuitemcheckbox: new Set(["menu", "menubar"]),
  menuitemradio: new Set(["menu", "menubar"]),
  treeitem: new Set(["tree", "group"]),
};

/** "1 of 2" among the same role in the nearest set container; nested copies (a radio inside a radio) are not counted. */
function positionOf(ctx: BuildContext, node: SrNode, role: string): string {
  const containers = SET_CONTAINERS[role];
  if (!containers) return "";
  let containerId: string | undefined = ctx.parent.get(node.id);
  while (containerId && !containers.has(roleOf(ctx, containerId))) {
    if (roleOf(ctx, containerId) === role) return ""; // inside another item of the same role
    containerId = ctx.parent.get(containerId);
  }
  const container = containerId ? ctx.byId.get(containerId) : undefined;
  if (!container) return "";
  const items: string[] = [];
  const visit = (n: SrNode): void => {
    for (const c of children(ctx, n)) {
      const r = normalizeRole(c.role);
      if (!c.ignored && r === role) items.push(c.id);
      else if (!containers.has(r)) visit(c);
    }
  };
  visit(container);
  const at = items.indexOf(node.id);
  return at >= 0 && items.length > 1 ? `${at + 1} of ${items.length}` : "";
}

/** Interactive descendants of a control that are separate controls. */
function nestedControls(ctx: BuildContext, node: SrNode, role: string): SrNode[] {
  const allowed = ALLOWED_INSIDE[role];
  const found: SrNode[] = [];
  const visit = (n: SrNode): void => {
    for (const c of children(ctx, n)) {
      const r = normalizeRole(c.role);
      if (!c.ignored && INTERACTIVE.has(r) && !allowed?.has(r)) {
        found.push(c);
        continue; // its own descendants are checked on its own line
      }
      visit(c);
    }
  };
  visit(node);
  return found;
}

function flushText(ctx: BuildContext): void {
  const t = ctx.text;
  ctx.text = null;
  if (!t) return;
  const text = compact(t.parts.join(" "));
  if (!text) return;
  ctx.lines.push({
    index: ctx.lines.length,
    kind: "text",
    role: "",
    name: text,
    text,
    depth: t.depth,
    nodeId: t.nodeId,
    backendNodeId: t.backendNodeId,
    problems: [],
    issues: [],
  });
}

function addLine(ctx: BuildContext, node: SrNode, kind: LineKind, role: string, text: string, depth: number, problems: LineProblem[] = []): TranscriptLine {
  flushText(ctx);
  const line: TranscriptLine = {
    index: ctx.lines.length,
    kind,
    role,
    name: compact(node.name),
    text,
    depth,
    nodeId: node.id,
    backendNodeId: node.backendNodeId,
    problems,
    issues: [],
  };
  ctx.lines.push(line);
  ctx.lineOf.set(node.id, line.index);
  return line;
}

/** The announcement for a control, image or heading. */
export function announce(node: SrNode, role: string, position = ""): string {
  const spoken = role === "heading" ? "heading" : role === "image" ? "graphic" : CONTROLS[role] ?? role;
  const parts = [spoken];
  if (role === "heading") {
    const level = Number(node.props.level);
    if (level > 0) parts.push(`level ${level}`);
  }
  parts.push(...statesOf(node, role));
  const name = compact(node.name);
  if (name) parts.push(quote(name));
  const value = compact(node.value);
  if (value && value !== name && role !== "link" && role !== "button") parts.push(value);
  if (position) parts.push(position);
  const description = compact(node.description);
  if (description && description !== name) parts.push(quote(description));
  return parts.join(", ");
}

function noNameProblem(role: string): LineProblem {
  const spoken = role === "image" ? "graphic" : CONTROLS[role] ?? STRUCTURES[role] ?? role;
  return { code: "no-name", message: `No name: a screen reader says only "${spoken}".` };
}

function controlLine(ctx: BuildContext, node: SrNode, role: string, depth: number): void {
  const problems: LineProblem[] = [];
  if (NEEDS_NAME.has(role) && !compact(node.name)) problems.push(noNameProblem(role));
  const nested = INTERACTIVE.has(role) ? nestedControls(ctx, node, role) : [];
  if (nested.length) {
    const what = nested.map((c) => CONTROLS[normalizeRole(c.role)] ?? normalizeRole(c.role));
    problems.push({
      code: "nested-control",
      message: `Contains another control (${[...new Set(what)].join(", ")}). A screen reader may announce both, or skip the inner one.`,
    });
  }
  const kind: LineKind = role === "link" ? "link" : role === "image" ? "image" : "control";
  addLine(ctx, node, kind, CONTROLS[role] ?? (role === "image" ? "graphic" : role), announce(node, role, positionOf(ctx, node, role)), depth, problems);
  // A second control inside this one is a separate stop: list it, indented under it.
  for (const c of nested) controlLine(ctx, c, normalizeRole(c.role), depth + 1);
}

function structureLine(ctx: BuildContext, node: SrNode, role: string, depth: number): boolean {
  const name = compact(node.name);
  if (NAMED_ONLY_STRUCTURES.has(role) && !name) return false;
  const parts = [STRUCTURES[role]];
  if (role === "list") {
    const n = countRole(ctx, node, "listitem", new Set(["list"]));
    parts.push(`${n} ${n === 1 ? "item" : "items"}`);
  } else if (role === "table" || role === "grid" || role === "treegrid") {
    const { rows, columns } = tableSize(ctx, node);
    parts.push(`${rows} ${rows === 1 ? "row" : "rows"}`, `${columns} ${columns === 1 ? "column" : "columns"}`);
  } else if (role === "listbox") {
    parts.push(...statesOf(node, role));
  }
  if (name) parts.push(quote(name));
  const problems = NEEDS_NAME.has(role) && !name ? [noNameProblem(role)] : [];
  const kind: LineKind = role === "listbox" ? "control" : "structure";
  addLine(ctx, node, kind, STRUCTURES[role], parts.join(", "), depth, problems);
  return true;
}

function walk(ctx: BuildContext, node: SrNode, depth: number, inTextBlock: boolean): void {
  const role = normalizeRole(node.role);
  if (SKIPPED.has(role)) return;
  if (node.ignored || role === "none") {
    for (const c of children(ctx, node)) walk(ctx, c, depth, inTextBlock);
    return;
  }
  if (role === "statictext") {
    const text = compact(node.name);
    if (!text) return;
    if (!ctx.text) ctx.text = { parts: [], nodeId: node.id, backendNodeId: node.backendNodeId, depth };
    ctx.text.parts.push(text);
    return;
  }
  if (role === "linebreak") {
    flushText(ctx);
    return;
  }
  if (LANDMARKS[role] && !(NAMED_ONLY_LANDMARKS.has(role) && !compact(node.name))) {
    const name = compact(node.name);
    addLine(ctx, node, "landmark", LANDMARKS[role], name ? `${LANDMARKS[role]}, ${quote(name)}` : LANDMARKS[role], depth);
    for (const c of children(ctx, node)) walk(ctx, c, depth + 1, false);
    flushText(ctx);
    return;
  }
  if (role === "heading") {
    addLine(ctx, node, "heading", "heading", announce(node, role), depth);
    return;
  }
  if (CONTROLS[role] || role === "image") {
    controlLine(ctx, node, role, depth);
    return;
  }
  if (STRUCTURES[role]) {
    const announced = structureLine(ctx, node, role, depth);
    const inner = announced ? depth + 1 : depth;
    for (const c of children(ctx, node)) walk(ctx, c, inner, false);
    flushText(ctx);
    return;
  }
  // Plain containers: a text block, or a wrapper that starts a new line unless it sits inside text.
  const block = TEXT_BLOCKS.has(role) || (node.inline === undefined ? !inTextBlock : !node.inline);
  if (block) flushText(ctx);
  for (const c of children(ctx, node)) walk(ctx, c, depth, inTextBlock || TEXT_BLOCKS.has(role));
  if (block) flushText(ctx);
}

/** Attach each finding to its element's line, or to the closest line of an ancestor. */
function attachIssues(ctx: BuildContext, links: IssueLink[]): void {
  for (const link of links) {
    let id: string | undefined = link.nodeId;
    while (id !== undefined && !ctx.lineOf.has(id)) id = ctx.parent.get(id);
    if (id === undefined) continue;
    const line = ctx.lines[ctx.lineOf.get(id) as number];
    if (!line.issues.some((i) => i.id === link.issue.id)) line.issues.push(link.issue);
  }
}

export interface BuildOptions {
  source: Transcript["source"];
  url: string;
  title: string;
  links?: IssueLink[];
  truncated?: boolean;
  now?: Date;
}

/** Build the transcript of the tree rooted at `rootId`. */
export function buildTranscript(nodes: SrNode[], rootId: string, options: BuildOptions): Transcript {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map<string, string>();
  for (const n of nodes) for (const c of n.children) parent.set(c, n.id);
  const ctx: BuildContext = { byId, parent, lines: [], text: null, lineOf: new Map() };
  const root = byId.get(rootId);
  if (root) walk(ctx, root, 0, false);
  flushText(ctx);
  attachIssues(ctx, options.links ?? []);
  return {
    source: options.source,
    url: options.url,
    title: options.title,
    createdAt: (options.now ?? new Date()).toISOString(),
    lines: ctx.lines,
    truncated: options.truncated ?? false,
  };
}

/** Views of the transcript, matching the lists screen readers offer. */
export type TranscriptView = "all" | "headings" | "landmarks" | "links" | "forms";

const FORM_ROLES = new Set(["button", "check box", "radio button", "switch", "edit", "search edit", "combo box", "slider", "spin button", "list box"]);

export function lineInView(line: TranscriptLine, view: TranscriptView): boolean {
  switch (view) {
    case "all":
      return true;
    case "headings":
      return line.kind === "heading";
    case "landmarks":
      return line.kind === "landmark";
    case "links":
      return line.kind === "link";
    case "forms":
      return line.kind === "control" && FORM_ROLES.has(line.role);
  }
}

export function lineHasProblem(line: TranscriptLine): boolean {
  return line.problems.length > 0 || line.issues.length > 0;
}

/** Plain-text transcript for copying into a bug ticket. */
export function transcriptText(t: Transcript, lines: TranscriptLine[] = t.lines): string {
  const head = [`Screen reader transcript: ${t.title || t.url}`, t.url, `Built ${t.createdAt} from ${t.source === "tree" ? "Chrome's accessibility tree" : "the page's HTML (approximate)"}`, ""];
  const body = lines.map((l) => {
    const notes = [...l.problems.map((p) => p.message), ...l.issues.map((i) => `${i.ruleId}: ${i.title}`)];
    return `${"  ".repeat(Math.min(l.depth, 6))}${l.index + 1}. ${l.text}${notes.length ? `  [${notes.join(" | ")}]` : ""}`;
  });
  return [...head, ...body].join("\n");
}
