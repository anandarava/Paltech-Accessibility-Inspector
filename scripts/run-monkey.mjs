#!/usr/bin/env node
// Wrapper for the monkey test (tests/monkey/monkey.spec.ts).
// Playwright's CLI rejects unknown flags, so options are parsed here and handed
// to the spec through the MONKEY_CONFIG environment variable.
//
//   npm run test:monkey -- --url keyboard-trap --seed 42
//
// Options
//   --url <page>          page to test; repeatable. A full http(s) URL, or a fixture name
//                         ("keyboard-trap" = fixtures/keyboard-trap.html). Default: keyboard-trap
//   --seed <n>            seed for the random generator (default: random, printed)
//   --max-actions <n>     default 200
//   --max-time <seconds>  default 120
//   --scan-every <n>      extension scan every n actions (default 50)
//   --sweep-every <n>     Tab sweep for keyboard traps every n actions (default 50)
//   --sweep-tabs <n>      Tab presses per sweep (default 40)
//   --delay <ms>          pause after each action (default 50)
//   --out <file>          JSON report path (default test-results/monkey/...)
//   --headed              show the browser
// Exit code: 0 = clean, 1 = new Critical/Serious issue, keyboard trap or uncaught error.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const cfg = { urls: [] };
const num = (flag, v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${flag} needs a non-negative number (got "${v}")`);
    process.exit(2);
  }
  return n;
};

for (let i = 0; i < argv.length; i++) {
  const flag = argv[i];
  const value = () => {
    if (argv[i + 1] === undefined) {
      console.error(`${flag} needs a value`);
      process.exit(2);
    }
    return argv[++i];
  };
  switch (flag) {
    case "--url": cfg.urls.push(value()); break;
    case "--seed": cfg.seed = num(flag, value()); break;
    case "--max-actions": cfg.maxActions = num(flag, value()); break;
    case "--max-time": cfg.maxTimeMs = num(flag, value()) * 1000; break;
    case "--scan-every": cfg.scanEvery = Math.max(1, num(flag, value())); break;
    case "--sweep-every": cfg.sweepEvery = Math.max(1, num(flag, value())); break;
    case "--sweep-tabs": cfg.sweepTabs = Math.max(1, num(flag, value())); break;
    case "--delay": cfg.actionDelayMs = num(flag, value()); break;
    case "--out": cfg.out = value(); break;
    case "--headed": process.env.A11Y_E2E_HEADED = "1"; break;
    default:
      console.error(`Unknown option ${flag}. See the header of scripts/run-monkey.mjs.`);
      process.exit(2);
  }
}

const cli = path.join(ROOT, "node_modules", "@playwright", "test", "cli.js");
const child = spawn(process.execPath, [cli, "test", "--project=monkey"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, MONKEY_RUN: "1", MONKEY_CONFIG: JSON.stringify(cfg) },
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
