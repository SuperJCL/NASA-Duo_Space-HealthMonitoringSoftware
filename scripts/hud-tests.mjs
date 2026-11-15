// Runs the HUD teammate's own test suites (myomars-hud/test) as part of integration verification.
// The HUD folder is excluded from the station's ESLint, so these suites are its check:
//   joint-test.mjs     client ↔ mock relay/station, contract conformance (standalone mode)
//   hud-page-test.mjs  the real hud.html script driven in a browser (standalone mode)
// Integration mode (hud.html?mode=integration) is covered by scripts/e2e-two-end.mjs.
// The suites rewrite their committed result files; this wrapper restores them afterwards so a
// check never leaves the tree dirty. Exit code 1 if either suite fails.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HUD = join(dirname(fileURLToPath(import.meta.url)), "..", "myomars-hud");
const RESULTS = ["test/joint-test-result.json", "test/hud-page-test-result.json"].map((f) => join(HUD, f));
const saved = RESULTS.map((f) => readFileSync(f));
let failed = false;
try {
  for (const suite of ["test/joint-test.mjs", "test/hud-page-test.mjs"]) {
    const r = spawnSync(process.execPath, [suite], { cwd: HUD, encoding: "utf8", timeout: 300_000 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const fails = out.split("\n").filter((l) => /^FAIL/.test(l));
    const summary = out.split("\n").filter((l) => /结果：/.test(l)).at(-1) ?? "(no summary)";
    console.log(`${suite}: ${summary}${fails.length ? `\n  ${fails.join("\n  ")}` : ""}`);
    if (r.status !== 0 || fails.length || !/通过/.test(summary)) failed = true;
  }
} finally {
  RESULTS.forEach((f, i) => writeFileSync(f, saved[i]));
}
process.exit(failed ? 1 : 0);
