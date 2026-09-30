#!/usr/bin/env node
// Prints the rule catalogue from shared/a11y-rules.json as a Markdown table
// (used to generate the "Rule catalogue" section of README.md).
//   node scripts/print-rules.mjs            -> grouped by category
//   node scripts/print-rules.mjs --flat     -> one table
//   node scripts/print-rules.mjs --json     -> summary counts as JSON
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.resolve(here, "..", "shared", "a11y-rules.json");
const catalogue = JSON.parse(readFileSync(rulesPath, "utf8"));
// Undeterminable ("Semi") rules stay in the catalogue for id lookups but are never reported.
const rulesFile = { ...catalogue, rules: catalogue.rules.filter((r) => r.type !== "Semi") };

const args = new Set(process.argv.slice(2));
const escape = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wcagCell(rule) {
  if (rule.wcag.level === "BP") return "Best practice";
  return `${rule.wcag.criterion} ${rule.wcag.name} (${rule.wcag.level})`;
}

function row(rule) {
  const source = rule.axeRules && rule.axeRules.length ? `axe: ${rule.axeRules.map((r) => `\`${r}\``).join(", ")}` : "custom";
  return `| ${rule.id} | ${escape(rule.check)} | ${wcagCell(rule)} | ${rule.type} | ${rule.severity ?? "-"} | ${source} | ${rule.enabled ? "yes" : "no"} |`;
}

const header = "| Rule | Check | WCAG 2.2 | Type | Severity | Source | Enabled by default |\n|---|---|---|---|---|---|---|";

if (args.has("--json")) {
  const counts = { total: rulesFile.rules.length, auto: 0, axe: 0, custom: 0, bestPractice: 0 };
  for (const r of rulesFile.rules) {
    counts[r.type.toLowerCase()]++;
    if (r.axeRules && r.axeRules.length) counts.axe++;
    else counts.custom++;
    if (r.wcag.level === "BP") counts.bestPractice++;
  }
  console.log(JSON.stringify({ version: rulesFile.version, wcagVersion: rulesFile.wcagVersion, ...counts }, null, 2));
} else if (args.has("--flat")) {
  console.log(header);
  for (const r of rulesFile.rules) console.log(row(r));
} else {
  const byCategory = new Map();
  for (const r of rulesFile.rules) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category).push(r);
  }
  for (const [category, rules] of byCategory) {
    console.log(`#### ${category}\n`);
    console.log(header);
    for (const r of rules) console.log(row(r));
    console.log("");
  }
}
