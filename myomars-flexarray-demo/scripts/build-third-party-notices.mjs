#!/usr/bin/env node
// Regenerates myomars-flexarray-demo/THIRD-PARTY-NOTICES.txt, the third-party notices of the FlexArray
// demo site. Developer tool, run by hand when the teammate's package changes. Vercel never runs it:
// scripts/build-site.mjs only copies the committed file into site/.
//
// It works from the package itself:
//   1. Builds the package's frontend with its own Vite config and locked dependencies, with a plugin
//      that records every bundled module. This happens in a temporary output folder.
//   2. Checks that this build is byte-identical to the site that is deployed (site/, made by
//      build-site.mjs from the ZIP). So the list below is exactly what the site contains.
//   3. Writes, per bundled npm package, its version, licence and full licence text, read from the
//      installed package. Packages that ship no licence file get the text from third-party/, copied
//      verbatim from their repository at the release tag (see third-party/SOURCES.json).
//
// Usage (needs network for npm ci):
//   node scripts/build-site.mjs
//   unzip myomars-flexarray-45s-demo.zip -d /tmp/fa && (cd /tmp/fa/myomars-flexarray-45s-demo/frontend && npm ci)
//   node scripts/build-third-party-notices.mjs --frontend /tmp/fa/myomars-flexarray-45s-demo/frontend
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const OUT = path.join(ROOT, "THIRD-PARTY-NOTICES.txt");
const SUPPLEMENT = path.join(ROOT, "third-party");
const fail = (m) => {
  console.error(`flexarray notices: ${m}`);
  process.exit(1);
};
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const rule = (c = "=") => c.repeat(78);

const arg = process.argv.indexOf("--frontend");
const FRONTEND = arg > 0 ? path.resolve(process.argv[arg + 1]) : fail("usage: --frontend <unzipped package>/frontend (after npm ci)");
if (!existsSync(path.join(FRONTEND, "node_modules/vite"))) fail(`${FRONTEND} has no installed dependencies (run npm ci there)`);
if (!existsSync(path.join(SITE, "index.html"))) fail("site/ is missing (run node scripts/build-site.mjs first)");
const zipSha = readFileSync(path.join(ROOT, "myomars-flexarray-45s-demo.zip.sha256"), "utf8").trim().split(/\s+/)[0];

// 1. Recording build with the package's own config, into a temporary folder.
const tmp = mkdtempSync(path.join(os.tmpdir(), "flexarray-notices-"));
const modules = {};
const { build } = await import(pathToFileURL(path.join(FRONTEND, "node_modules/vite/dist/node/index.js")).href);
process.chdir(FRONTEND); // the package's Vite plugin resolves public/sw.js from the working directory
await build({
  root: FRONTEND,
  configFile: path.join(FRONTEND, "vite.config.ts"),
  logLevel: "warn",
  build: { outDir: tmp, emptyOutDir: true },
  plugins: [{ name: "record-bundled-modules", generateBundle(_, bundle) { for (const [file, c] of Object.entries(bundle)) if (c.type === "chunk") modules[file] = Object.keys(c.modules); } }],
});

// 2. Byte-identical to the deployed site?
const list = (dir, base = dir) => readdirSync(dir).flatMap((e) => (statSync(path.join(dir, e)).isDirectory() ? list(path.join(dir, e), base) : [path.relative(base, path.join(dir, e))])).sort();
const built = list(tmp);
const deployed = list(SITE).filter((f) => f !== "third-party-notices.txt");
if (JSON.stringify(built) !== JSON.stringify(deployed)) fail(`the rebuild has different files than site/: ${built.join(", ")} vs ${deployed.join(", ")}`);
for (const f of built) if (sha256(readFileSync(path.join(tmp, f))) !== sha256(readFileSync(path.join(SITE, f)))) fail(`${f} differs from the deployed site/ copy; this frontend is not the deployed build`);
rmSync(tmp, { recursive: true, force: true });

// 3. Packages in the bundles.
const packages = new Map();
for (const [file, ids] of Object.entries(modules)) {
  for (const id of ids) {
    const u = id.replace(/^\0/, "").split("?")[0];
    const i = u.lastIndexOf("node_modules/");
    if (i < 0) continue;
    const rest = u.slice(i + 13).split("/");
    const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
    const dir = u.slice(0, i + 13) + name;
    const p = packages.get(dir) ?? { files: new Set(), count: 0 };
    p.files.add(file);
    p.count++;
    packages.set(dir, p);
  }
}
const supplement = JSON.parse(readFileSync(path.join(SUPPLEMENT, "SOURCES.json"), "utf8")).files;
const supplementFor = (id) => Object.entries(supplement).find(([, v]) => v.package === id);
const licenceFiles = (dir) => readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f) && statSync(path.join(dir, f)).isFile()).sort();
const repoUrl = (j) => (typeof j.repository === "string" ? j.repository : j.repository?.url ?? j.homepage ?? null);

const entries = [];
for (const [dir, p] of packages) {
  const j = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const texts = licenceFiles(dir).map((f) => ({ label: `${j.name}/${f} (npm package)`, text: readFileSync(path.join(dir, f), "utf8") }));
  if (!texts.length) {
    const s = supplementFor(`${j.name}@${j.version}`) ?? fail(`${j.name}@${j.version} ships no licence file and has no verified text in third-party/`);
    const text = readFileSync(path.join(SUPPLEMENT, s[0]), "utf8");
    if (sha256(text) !== s[1].sha256) fail(`third-party/${s[0]} does not match its recorded SHA-256`);
    texts.push({ label: `${s[1].url} (${s[1].reason})`, text });
  }
  entries.push({ name: j.name, version: j.version, licence: j.license ?? JSON.stringify(j.licenses), repo: repoUrl(j), files: [...p.files].sort(), count: p.count, texts });
}
// Tailwind CSS generates the base styles and utilities in assets/index-*.css (no JS module).
const tw = path.join(FRONTEND, "node_modules/tailwindcss");
const twj = JSON.parse(readFileSync(path.join(tw, "package.json"), "utf8"));
const cssFiles = built.filter((f) => /\.css$/.test(f) && /--tw-|::file-selector-button/.test(readFileSync(path.join(SITE, f), "utf8")));
entries.push({ name: twj.name, version: twj.version, licence: twj.license, repo: repoUrl(twj), files: cssFiles, css: true, texts: licenceFiles(tw).map((f) => ({ label: `${twj.name}/${f} (npm package)`, text: readFileSync(path.join(tw, f), "utf8") })) });
entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

// 4. Write the file.
const out = [];
const w = (...l) => out.push(...l);
w(
  "THIRD-PARTY NOTICES — MyoMars FlexArray-MN 45-second demo website",
  "",
  `Package: myomars-flexarray-45s-demo.zip  SHA-256: ${zipSha}`,
  "",
  "This file lists the third-party software that the FlexArray demo site distributes, with the",
  "copyright notices and full licence texts of each component. It sits next to the teammate's",
  "unchanged package: the site is the package's prebuilt frontend, and this file is added beside it.",
  "",
  "How the list was made: the package's frontend was rebuilt with its own configuration and locked",
  "dependencies, the rebuild was byte-identical to the deployed files, and every bundled module was",
  "recorded. Versions and licence texts come from the installed packages (or, where a package ships",
  "no licence file, from its source repository at the release tag; see third-party/SOURCES.json).",
  "The site ships no font files (it uses system fonts).",
  "",
  "It does not grant any licence for the package's own code, models or images: their licensing has",
  "not been confirmed by the rights holder, and this file does not resolve it.",
  "",
  `${entries.length} components:`,
  ...entries.map((e) => `  ${e.name} ${e.version} (${e.licence})`),
  "",
);
const seen = new Map();
for (const e of entries) {
  w(rule("-"), e.name, `  version:  ${e.version}`, `  licence:  ${e.licence}`);
  if (e.repo) w(`  source:   ${e.repo.replace(/^git\+/, "")}`);
  w(`  used in:  ${e.css ? "stylesheet " : ""}${e.files.join(", ")}`, "");
  for (const t of e.texts) {
    const text = t.text.replace(/\s+$/, "");
    const key = sha256(text);
    if (seen.has(key)) {
      w(`  Licence text: identical to the text shown for ${seen.get(key)} above.`, "");
      continue;
    }
    seen.set(key, `${e.name} ${e.version}`);
    w(`  --- ${t.label} ---`, text, "");
  }
}
writeFileSync(OUT, out.join("\n") + "\n");
console.log(`flexarray notices: ${entries.length} components; rebuild identical to site/ (${built.length} files) → ${path.relative(process.cwd(), OUT)}`);
