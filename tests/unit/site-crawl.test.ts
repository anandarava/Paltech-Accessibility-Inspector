import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCLUDES,
  DEFAULT_SITE_SCAN_OPTIONS,
  choosePages,
  defaultWithin,
  extractLinks,
  extractLinkInfo,
  similarKey,
  hashRoute,
  isWithin,
  isExcluded,
  makePage,
  normalizeUrl,
  samePage,
  isMenuName,
  runPool,
  parallelWindows,
  WorkerGone,
  parseSitemap,
  rankPages,
  robotsSitemaps,
  SIBLING_THRESHOLD,
  groupTemplates,
  templateKey,
} from "@shared/site-crawl";

describe("normalizeUrl", () => {
  it("leaves out downloadable files, also with odd endings", () => {
    for (const file of ["https://a.com/download/Hello%20World!.rtf", "https://a.com/download/notes.md", "https://a.com/download/tmpfkman1.tmp", "https://a.com/download/shell.txt%20jpg", "https://a.com/download/shell.txt::$DATA", "https://a.com/files/report.PDF", "https://a.com/download/files.py"]) {
      expect(normalizeUrl(file), file).toBeNull();
    }
    // An extension-like word inside a page name is not a file.
    expect(normalizeUrl("https://a.com/learn/node.js-basics")).toBe("https://a.com/learn/node.js-basics");
    expect(normalizeUrl("https://a.com/download/guide.html")).toBe("https://a.com/download/guide.html");
  });

  it("drops session ids in the path, and leaves out service descriptions, APIs and certificates", () => {
    expect(normalizeUrl("https://a.com/bank/about.htm;jsessionid=4B706DBFC0A047C5")).toBe("https://a.com/bank/about.htm");
    expect(normalizeUrl("https://a.com/bank/services/ParaBank;jsessionid=4B70?wsdl")).toBeNull();
    expect(normalizeUrl("https://a.com/bank/services/bank?_type=xml&_wadl")).toBeNull();
    expect(normalizeUrl("https://a.com/bank/soatest.pfx")).toBeNull();
    expect(normalizeUrl("https://a.com/api/productsList")).toBeNull();
    expect(normalizeUrl("https://a.com/app/api/users")).toBeNull();
    expect(normalizeUrl("https://a.com/cdn-cgi/l/email-protection")).toBeNull();
    // A page about the API is a page.
    expect(normalizeUrl("https://a.com/api_list")).toBe("https://a.com/api_list");
    expect(normalizeUrl("https://a.com/api")).toBe("https://a.com/api");
  });

  it("leaves out news feeds (RSS / Atom), which are not pages", () => {
    for (const feed of ["https://a.blogspot.com/feeds/posts/default", "https://a.com/feed", "https://a.com/blog/feed/", "https://a.com/comments/feed", "https://a.com/rss", "https://a.com/?feed=rss2", "https://a.com/search?alt=rss"]) {
      expect(normalizeUrl(feed), feed).toBeNull();
    }
    // Words that only contain "feed" or "rss" are pages.
    expect(normalizeUrl("https://a.com/feedback")).toBe("https://a.com/feedback");
    expect(normalizeUrl("https://a.com/news-feed-settings")).toBe("https://a.com/news-feed-settings");
  });
  it("drops the fragment, tracking parameters and a trailing slash, and sorts the query", () => {
    expect(normalizeUrl("https://a.com/docs/?utm_source=x&b=2&a=1#intro")).toBe("https://a.com/docs?a=1&b=2");
    expect(normalizeUrl("https://a.com/")).toBe("https://a.com/");
  });
  it("resolves relative links against the page", () => {
    expect(normalizeUrl("../pricing", "https://a.com/en/docs/start")).toBe("https://a.com/en/pricing");
  });
  it("rejects other protocols and files", () => {
    expect(normalizeUrl("mailto:x@a.com")).toBeNull();
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
    expect(normalizeUrl("https://a.com/brochure.PDF")).toBeNull();
    expect(normalizeUrl("https://a.com/logo.svg")).toBeNull();
  });
});

describe("templateKey", () => {
  it("treats slugs ending in an id, and list pages, as ids; short step numbers as names", () => {
    expect(templateKey("https://b.com/catalogue/a-light-in-the-attic_1000/index.html")).toBe("/catalogue/*/index.html");
    expect(templateKey("https://b.com/catalogue/category/books/travel_2/index.html")).toBe("/catalogue/category/books/*/index.html");
    expect(templateKey("https://b.com/catalogue/page-2.html")).toBe("/catalogue/*.html");
    expect(templateKey("https://b.com/products/blue-shirt-48213")).toBe("/products/*");
    expect(templateKey("https://b.com/checkout/step-2")).toBe("/checkout/step-2");
  });
  it("groups pages that differ only by an id", () => {
    expect(templateKey("https://a.com/product/123")).toBe(templateKey("https://a.com/product/456"));
    expect(templateKey("https://a.com/product/123.html")).toBe("/product/*.html");
    expect(templateKey("https://a.com/orders/3f2b1c4d-1111-2222-3333-444455556666/items")).toBe("/orders/*/items");
  });
  it("keeps named pages apart, wherever they sit", () => {
    expect(templateKey("https://a.com/about")).not.toBe(templateKey("https://a.com/pricing"));
    expect(templateKey("https://a.com/portal/dashboard")).not.toBe(templateKey("https://a.com/portal/settings"));
  });
  it("ignores the query and the case: filtered views and id parameters are one screen", () => {
    expect(templateKey("https://a.com/search?q=shoes&page=2")).toBe(templateKey("https://a.com/search?page=9&q=hats"));
    expect(templateKey("https://a.com/Report/Display?id=1")).toBe(templateKey("https://a.com/Report/Display?id=23"));
    expect(templateKey("https://a.com/Report/BrokerFeedStatus")).toBe(templateKey("https://a.com/Report/BrokerFeedStatus?status=3"));
    expect(templateKey("https://a.com/SAML/Resource")).toBe(templateKey("https://a.com/Saml/Resource"));
  });
});

describe("groupTemplates", () => {
  it("folds a crowded folder into one template, but not a few named pages or a language prefix", () => {
    const posts = Array.from({ length: SIBLING_THRESHOLD }, (_, i) => makePage(`https://a.com/blog/post-title-${"abcdefghij"[i]}`, 1, "sitemap"));
    const app = ["dashboard", "settings", "reports"].map((n) => makePage(`https://a.com/portal/${n}`, 1, "link"));
    const lang = Array.from({ length: SIBLING_THRESHOLD }, (_, i) => makePage(`https://a.com/en/page-${"abcdefghij"[i]}`, 1, "sitemap"));
    const out = groupTemplates([...posts, ...app, ...lang]);
    expect(new Set(out.slice(0, posts.length).map((p) => p.template))).toEqual(new Set(["/blog/*"]));
    expect(new Set(out.slice(posts.length, posts.length + 3).map((p) => p.template)).size).toBe(3);
    expect(new Set(out.slice(posts.length + 3).map((p) => p.template)).size).toBe(lang.length);
  });
  it("never folds menu pages: an MVC controller's screens stay apart", () => {
    const screens = ["Accounts", "Holdings", "Transactions", "FirmTrades", "Profile", "Create", "InviteUser", "PersonsDirectory", "Holdings2"].map((a) =>
      makePage(`https://a.com/UserData/${a}`, 1, "link"),
    );
    expect(new Set(groupTemplates(screens).map((p) => p.template)).size).toBe(screens.length);
  });
});

describe("isExcluded", () => {
  it("matches the default dangerous links, case-insensitively", () => {
    expect(isExcluded("https://a.com/account/Logout", DEFAULT_EXCLUDES)).toBe(true);
    expect(isExcluded("https://a.com/items/7/delete", DEFAULT_EXCLUDES)).toBe(true);
    expect(isExcluded("https://a.com/products", DEFAULT_EXCLUDES)).toBe(false);
  });
  it("supports * wildcards and ignores the host", () => {
    expect(isExcluded("https://a.com/admin/users/5", ["/admin/*"])).toBe(true);
    expect(isExcluded("https://admin.com/x", ["admin"])).toBe(false);
  });
});

describe("extractLinks", () => {
  it("reads <a> and <area> hrefs in any quoting, honouring <base> and entities", () => {
    const html = `<base href="/app/"><a href="one">1</a><a class=x href='/two?a=1&amp;b=2'>2</a><area href=three><a href="#top">t</a><a href="mailto:z@a.com">m</a>`;
    expect(extractLinks(html, "https://a.com/start")).toEqual([
      "https://a.com/app/one",
      "https://a.com/two?a=1&b=2",
      "https://a.com/app/three",
    ]);
  });
});

describe("sitemaps", () => {
  it("separates pages from child sitemaps", () => {
    const xml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>
      <urlset><url><loc> https://a.com/x?a=1&amp;b=2 </loc><lastmod>2026</lastmod></url><url><loc><![CDATA[https://a.com/y]]></loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual({ pages: ["https://a.com/x?a=1&b=2", "https://a.com/y"], sitemaps: ["https://a.com/s1.xml"] });
  });
  it("reads Sitemap: lines from robots.txt", () => {
    expect(robotsSitemaps("User-agent: *\nDisallow: /x\nSitemap: https://a.com/sm.xml\r\nsitemap:https://a.com/b.xml")).toEqual([
      "https://a.com/sm.xml",
      "https://a.com/b.xml",
    ]);
  });
});

describe("choosePages", () => {
  const o = { ...DEFAULT_SITE_SCAN_OPTIONS, maxPages: 3, perTemplate: 2 };
  it("ticks the start page, caps each template and the page count, and says why", () => {
    const pages = [
      makePage("https://a.com/", 0, "start"),
      makePage("https://a.com/p/1", 1, "link"),
      makePage("https://a.com/p/2", 1, "link"),
      makePage("https://a.com/p/3", 1, "link"),
      makePage("https://a.com/about", 1, "link"),
      makePage("https://a.com/contact", 1, "link"),
    ];
    const chosen = choosePages(pages, o);
    expect(chosen.map((p) => p.include)).toEqual([true, true, true, false, false, false]);
    expect(chosen[3].note).toMatch(/Similar/);
    expect(chosen[4].note).toBe("Over the page limit");
  });
  it("keeps the tester's own choices", () => {
    const pages = [makePage("https://a.com/", 0, "start"), { ...makePage("https://a.com/x", 1, "link"), include: false, userSet: true }];
    expect(choosePages(pages, o)[1].include).toBe(false);
  });
});

describe("rankPages", () => {
  it("puts the start page, then its links, then deeper links, then sitemap-only pages first", () => {
    const pages = [
      makePage("https://a.com/s/deep/page", 1, "sitemap"),
      makePage("https://a.com/s", 1, "sitemap"),
      makePage("https://a.com/deep-link", 2, "link"),
      makePage("https://a.com/", 0, "start"),
      makePage("https://a.com/menu", 1, "link"),
    ];
    expect(rankPages(pages).map((p) => p.url.replace("https://a.com", ""))).toEqual(["/", "/menu", "/deep-link", "/s", "/s/deep/page"]);
  });
});

describe("within a folder", () => {
  it("takes the application's folder from a deep start address only", () => {
    expect(defaultWithin("https://apps.example.com/hrms/dashboard")).toBe("/hrms/");
    expect(defaultWithin("https://example.com/about")).toBe("");
    expect(defaultWithin("https://example.com/")).toBe("");
  });
  it("keeps pages inside the folder (and the folder itself)", () => {
    expect(isWithin("https://a.com/hrms/me/leave", "/hrms/")).toBe(true);
    expect(isWithin("https://a.com/hrms", "/hrms/")).toBe(true);
    expect(isWithin("https://a.com/hrms-old/x", "/hrms/")).toBe(false);
    expect(isWithin("https://a.com/pulse/", "/hrms")).toBe(false);
    expect(isWithin("https://a.com/anything", "")).toBe(true);
  });
});

describe("hash routes", () => {
  it("keeps #/route and #!/route as pages, drops plain anchors and the root route", () => {
    expect(normalizeUrl("https://a.com/app/#/leave/apply/")).toBe("https://a.com/app#/leave/apply");
    expect(normalizeUrl("https://a.com/app/#!/leave")).toBe("https://a.com/app#!/leave");
    expect(normalizeUrl("https://a.com/app/#main")).toBe("https://a.com/app");
    expect(normalizeUrl("https://a.com/app/#/")).toBe("https://a.com/app");
    expect(normalizeUrl("#/team", "https://a.com/app/index.html#/dashboard")).toBe("https://a.com/app/index.html#/team");
    expect(hashRoute("https://a.com/app#/leave")).toBe("#/leave");
    expect(hashRoute("https://a.com/app#top")).toBe("");
  });
  it("groups and skips by the route", () => {
    expect(templateKey("https://a.com/app#/employee/123")).toBe(templateKey("https://a.com/app#/employee/456"));
    expect(templateKey("https://a.com/app#/leave")).not.toBe(templateKey("https://a.com/app#/team"));
    expect(isExcluded("https://a.com/app#/logout", DEFAULT_EXCLUDES)).toBe(true);
    const posts = Array.from({ length: SIBLING_THRESHOLD }, (_, i) => makePage(`https://a.com/app#/news/story-${"abcdefghij"[i]}`, 1, "sitemap"));
    expect(new Set(groupTemplates(posts).map((p) => p.template))).toEqual(new Set(["/app#/news/*"]));
  });
});

describe("navigation links", () => {
  it("marks links inside nav, header, footer and aside", () => {
    const html = `<header><a href="/a">A</a></header><main><a href="/p/1">P</a><nav><a href="/b">B</a></nav></main><footer><a href="/c">C</a></footer><a href="/d">D</a>`;
    expect(extractLinkInfo(html, "https://s.com/").map((l) => `${l.url.replace("https://s.com", "")}:${l.nav}`)).toEqual([
      "/a:true", "/p/1:false", "/b:true", "/c:true", "/d:false",
    ]);
  });
  it("groups content pages by folder below the application's folder", () => {
    expect(similarKey("https://s.com/products/blue-shirt")).toBe(similarKey("https://s.com/products/red-shoes"));
    expect(similarKey("https://s.com/hrms/leave", "/hrms/")).not.toBe(similarKey("https://s.com/hrms/attendance", "/hrms/"));
    expect(similarKey("https://s.com/about")).not.toBe(similarKey("https://s.com/contact"));
    expect(similarKey("https://s.com/app#/items/a")).toBe(similarKey("https://s.com/app#/items/b"));
  });
});

describe("samePage", () => {
  it("ignores case and a folder's index file", () => {
    expect(samePage("https://b.com/", "https://b.com/index.html")).toBe(true);
    expect(samePage("https://b.com/shop", "https://b.com/shop/Default.aspx")).toBe(true);
    expect(samePage("https://b.com/SAML/x", "https://b.com/saml/x")).toBe(true);
    expect(samePage("https://b.com/shop", "https://b.com/shop/cart.html")).toBe(false);
  });
});

describe("runPool", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("runs at most one item per worker at a time, and hands results over in the items' order", async () => {
    let active = 0;
    let most = 0;
    const order: string[] = [];
    // Later items finish first.
    await runPool(
      ["a", "b", "c", "d", "e"],
      [1, 2, 3],
      () => true,
      async (item) => {
        active++;
        most = Math.max(most, active);
        await sleep(item === "a" ? 40 : 5);
        active--;
        return item.toUpperCase();
      },
      (_item, r) => order.push(r),
    );
    expect(most).toBe(3);
    expect(order).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("skips items `take` refuses, and stops taking new ones on \"stop\"", async () => {
    const ran: string[] = [];
    const out: string[] = [];
    await runPool(
      ["a", "skip", "b", "end", "c"],
      [1, 2],
      (item) => (item === "skip" ? false : item === "end" ? "stop" : true),
      async (item) => {
        ran.push(item);
        return item;
      },
      (_item, r) => out.push(r),
    );
    expect(ran.sort()).toEqual(["a", "b"]);
    expect(out).toEqual(["a", "b"]);
  });

  it("gives a closed worker's item to another worker", async () => {
    const out: string[] = [];
    await runPool(
      ["a", "b", "c"],
      ["gone", "ok"],
      () => true,
      async (item, worker) => {
        await sleep(item === "a" ? 1 : 10);
        if (worker === "gone") throw new WorkerGone();
        return `${item}@${worker}`;
      },
      (_item, r) => out.push(r),
    );
    expect(out).toEqual(["a@ok", "b@ok", "c@ok"]);
  });
});

describe("parallelWindows", () => {
  it("keeps the setting within 1 to 3, default 2", () => {
    expect(parallelWindows({})).toBe(2);
    expect(parallelWindows({ parallel: 0 })).toBe(1);
    expect(parallelWindows({ parallel: 3 })).toBe(3);
    expect(parallelWindows({ parallel: 9 })).toBe(3);
    expect(parallelWindows({ parallel: Number.NaN })).toBe(2);
  });
});

describe("menus built without <nav>", () => {
  it("recognises menu words as whole parts of a class or id", () => {
    for (const name of ["side-nav", "side-nav__list", "navbar navbar-expand", "mainMenu", "app-sidebar", "mat-sidenav", "top_menu", "breadcrumbs"]) expect(isMenuName(name), name).toBe(true);
    for (const name of ["canvas-chart", "unavailable", "menuitems-grid", "content", "", undefined]) expect(isMenuName(name), String(name)).toBe(false);
  });

  it("counts links inside a <div class=\"side-nav\"> as navigation, even hidden and nested", () => {
    const html = readFileSync(path.join(__dirname, "../../fixtures/sidenav/index.html"), "utf8");
    const links = extractLinkInfo(html, "https://app.example.com/sidenav/index.html");
    const nav = links.filter((l) => l.nav).map((l) => l.url.replace("https://app.example.com", ""));
    const content = links.filter((l) => !l.nav).map((l) => l.url.replace("https://app.example.com", ""));
    expect(nav).toEqual(expect.arrayContaining(["/sidenav/records/accounts.html", "/sidenav/records/gifts.html", "/sidenav/reports/saved.html", "/sidenav/reports/status.html"]));
    expect(content).toEqual(["/sidenav/news/alpha.html", "/sidenav/news/beta.html", "/sidenav/news/gamma.html", "/sidenav/news/delta.html", "/sidenav/news/epsilon.html"]);
  });

  it("does not let an element without a closing tag swallow the rest of the page", () => {
    const html = '<div class="nav-icon"><img class="menu-logo" src="x.png"><a href="/a">A</a></div><main><a href="/b">B</a></main>';
    const links = extractLinkInfo(html, "https://x.com/");
    expect(links).toEqual([{ url: "https://x.com/a", nav: true }, { url: "https://x.com/b", nav: false }]);
  });
});
