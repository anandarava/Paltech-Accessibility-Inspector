/**
 * Screen reader view, service-worker side (see SCREEN_READER_PLAN.md).
 *
 * Reads Chrome's accessibility tree through the shared debugger connection and
 * turns it into a transcript (shared/announce.ts). When the debugger cannot
 * attach (Chrome pages, the tester closed the debugging bar, another tool holds
 * the tab), the content script builds an approximate tree from the HTML instead.
 *
 * The connection stays attached while the view is open, so clicking a line can
 * resolve the element by Chrome's node id; closeScreenReader() gives it up.
 */
import type { Issue } from "@shared/types";
import { EXT_MARKER_ATTR, OVERLAY_HOST_ID } from "@shared/constants";
import { buildTranscript, type IssueLink, type LineIssue, type PageTree, type SrNode, type Transcript } from "@shared/announce";
import { acquireDebugger, onDebuggerDetached, releaseDebugger, sendDebuggerCommand } from "./debugger-session";

/** Tabs whose screen reader view holds the debugger connection. */
const readerTabs = new Set<number>();

onDebuggerDetached((tabId) => {
  readerTabs.delete(tabId);
});

/** Attribute the debugger puts on a line's element so the content script can find and outline it. */
export const SR_TARGET_ATTR = "data-pt-sr-target";

/** Most findings to look up on the page; each costs two debugger round trips. */
const MAX_LINKED_SELECTORS = 300;

/** Finding categories a screen reader user runs into (contrast, zoom and target size are not). */
const LINKED_CATEGORIES = new Set<Issue["category"]>(["Images and Media", "Forms", "ARIA", "Page Structure and Semantics", "Links, Buttons, and Targets", "Best Practice"]);

/** Open findings of the top frame worth showing next to transcript lines. */
export function linkableIssues(issues: Issue[]): Issue[] {
  return issues.filter(
    (i) =>
      i.status === "new" &&
      (i.frameId ?? 0) === 0 &&
      Boolean(i.element.selector) &&
      !i.ruleId.startsWith("TGT-") &&
      (i.ruleId === "KBD-10" || LINKED_CATEGORIES.has(i.category)),
  );
}

function lineIssue(i: Issue): LineIssue {
  return { id: i.id, ruleId: i.ruleId, title: i.title };
}

/** Pair each finding with the tree node its selector matched. */
function linksFor(issues: Issue[], matches: Record<string, string>): IssueLink[] {
  return issues.flatMap((i) => {
    const nodeId = matches[i.element.selector];
    return nodeId === undefined ? [] : [{ nodeId, issue: lineIssue(i) }];
  });
}

interface CdpValue {
  type: string;
  value?: unknown;
}

interface CdpAxNode {
  nodeId: string;
  ignored: boolean;
  role?: CdpValue;
  name?: CdpValue;
  description?: CdpValue;
  value?: CdpValue;
  properties?: Array<{ name: string; value: CdpValue }>;
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

function text(v: CdpValue | undefined): string {
  return v && (typeof v.value === "string" || typeof v.value === "number") ? String(v.value) : "";
}

export function toSrNode(n: CdpAxNode): SrNode {
  const props: SrNode["props"] = {};
  for (const p of n.properties ?? []) {
    const v = p.value?.value;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") props[p.name] = v;
  }
  return {
    id: n.nodeId,
    role: text(n.role) || "generic",
    name: text(n.name),
    description: text(n.description) || undefined,
    value: text(n.value) || undefined,
    ignored: n.ignored,
    props,
    children: n.childIds ?? [],
    backendNodeId: n.backendDOMNodeId,
  };
}

/** Resolve each selector to the AX node of its element (missing ones are left out). */
async function matchSelectors(tabId: number, selectors: string[], axByBackend: Map<number, string>): Promise<Record<string, string>> {
  const matches: Record<string, string> = {};
  if (!selectors.length) return matches;
  const doc = await sendDebuggerCommand<{ root: { nodeId: number } }>(tabId, "DOM.getDocument", { depth: 0 });
  await Promise.all(
    selectors.slice(0, MAX_LINKED_SELECTORS).map(async (selector) => {
      try {
        const found = await sendDebuggerCommand<{ nodeId: number }>(tabId, "DOM.querySelector", { nodeId: doc.root.nodeId, selector });
        if (!found.nodeId) return;
        const described = await sendDebuggerCommand<{ node: { backendNodeId: number } }>(tabId, "DOM.describeNode", { nodeId: found.nodeId });
        const axId = axByBackend.get(described.node.backendNodeId);
        if (axId !== undefined) matches[selector] = axId;
      } catch {
        // Invalid or stale selector: that finding simply is not linked.
      }
    }),
  );
  return matches;
}

/** AX ids of the extension's own elements (overlay host, marked nodes), which are not part of the page. */
async function extensionNodes(tabId: number, axByBackend: Map<number, string>): Promise<string[]> {
  const doc = await sendDebuggerCommand<{ root: { nodeId: number } }>(tabId, "DOM.getDocument", { depth: 0 });
  const { nodeIds } = await sendDebuggerCommand<{ nodeIds: number[] }>(tabId, "DOM.querySelectorAll", {
    nodeId: doc.root.nodeId,
    selector: `#${OVERLAY_HOST_ID}, [${EXT_MARKER_ATTR}]`,
  });
  const ids = await Promise.all(
    nodeIds.map(async (nodeId) => {
      const described = await sendDebuggerCommand<{ node: { backendNodeId: number } }>(tabId, "DOM.describeNode", { nodeId });
      return axByBackend.get(described.node.backendNodeId);
    }),
  );
  return ids.filter((id): id is string => id !== undefined);
}

/** Chrome's tree, or null when the debugger is not available for this tab. */
async function treeFromDebugger(tabId: number, selectors: string[]): Promise<PageTree | null> {
  if (!readerTabs.has(tabId)) {
    if (!(await acquireDebugger(tabId))) return null;
    readerTabs.add(tabId);
  }
  try {
    await sendDebuggerCommand(tabId, "Accessibility.enable");
    const { nodes } = await sendDebuggerCommand<{ nodes: CdpAxNode[] }>(tabId, "Accessibility.getFullAXTree");
    if (!nodes?.length) throw new Error("Empty accessibility tree.");
    const srNodes = nodes.map(toSrNode);
    const axByBackend = new Map<number, string>();
    for (const n of nodes) if (n.backendDOMNodeId !== undefined) axByBackend.set(n.backendDOMNodeId, n.nodeId);
    const ours = new Set(await extensionNodes(tabId, axByBackend).catch((): string[] => []));
    for (const n of srNodes) {
      if (!ours.has(n.id)) continue;
      n.ignored = true;
      n.children = [];
    }
    const matches = await matchSelectors(tabId, selectors, axByBackend).catch(() => ({}));
    const root = nodes.find((n) => !n.parentId) ?? nodes[0];
    return { nodes: srNodes, rootId: root.nodeId, matches, truncated: false };
  } catch {
    await closeScreenReader(tabId);
    return null;
  }
}

export interface PageInfo {
  url: string;
  title: string;
}

/**
 * The transcript of the page in `tabId`. `fromPage` asks the content script for the
 * HTML tree, used when Chrome's tree cannot be read.
 */
export async function readTranscript(tabId: number, issues: Issue[], page: PageInfo, fromPage: (selectors: string[]) => Promise<PageTree>): Promise<Transcript> {
  const linked = linkableIssues(issues);
  const selectors = [...new Set(linked.map((i) => i.element.selector))];
  const tree = await treeFromDebugger(tabId, selectors);
  if (tree) return buildTranscript(tree.nodes, tree.rootId, { source: "tree", ...page, links: linksFor(linked, tree.matches) });
  const html = await fromPage(selectors);
  return buildTranscript(html.nodes, html.rootId, { source: "html", ...page, links: linksFor(linked, html.matches), truncated: html.truncated });
}

/**
 * Mark the element of a Chrome tree node with SR_TARGET_ATTR (text nodes mark their
 * parent; elements inside shadow roots mark the host, which the overlay can reach).
 */
export async function markTreeNode(tabId: number, backendNodeId: number): Promise<boolean> {
  if (!readerTabs.has(tabId)) return false;
  try {
    const { object } = await sendDebuggerCommand<{ object: { objectId?: string } }>(tabId, "DOM.resolveNode", { backendNodeId });
    if (!object.objectId) return false;
    const res = await sendDebuggerCommand<{ result: { value?: unknown } }>(tabId, "Runtime.callFunctionOn", {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration: `function (attr) {
        let el = this.nodeType === 1 ? this : this.parentElement;
        while (el && el.getRootNode() instanceof ShadowRoot) el = el.getRootNode().host;
        document.querySelectorAll("[" + attr + "]").forEach((e) => e.removeAttribute(attr));
        if (!el) return false;
        el.setAttribute(attr, "");
        return true;
      }`,
      arguments: [{ value: SR_TARGET_ATTR }],
    });
    return res.result.value === true;
  } catch {
    return false;
  }
}

/** Give up the debugger connection held for the view. Never throws. */
export async function closeScreenReader(tabId: number): Promise<void> {
  if (!readerTabs.delete(tabId)) return;
  await releaseDebugger(tabId);
}
