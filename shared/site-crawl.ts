/**
 * Site scan: types shared by the service worker and the side panel, and the pure
 * helpers that turn links and sitemaps into a list of pages to scan.
 *
 * Page discovery: the site's sitemap (robots.txt `Sitemap:` lines and /sitemap.xml),
 * then the links on each page, starting from the address the tester gives. Only pages
 * of the same origin are kept. Addresses are normalised (no #fragment, no tracking
 * parameters, sorted query) so one page is listed once, and pages that differ only by
 * an id or a slug under the same folder (/product/123, /blog/my-post) are grouped as
 * one template, of which only a few are scanned.
 */

export type SitePageSource = "start" | "sitemap" | "link" | "manual";
export type SitePageStatus = "pending" | "scanning" | "done" | "failed" | "skipped";
export type SiteScanPhase = "idle" | "discovering" | "review" | "scanning" | "paused" | "done" | "stopped";

export interface SiteScanOptions {
  /** Most pages scanned in one run. */
  maxPages: number;
  /** Most link steps away from the start page. */
  maxDepth: number;
  /** Pages scanned per group of similar pages (same template); 0 = no limit. */
  perTemplate: number;
  /** Read robots.txt and sitemap.xml. */
  useSitemap: boolean;
  /** Skip addresses containing any of these (case-insensitive; * matches anything). */
  exclude: string[];
  /** Keep to pages whose path starts with this ("/hrms/"); empty = the whole origin. */
  within?: string;
  /** Leave out the slow checks that act on the page (focus indicators, focus obscured, reflow, text spacing). */
  quick: boolean;
  /**
   * Follow every link. Off (the default): links in the site's navigation (menus, header, footer,
   * sidebars, tabs, breadcrumbs) are followed, and links in the content (product grids, article
   * lists) only add the first page of each kind; the rest are counted on that page (`similar`).
   */
  allLinks?: boolean;
}

/** A link found on a page, and whether it sits in the page's navigation. */
export interface LinkInfo {
  url: string;
  nav: boolean;
}

/**
 * Where a site's navigation lives. A link inside one of these is a way around the site; any
 * other link is content (a product card, an article teaser, a link in a paragraph).
 */
export const NAV_SELECTOR = [
  "nav",
  "header",
  "footer",
  "aside",
  "[role=navigation]",
  "[role=banner]",
  "[role=contentinfo]",
  "[role=complementary]",
  "[role=tablist]",
  "[role=menu]",
  "[role=menubar]",
  "[role=tree]",
  "[aria-label*=breadcrumb i]",
  ".breadcrumb",
  ".breadcrumbs",
].join(",");

export interface SitePage {
  url: string;
  depth: number;
  source: SitePageSource;
  template: string;
  /** Ticked for scanning. */
  include: boolean;
  /** Why it starts unticked (a similar page is already included, or over the page limit). */
  note?: string;
  /** Ticked or unticked by the tester; automatic choices leave it alone. */
  userSet?: boolean;
  /** Content links to more pages like this one that were counted instead of listed. */
  similar?: number;
  status: SitePageStatus;
  error?: string;
  title?: string;
  /** Address after redirects, when different. */
  finalUrl?: string;
  score?: number;
  definite?: number;
  review?: number;
  durationMs?: number;
}

export interface SiteScanState {
  id: string;
  startUrl: string;
  origin: string;
  options: SiteScanOptions;
  phase: SiteScanPhase;
  pages: SitePage[];
  /** Discovery counts, for the summary line. */
  /** `details`: detail pages (an id in the address) and repeat views of a listed screen, left out. */
  found: { sitemap: number; links: number; excluded: number; details?: number };
  /** Status line while discovering or scanning. */
  message?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** Rules the quick mode leaves out: they move focus, resize or restyle the page, and take most of a scan's time. */
export const SLOW_RULE_IDS = ["KBD-05", "KBD-06", "CLR-05", "CLR-09", "ZM-02", "ZM-03"];

export const DEFAULT_EXCLUDES = [
  "logout",
  "log-out",
  "log_out",
  "signout",
  "sign-out",
  "sign_out",
  "logoff",
  "delete",
  "remove",
  "unsubscribe",
  "destroy",
  "deactivate",
  // Links that change the account's settings when opened, not pages
  "switchlang",
  "setlang",
  "changelang",
  "setlanguage",
  "setculture",
  "changeculture",
];

export const DEFAULT_SITE_SCAN_OPTIONS: SiteScanOptions = {
  maxPages: 100,
  maxDepth: 3,
  perTemplate: 1,
  useSitemap: true,
  exclude: DEFAULT_EXCLUDES,
  quick: false,
};

/** Files that are not web pages. */
const FILE_EXT_RE =
  /\.(pdf|zip|gz|tgz|rar|7z|dmg|exe|msi|apk|iso|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp3|wav|ogg|m4a|mp4|m4v|mov|avi|webm|mkv|docx?|xlsx?|pptx?|odt|ods|csv|txt|xml|json|rss|atom|ics|woff2?|ttf|eot|css|js)$/i;

/** Query parameters that only track where a visit came from. */
const TRACKING_PARAM_RE = /^(utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|igshid|yclid|ref_src|spm)$/i;

/** `#/route` or `#!/route`: a page of a hash-routed app, unlike a plain `#section` anchor. */
const HASH_ROUTE_RE = /^#!?\//;

/** The hash route of an address ("#/leave/apply"), or "" when it has none. */
export function hashRoute(url: string): string {
  try {
    const h = new URL(url).hash;
    return HASH_ROUTE_RE.test(h) ? h : "";
  } catch {
    return "";
  }
}

/**
 * Canonical form of a link for de-duplication, or null when it is not a page we can scan:
 * other protocols (mailto:, tel:, javascript:), files, or an unparseable address.
 * A plain #fragment is dropped (same page); a hash route (#/leave, #!/leave) is kept, without a
 * trailing slash, because hash-routed apps (older Angular, Vue, Backbone) put every page there.
 */
export function normalizeUrl(href: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(href.trim(), base) : new URL(href.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (FILE_EXT_RE.test(u.pathname)) return null;
  let route = HASH_ROUTE_RE.test(u.hash) ? u.hash.replace(/\/+$/, "").replace(/\/+(\?)/, "$1") : "";
  // "#/" and "#!/" are the app's root route: the same page as no hash
  if (route === "#" || route === "#!") route = "";
  u.hash = "";
  u.username = "";
  u.password = "";
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM_RE.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  // "/docs/" and "/docs" are one page on almost every site
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString() + route;
}

/**
 * Folder an application lives in, from its start address: the first path segment when the
 * address is at least two levels deep (https://apps.example.com/hrms/dashboard -> "/hrms/").
 * Shallower addresses (a site's home page, /about) give "" (the whole site).
 */
export function defaultWithin(startUrl: string): string {
  try {
    const segs = new URL(startUrl).pathname.split("/").filter(Boolean);
    return segs.length >= 2 ? `/${segs[0]}/` : "";
  } catch {
    return "";
  }
}

/** True when the page is inside the `within` folder (always true when it is empty). */
export function isWithin(url: string, within: string | undefined): boolean {
  if (!within) return true;
  try {
    const path = new URL(url).pathname;
    const folder = within.endsWith("/") ? within : `${within}/`;
    return path === folder.slice(0, -1) || path.startsWith(folder);
  } catch {
    return false;
  }
}

export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** True when the address matches an exclude pattern (case-insensitive substring; `*` matches anything). */
export function isExcluded(url: string, patterns: string[]): boolean {
  let target: string;
  try {
    const u = new URL(url);
    target = (u.pathname + u.search + hashRoute(url)).toLowerCase();
  } catch {
    target = url.toLowerCase();
  }
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (!p.includes("*")) return target.includes(p);
    const re = new RegExp(p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
    return re.test(target);
  });
}

const LOCALE_SEGMENT_RE = /^[a-z]{2}([-_][a-z]{2,4})?$/i;
const ID_SEGMENT_RE = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}|[a-z0-9_-]*\d[a-z0-9_-]{5,})$/i;

/**
 * Template of a page from its address alone: ids (numbers, UUIDs, hashes, codes with digits)
 * become `*`, query values are dropped and only the parameter names kept. /product/123 and
 * /product/456 share /product/*. Folders of many named pages (/blog/my-post) are grouped
 * later, by `choosePages`, once the number of siblings is known.
 */
export function templateKey(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const generic = (path: string) =>
    path
      .split("/")
      .filter(Boolean)
      .map((seg) => {
        // An id with a file extension (/product/123.html) is still an id.
        const ext = /\.[a-z0-9]{1,5}$/i.exec(seg)?.[0] ?? "";
        return ID_SEGMENT_RE.test(seg.slice(0, seg.length - ext.length)) ? "*" + ext : seg;
      });
  // The query is ignored: /report/display?id=1 and ?id=2, or a list and its filtered views
  // (?status=3), are one screen. Case is ignored too (ASP.NET serves /SAML/x and /Saml/x alike).
  const base = "/" + generic(u.pathname).join("/");
  // A hash route is the page's real path: #/employee/123 and #/employee/456 share one template.
  const route = hashRoute(url);
  if (!route) return base.toLowerCase();
  const routePath = route.replace(HASH_ROUTE_RE, "").split("?")[0];
  return `${base}#/${generic(routePath).join("/")}`.toLowerCase();
}

/** The same page, ignoring the case of the address (servers such as IIS treat /SAML and /Saml alike). */
export function samePage(a: string | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

/** A folder with at least this many listed pages is treated as one template (a blog, a product catalogue). */
export const SIBLING_THRESHOLD = 8;

/** The folder a template sits in, or null for top-level pages (and pages right under a language prefix). */
function folderOf(template: string): string | null {
  const hashAt = template.indexOf("#/");
  if (hashAt >= 0) {
    const inner = folderOf(template.slice(hashAt + 1));
    return inner === null ? null : template.slice(0, hashAt) + "#" + inner;
  }
  const [path, query] = template.split("?");
  const segs = path.split("/").filter(Boolean);
  const folderStart = segs.length > 0 && LOCALE_SEGMENT_RE.test(segs[0]) ? 1 : 0;
  if (segs.length - folderStart < 2) return null;
  return "/" + segs.slice(0, -1).join("/") + "/*" + (query ? "?" + query : "");
}

/**
 * Templates with crowded folders folded into `folder/*`, for pages taken from the sitemap only
 * (a sitemap lists every blog post). Pages reached from the site's menus are distinct screens
 * even when they share a folder: /UserData/Accounts and /UserData/Holdings in an MVC app.
 */
export function groupTemplates(pages: SitePage[]): SitePage[] {
  const perFolder = new Map<string, number>();
  for (const p of pages) {
    if (p.source !== "sitemap") continue;
    const f = folderOf(templateKey(p.url));
    if (f) perFolder.set(f, (perFolder.get(f) ?? 0) + 1);
  }
  return pages.map((p) => {
    const own = templateKey(p.url);
    const f = p.source === "sitemap" ? folderOf(own) : null;
    const template = f && (perFolder.get(f) ?? 0) >= SIBLING_THRESHOLD ? f : own;
    return template === p.template ? p : { ...p, template };
  });
}

/** href values of <a> and <area> elements in an HTML string, resolved against the page (and its <base>). */
export function extractLinks(html: string, pageUrl: string): string[] {
  return extractLinkInfo(html, pageUrl).map((l) => l.url);
}

/** Like `extractLinks`, noting which links sit inside <nav>, <header>, <footer> or <aside>. */
export function extractLinkInfo(html: string, pageUrl: string): LinkInfo[] {
  const navRanges: Array<[number, number]> = [];
  const blockRe = /<(nav|header|footer|aside)\b[\s\S]*?<\/\1\s*>/gi;
  for (let m = blockRe.exec(html); m; m = blockRe.exec(html)) navRanges.push([m.index, m.index + m[0].length]);
  const inNav = (i: number) => navRanges.some(([a, b]) => i >= a && i < b);
  let base = pageUrl;
  const baseTag = /<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
  if (baseTag) {
    try {
      base = new URL(decodeEntities(baseTag[1] ?? baseTag[2] ?? baseTag[3] ?? ""), pageUrl).toString();
    } catch {
      // keep the page address
    }
  }
  const out: LinkInfo[] = [];
  const re = /<(?:a|area)\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim();
    // "#section" points into this same page; "#/route" is a page of a hash-routed app.
    if (href.startsWith("#") && !HASH_ROUTE_RE.test(href)) continue;
    const n = normalizeUrl(href, base);
    if (n) out.push({ url: n, nav: inNav(m.index) });
  }
  return out;
}

/**
 * The kind of page a content link leads to, for keeping one example of each: pages one folder
 * deeper than the application's root that share a folder are one kind (/product/123 and
 * /product/456, /products/blue-shirt and /products/red-shoes). Pages directly under the root
 * (or under `within`, or a language prefix) each stay their own kind, since those are usually
 * distinct screens (/about, /hrms/leave).
 */
export function similarKey(url: string, within = ""): string {
  const t = templateKey(url);
  const folderKey = (pathAndQuery: string, skip: string[]): string => {
    const [path, query] = pathAndQuery.split("?");
    const segs = path.split("/").filter(Boolean);
    let start = skip.length && skip.every((s, i) => segs[i] === s) ? skip.length : 0;
    if (segs[start] && LOCALE_SEGMENT_RE.test(segs[start])) start++;
    if (segs.length - start < 2) return pathAndQuery;
    return "/" + segs.slice(0, -1).join("/") + "/*" + (query ? "?" + query : "");
  };
  const withinSegs = within.split("/").filter(Boolean);
  const hashAt = t.indexOf("#/");
  if (hashAt >= 0) return t.slice(0, hashAt) + "#" + folderKey(t.slice(hashAt + 1), []);
  return folderKey(t, withinSegs);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/** Page addresses and child sitemaps listed in a sitemap or sitemap index. */
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const pages: string[] = [];
  const sitemaps: string[] = [];
  const blockRe = /<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (let m = blockRe.exec(xml); m; m = blockRe.exec(xml)) {
    const loc = /<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/i.exec(m[2]);
    if (!loc) continue;
    const value = decodeEntities(loc[1].trim());
    (m[1].toLowerCase() === "sitemap" ? sitemaps : pages).push(value);
  }
  return { pages, sitemaps };
}

/** `Sitemap:` lines of a robots.txt. */
export function robotsSitemaps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => /^\s*sitemap\s*:\s*(\S+)/i.exec(l)?.[1])
    .filter((s): s is string => !!s);
}

/**
 * Tick the pages to scan, in discovery order: the start page always, then pages until
 * `maxPages`, at most `perTemplate` per template. The rest stay listed, unticked, with the reason.
 * Pages already scanned or ticked by hand keep their choice.
 */
export function choosePages(pages: SitePage[], options: SiteScanOptions): SitePage[] {
  const perTemplate = new Map<string, number>();
  let included = 0;
  return groupTemplates(pages).map((p) => {
    if (p.status !== "pending" || p.source === "manual" || p.userSet) {
      if (p.include) {
        included++;
        perTemplate.set(p.template, (perTemplate.get(p.template) ?? 0) + 1);
      }
      return p;
    }
    const seen = perTemplate.get(p.template) ?? 0;
    if (p.source !== "start" && options.perTemplate > 0 && seen >= options.perTemplate) {
      return { ...p, include: false, note: `Similar to ${seen} page${seen === 1 ? "" : "s"} already listed (${p.template})` };
    }
    // Counted even when the limit leaves it unticked: a later copy of this template is then
    // labelled "Similar", and "Over the page limit" is kept for genuinely different screens.
    perTemplate.set(p.template, seen + 1);
    if (p.source !== "start" && included >= options.maxPages) return { ...p, include: false, note: "Over the page limit" };
    included++;
    return { ...p, include: true, note: undefined };
  });
}

/**
 * Order in which pages are offered for scanning: the start page, then pages linked from it
 * (its menus), then deeper links, then pages only the sitemap lists, shallower paths first.
 * Stable, so discovery order breaks ties.
 */
export function rankPages(pages: SitePage[]): SitePage[] {
  const segments = (url: string) => {
    try {
      return new URL(url).pathname.split("/").filter(Boolean).length;
    } catch {
      return 99;
    }
  };
  const key = (p: SitePage): number[] => [p.source === "start" ? 0 : 1, p.source === "sitemap" ? 1 : 0, p.depth, segments(p.url)];
  return pages
    .map((p, i) => ({ p, i, k: key(p) }))
    .sort((a, b) => {
      for (let j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j] - b.k[j];
      return a.i - b.i;
    })
    .map((x) => x.p);
}

export function makePage(url: string, depth: number, source: SitePageSource): SitePage {
  return { url, depth, source, template: templateKey(url), include: false, status: "pending" };
}
