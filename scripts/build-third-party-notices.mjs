#!/usr/bin/env node
// Writes public/third-party-notices.txt for the Base/HUD website (Vercel project myomars-demo),
// served at /third-party-notices.txt and linked from the Base's "About" panel. Runs before
// `next dev` and `next build` (package.json predev / prebuild). The file is generated: never edit it.
//
// What it lists, and where each part comes from:
// - The npm components that the production client bundles contain. The list (SHIPPED) comes from a
//   source-map analysis of the production build (2026-11-19, next 16.4.5 / Turbopack): the browser
//   source maps list every bundled source file. The version and the full licence text of each
//   component are read here from the installed package, so they match what is built.
// - Sol Atlas (Apache-2.0) code, the three.js parts of the HUD scene bundle and the Geist fonts:
//   the matching NOTICE sections, quoted verbatim, plus the licence texts in LICENSES/.
// - The Create Next App template files the site serves: checked byte for byte against
//   create-next-app 16.4.5 (2026-11-19).
// - Data credits: src/data/sources.json, plus the Mars Trek catalogue facts checked on 2026-11-19.
// - Items whose rights are not confirmed: listed as such. This file grants no licence.
//
// If a new runtime dependency is added, the script stops until it is classified below.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NM = path.join(ROOT, "node_modules");
const OUT = path.join(ROOT, "public", "third-party-notices.txt");
const fail = (m) => {
  console.error(`third-party notices: ${m}`);
  process.exit(1);
};
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const rule = (c = "=") => c.repeat(78);

/** Components in the production client bundles (source-map analysis, see the header). */
const SHIPPED = [
  { dir: "next", use: "Next.js runtime, the Turbopack browser runtime and next/font client code (every page)" },
  { dir: "next/dist/compiled/react", name: "react (copy vendored by Next.js)", use: "React, as bundled by Next.js for the App Router" },
  { dir: "next/dist/compiled/react-dom", name: "react-dom (copy vendored by Next.js)", use: "React DOM, as bundled by Next.js for the App Router" },
  { dir: "next/dist/compiled/scheduler", name: "scheduler (copy vendored by Next.js)", use: "React scheduler, as bundled by Next.js" },
  { dir: "next/dist/compiled/react-server-dom-turbopack", name: "react-server-dom-turbopack (copy vendored by Next.js)", use: "React Server Components client, as bundled by Next.js" },
  { dir: "next/dist/compiled/process", name: "process (copy vendored by Next.js)", use: "browser shim of the Node.js process object, as bundled by Next.js" },
  { dir: "@swc/helpers", use: "helper functions emitted by the SWC compiler" },
  { dir: "ol", use: "Mission Map (OpenLayers), including the ol/ol.css styles" },
  { dir: "rbush", use: "spatial index used by OpenLayers" },
  { dir: "quickselect", use: "selection algorithm used by rbush" },
  { dir: "three", use: "3D terrain view of the Mars Base; parts of the same version are also in the HUD scene bundle /hud/scene/mars-scene.js (see below)" },
  { dir: "zod", use: "message contract validation" },
  { dir: "tailwindcss", use: "base styles (preflight) and utility classes generated into the site's stylesheet" },
];
/** package.json dependencies that are installed but not shipped to browsers, with the reason. */
const NOT_SHIPPED = {
  react: "not in the client bundles: the App Router uses the copy vendored by Next.js (listed above)",
  "react-dom": "not in the client bundles: the App Router uses the copy vendored by Next.js (listed above)",
};
/** Create Next App 16.4.5 template files served by the site, with their SHA-256 (checked 2026-11-19). */
const TEMPLATE_FILES = {
  "src/app/favicon.ico": "c28fdd2a4f31e2dc",
  "public/file.svg": "2b67812c325c199a",
  "public/globe.svg": "b614b9bf18392595",
  "public/next.svg": "55995dfad6ecb494",
  "public/vercel.svg": "f081337b2fee635b",
  "public/window.svg": "644768c4aaeb4767",
};

// Every runtime dependency must be classified.
const pkg = JSON.parse(read("package.json"));
const shippedTop = new Set(SHIPPED.map((c) => c.dir.split("/dist/")[0]));
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (!shippedTop.has(dep) && !NOT_SHIPPED[dep]) fail(`dependency "${dep}" is not classified in scripts/build-third-party-notices.mjs (SHIPPED or NOT_SHIPPED)`);
}

const nextVersion = JSON.parse(readFileSync(path.join(NM, "next/package.json"), "utf8")).version;
const versionFromCode = (dir) => {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (e.endsWith(".js")) {
        const m = readFileSync(p, "utf8").match(/exports\.version\s*=\s*["']([0-9][^"']+)["']/);
        if (m) return m[1];
      }
    }
  }
  return null;
};
const licenceFiles = (dir) => readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f) && statSync(path.join(dir, f)).isFile()).sort();
const repoUrl = (j) => (typeof j.repository === "string" ? j.repository : j.repository?.url ?? j.homepage ?? null);

const out = [];
const w = (...lines) => out.push(...lines);
w(
  "THIRD-PARTY NOTICES — MyoMars Mars Base + Astronaut HUD website",
  "",
  "This file lists the third-party software, fonts, data and template files that this website",
  "distributes, with their copyright notices and full licence texts. It is generated from the",
  "installed packages by scripts/build-third-party-notices.mjs when the site is built.",
  "",
  "It does not grant any licence for the project's own code, the HUD page or the project's media.",
  "Items whose rights are not yet confirmed are listed in part 6 and are not resolved by this file.",
  "",
  "Contents: 1. Software in the browser bundles  2. Sol Atlas (Apache-2.0)",
  "          3. three.js in the HUD scene bundle  4. Geist fonts (OFL-1.1)",
  "          5. Template files and data credits  6. Rights not yet confirmed",
  "",
);

// 1. npm components
w(rule(), "1. SOFTWARE IN THE BROWSER BUNDLES", rule(), "");
const seenTexts = new Map();
for (const c of SHIPPED) {
  const dir = path.join(NM, c.dir);
  if (!existsSync(dir)) fail(`${c.dir} is not installed (run npm ci)`);
  const j = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const name = c.name ?? j.name;
  let version = j.version ?? null;
  if (!version && c.dir.startsWith("next/dist/compiled/")) version = versionFromCode(dir);
  const versionText = version ?? `not stated in the vendored copy (it is bundled with next ${nextVersion})`;
  const files = licenceFiles(dir);
  if (!files.length) fail(`${c.dir} has no licence file`);
  w(rule("-"), `${name}`, `  version:  ${versionText}`, `  licence:  ${j.license ?? "see the licence text below"}`);
  if (repoUrl(j)) w(`  source:   ${repoUrl(j).replace(/^git\+/, "")}`);
  w(`  used for: ${c.use}`, "");
  for (const f of files) {
    const text = readFileSync(path.join(dir, f), "utf8").replace(/\s+$/, "");
    const key = sha256(text);
    if (seenTexts.has(key)) {
      w(`  ${f}: identical to the text shown for ${seenTexts.get(key)} above.`, "");
      continue;
    }
    seenTexts.set(key, name);
    w(`  --- ${c.dir}/${f} ---`, text, "");
  }
}

// NOTICE sections, quoted verbatim
const notice = read("NOTICE");
const section = (title) => {
  const lines = notice.split("\n");
  const start = lines.findIndex((l, i) => l === title && /^-+$/.test(lines[i + 1] ?? ""));
  if (start < 0) fail(`NOTICE has no "${title}" section`);
  let end = lines.length;
  for (let i = start + 2; i < lines.length - 1; i++) if (lines[i].trim() && /^-+$/.test(lines[i + 1]) && lines[i + 1].length >= 3) { end = i; break; }
  return lines.slice(start + 2, end).join("\n").replace(/\s+$/, "");
};

// 2. Sol Atlas
w(rule(), "2. SOL ATLAS (APACHE LICENSE 2.0)", rule(), "");
w(
  "The EVA route & scouting feature of the Mission Map runs in the browser and includes code derived",
  "from Sol Atlas. Source, files and modifications, as recorded in the repository's NOTICE file:",
  "",
  section("Sol Atlas"),
  "",
  "  --- LICENSES/Apache-2.0-Sol-Atlas.txt (copied unchanged from the upstream repository) ---",
  read("LICENSES/Apache-2.0-Sol-Atlas.txt").replace(/\s+$/, ""),
  "",
);

// 3. three.js in the HUD scene bundle
w(rule(), "3. THREE.JS IN THE HUD SCENE BUNDLE", rule(), "");
if (readFileSync(path.join(NM, "three/LICENSE"), "utf8") !== read("LICENSES/MIT-three.js.txt")) fail("node_modules/three/LICENSE no longer matches LICENSES/MIT-three.js.txt");
w(section("three.js (astronaut HUD 3D scene)"), "", "The licence text is the three.js text in part 1 (identical to LICENSES/MIT-three.js.txt).", "");

// 4. Geist fonts
w(rule(), "4. GEIST AND GEIST MONO FONTS (SIL OPEN FONT LICENSE 1.1)", rule(), "");
w(
  "The site serves Geist and Geist Mono font files in two places:",
  "- /_next/static/media/*.woff2: downloaded from Google Fonts by next/font/google at build time.",
  "  The copyright notice embedded in these files reads \"Copyright 2024 The Geist Project Authors",
  "  (https://github.com/vercel/geist-font)\" and their licence URL field is https://openfontlicense.org",
  "  (checked 2026-11-19).",
  "- /hud/assets/fonts/*.woff2: the repository copies described in the NOTICE file:",
  "",
  section("Geist and Geist Mono fonts"),
  "",
  "  --- LICENSES/OFL-1.1-Geist.txt (copied from the upstream OFL.txt) ---",
  read("LICENSES/OFL-1.1-Geist.txt").replace(/\s+$/, ""),
  "",
);

// 5. Template files and data credits
w(rule(), "5. TEMPLATE FILES AND DATA CREDITS", rule(), "");
for (const [file, hash] of Object.entries(TEMPLATE_FILES)) {
  const actual = sha256(readFileSync(path.join(ROOT, file))).slice(0, 16);
  if (actual !== hash) fail(`${file} changed (sha256 ${actual}); update the template section of this script`);
}
w(
  "Create Next App template files",
  "  /favicon.ico, /file.svg, /globe.svg, /next.svg, /vercel.svg and /window.svg are byte-identical to",
  "  the app template of create-next-app 16.4.5 (checked 2026-11-19). That package declares the MIT",
  "  licence and ships no licence file; it is published from the vercel/next.js repository, whose",
  "  licence (license.md at tag v16.4.5) is identical to the next licence text in part 1.",
  "  next.svg and vercel.svg are logos of Vercel, Inc.; a copyright licence grants no trademark rights.",
  "",
);
const sources = JSON.parse(read("src/data/sources.json"));
const srcList = Array.isArray(sources) ? sources : sources.sources ?? Object.values(sources);
const byId = (id) => srcList.find((s) => s.id === id) ?? fail(`src/data/sources.json has no "${id}"`);
const cite = (id) => {
  const s = byId(id);
  return [`    ${s.title}`, `    ${s.publisher}`, `    ${s.url}`];
};
w(
  "Mars terrain crops (/terrain/ctx-lefroy-bay/ and /terrain/hirise-lefroy-bay/)",
  "  Bounded crops of NASA data distributed through NASA Solar System Treks (Mars Trek), JPL, built by",
  "  scripts/build-ctx-terrain.mjs and scripts/build-hirise-terrain.mjs without changing the values:",
  "  CTX (Mars Reconnaissance Orbiter, Context Camera):",
  ...cite("trek-jezero-ctx-dtm"),
  ...cite("trek-jezero-ctx-ortho"),
  "  HiRISE (Mars Reconnaissance Orbiter, High Resolution Imaging Science Experiment):",
  ...cite("trek-jezero-hirise-dtm"),
  ...cite("trek-jezero-hirise-ortho"),
  "  The Mars Trek catalogue records of these four products (checked 2026-11-19) state that the USGS",
  "  Astrogeology Science Center generated and delivered them in support of the Mars 2020 Terrain",
  "  Relative Navigation.",
  "",
  "Mission data in the page (historical rover traverse and sample site positions)",
  ...cite("trek-perseverance-traverse"),
  ...cite("pds-m2020-initial-reports-vol4"),
  "",
  "Map tiles shown on the Mission Map are loaded at view time from NASA Mars Trek (trek.nasa.gov);",
  "their credits are shown in the map's attribution control. Quoted text in the evidence records",
  "remains the text of its cited sources (all listed, with links, in the app).",
  "",
);

// 6. Not confirmed
w(rule(), "6. RIGHTS NOT YET CONFIRMED (NOT RESOLVED BY THIS FILE)", rule(), "");
w(
  "- /hud/assets/mars-pano-360.webp (HUD panorama fallback image): its source and the right to use",
  "  and distribute it have not been confirmed.",
  "- The project's own code, the HUD page and the contract samples: no licence has been set yet;",
  "  this file grants none.",
  "- The HiRISE credit wording \"NASA/JPL/UArizona\" shown in the map attribution is not stated in the",
  "  Mars Trek catalogue record above and has not been verified against another source.",
  "",
);

writeFileSync(OUT, out.join("\n"));
console.log(`third-party notices: ${SHIPPED.length} components, Sol Atlas, three.js, Geist, template files, data → ${path.relative(ROOT, OUT)} (${(Buffer.byteLength(out.join("\n")) / 1024).toFixed(1)} KiB)`);
