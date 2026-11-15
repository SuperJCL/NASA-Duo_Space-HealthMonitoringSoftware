#!/usr/bin/env node
/**
 * Copy the shared MyoMars design resources (design/) next to the plain-HTML pages, so each demo
 * stays self-contained (no module loads another module's files at run time).
 *
 *   node scripts/design-sync.mjs           # write the copies
 *   node scripts/design-sync.mjs --check   # fail if a copy is missing or differs (part of npm run check)
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SOURCES = {
  "myomars-tokens.css": "design/tokens.css",
  "myomars-fonts.css": "design/fonts.css",
  "myomars-components.css": "design/components.css",
  "fonts/geist-latin.woff2": "design/fonts/geist-latin.woff2",
  "fonts/geist-mono-latin.woff2": "design/fonts/geist-mono-latin.woff2",
};
// The shared language covers the Mars Base and the HUD only. The patch showcase keeps its own
// copy (astra-patch/showcase/assets/showcase-*.css) and is not synced or checked.
const TARGETS = ["myomars-hud/assets"];
const check = process.argv.includes("--check");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

let bad = 0;
for (const dir of TARGETS) {
  if (!existsSync(dirname(dir))) {
    console.log(`skip ${dir} (module folder not present)`);
    continue;
  }
  for (const [name, src] of Object.entries(SOURCES)) {
    const dest = join(dir, name);
    if (check) {
      if (!existsSync(dest) || sha(dest) !== sha(src)) {
        console.error(`design:check: ${dest} is missing or differs from ${src} (run npm run design:sync)`);
        bad++;
      }
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  }
}
if (check) {
  if (bad) process.exit(1);
  console.log("design:check: all copies match design/");
} else console.log(`design:sync: copied ${Object.keys(SOURCES).length} files to ${TARGETS.join(", ")}`);
