/**
 * The one inline script of the HTML report. It only adds convenience on top of a report that already
 * works without it: a search box, a live "showing X of Y" count, "Show all" and expand / collapse
 * buttons. The severity filter itself is plain HTML and CSS.
 *
 * The report's Content-Security-Policy allows exactly this script, by hash (see html-report.ts), so
 * nothing else can run. Keep this text free of template-literal substitutions and backticks: it is
 * hashed and emitted verbatim. Report content is HTML-escaped before it is built, and the script
 * never writes HTML: it only toggles classes and reads text.
 */
export const REPORT_SCRIPT = `(function () {
  var doc = document;
  doc.documentElement.className += " js";
  var dev = doc.querySelector(".devfilter");
  if (!dev) return;
  var search = doc.getElementById("q");
  var count = doc.getElementById("count");
  var noMatch = doc.getElementById("nomatch");
  var boxes = Array.prototype.slice.call(dev.querySelectorAll('input[type="checkbox"]'));
  var items = Array.prototype.slice.call(dev.querySelectorAll("li.inst"));
  var rules = Array.prototype.slice.call(dev.querySelectorAll("article.rule"));
  var rows = Array.prototype.slice.call(dev.querySelectorAll("tr[data-sevs]"));

  function text(el) {
    return (el.textContent || "").toLowerCase();
  }
  function severityOn(name) {
    var box = doc.getElementById("f-" + name);
    return !box || box.checked;
  }
  var ruleText = rules.map(function (rule) {
    return text(rule.querySelector(".rule-h") || rule);
  });

  function apply() {
    var term = search ? search.value.toLowerCase().trim() : "";
    var shown = 0;
    var ruleShown = {};
    rules.forEach(function (rule, index) {
      var headMatches = !term || ruleText[index].indexOf(term) !== -1;
      var visible = 0;
      Array.prototype.forEach.call(rule.querySelectorAll("li.inst"), function (li) {
        var ok = severityOn(li.getAttribute("data-sev")) && (headMatches || text(li).indexOf(term) !== -1);
        li.classList.toggle("s-hide", !ok);
        if (ok) visible++;
      });
      rule.classList.toggle("s-hide", visible === 0);
      ruleShown[rule.id] = visible > 0;
      shown += visible;
      if (term && visible > 0) {
        Array.prototype.forEach.call(rule.querySelectorAll("details.more"), function (d) {
          d.open = true;
        });
      }
    });
    rows.forEach(function (row) {
      var link = row.querySelector('a[href^="#"]');
      var id = link ? link.getAttribute("href").slice(1) : "";
      row.classList.toggle("s-hide", id in ruleShown && !ruleShown[id]);
    });
    if (count) count.textContent = "Showing " + shown + " of " + items.length + " element" + (items.length === 1 ? "" : "s");
    if (noMatch) noMatch.hidden = !(term && shown === 0);
  }

  function setOpen(selector, open) {
    Array.prototype.forEach.call(dev.querySelectorAll(selector), function (d) {
      d.open = open;
    });
  }

  if (search) {
    search.addEventListener("input", apply);
    search.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && search.value) {
        search.value = "";
        apply();
      }
    });
  }
  boxes.forEach(function (box) {
    box.addEventListener("change", apply);
  });
  var showAll = doc.getElementById("showall");
  if (showAll) {
    showAll.addEventListener("click", function () {
      boxes.forEach(function (box) {
        box.checked = true;
      });
      if (search) search.value = "";
      apply();
    });
  }
  var expand = doc.getElementById("expand");
  if (expand) expand.addEventListener("click", function () {
    setOpen("details.rulebody", true);
  });
  var collapse = doc.getElementById("collapse");
  if (collapse) collapse.addEventListener("click", function () {
    setOpen("details.rulebody", false);
  });
  apply();
})();`;
