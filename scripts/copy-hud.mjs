#!/usr/bin/env node
/**
 * Copy the HUD page and only the files it loads into public/hud/, so the Next.js app serves it on
 * the same origin as the online demo (/demo embeds /hud/hud.html?mode=integration&link=parent).
 * Runs before `next dev` and `next build` (npm predev / prebuild). public/hud/ is generated and
 * git-ignored: edit myomars-hud/ only. Nothing else from myomars-hud (server, tests) is published.
 */
import { cpSync, mkdirSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SRC = "myomars-hud";
const OUT = "public/hud";
const FILES = [
  "hud.html",
  "hud/base-client.js",
  "hud/parent-link.js",
  "scene/mars-scene.js",
  "assets",
  // the stored simulated retest sample the integration HUD submits (no other contract files)
  "contracts-v1/scenarios/change-retest.json",
];
rmSync(OUT, { recursive: true, force: true });
let bytes = 0;
const size = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0) : statSync(p).size);
for (const f of FILES) {
  const from = join(SRC, f);
  if (!existsSync(from)) throw new Error(`copy-hud: missing ${from}`);
  mkdirSync(dirname(join(OUT, f)), { recursive: true });
  cpSync(from, join(OUT, f), { recursive: true });
  bytes += size(from);
}
console.log(`copy-hud: ${FILES.length} entries → ${OUT} (${(bytes / 1024).toFixed(0)} KB)`);
