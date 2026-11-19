#!/usr/bin/env node
// Builds the static site for the separate Vercel project (myomars-patch-demo) from the teammate's
// verified package, without changing it:
//   1. checks the ZIP against myomars-flexarray-45s-demo.zip.sha256;
//   2. extracts only the package's prebuilt frontend (frontend/dist/) into site/;
//   3. checks every extracted file against the package's own MANIFEST.sha256 (and the ZIP CRC-32);
//   4. adds the third-party notices that sit next to the package (THIRD-PARTY-NOTICES.txt, made by
//      scripts/build-third-party-notices.mjs for this exact ZIP) as site/third-party-notices.txt.
//      The package's files are not changed; the notices file is an extra file beside them.
// The TypeScript sources stay inside the ZIP, so this repository's root tsconfig, ESLint and Next.js
// build never see them. No dependencies (Node.js 20+), no network, no Python.
//
//   node scripts/build-site.mjs        (run from myomars-flexarray-demo/; Vercel runs the same)
//   node scripts/build-site.mjs --without-notices   (only to regenerate the notices for a new ZIP)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ZIP = path.join(ROOT, "myomars-flexarray-45s-demo.zip");
const OUT = path.join(ROOT, "site");
const PACKAGE_DIR = "myomars-flexarray-45s-demo/";
const DIST = `${PACKAGE_DIR}frontend/dist/`;
const MANIFEST = `${PACKAGE_DIR}MANIFEST.sha256`;

const fail = (message) => {
  console.error(`build-site: ${message}`);
  process.exit(1);
};
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// 1. The ZIP is the one the teammate verified.
const zip = readFileSync(ZIP);
const expected = readFileSync(`${ZIP}.sha256`, "utf8").trim().split(/\s+/)[0];
if (sha256(zip) !== expected) fail(`checksum mismatch for ${path.basename(ZIP)} (expected ${expected})`);

// 2. Read the ZIP's central directory (stored and deflated entries; no ZIP64, no encryption).
const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (eocd < 0) fail("not a ZIP file (end of central directory not found)");
const count = zip.readUInt16LE(eocd + 10);
let at = zip.readUInt32LE(eocd + 16);
const entries = new Map();
for (let i = 0; i < count; i++) {
  if (zip.readUInt32LE(at) !== 0x02014b50) fail("corrupt central directory");
  const flags = zip.readUInt16LE(at + 8);
  const method = zip.readUInt16LE(at + 10);
  const crc = zip.readUInt32LE(at + 16);
  const compressed = zip.readUInt32LE(at + 20);
  const size = zip.readUInt32LE(at + 24);
  const nameLength = zip.readUInt16LE(at + 28);
  const extraLength = zip.readUInt16LE(at + 30);
  const commentLength = zip.readUInt16LE(at + 32);
  const local = zip.readUInt32LE(at + 42);
  const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
  at += 46 + nameLength + extraLength + commentLength;
  if (flags & 1) fail(`${name}: encrypted entries are not supported`);
  if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) fail(`${name}: ZIP64 is not supported`);
  if (!name.endsWith("/")) entries.set(name, { method, crc, compressed, size, local });
}

const read = (name) => {
  const e = entries.get(name);
  if (!e) fail(`${name} is missing from the package`);
  if (zip.readUInt32LE(e.local) !== 0x04034b50) fail(`${name}: corrupt local header`);
  const start = e.local + 30 + zip.readUInt16LE(e.local + 26) + zip.readUInt16LE(e.local + 28);
  const raw = zip.subarray(start, start + e.compressed);
  const data = e.method === 0 ? Buffer.from(raw) : e.method === 8 ? zlib.inflateRawSync(raw) : fail(`${name}: compression method ${e.method} is not supported`);
  if (data.length !== e.size) fail(`${name}: size mismatch`);
  if (typeof zlib.crc32 === "function" && zlib.crc32(data) >>> 0 !== e.crc) fail(`${name}: CRC-32 mismatch`);
  return data;
};

// 3. Extract frontend/dist/ and check each file against the package's manifest.
const manifest = new Map(
  read(MANIFEST)
    .toString("utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.split(/\s+/);
      return [rest.join(" ").replace(/^\.\//, ""), hash];
    }),
);
const files = [...entries.keys()].filter((name) => name.startsWith(DIST)).sort();
if (!files.includes(`${DIST}index.html`)) fail("frontend/dist/index.html is missing from the package");

rmSync(OUT, { recursive: true, force: true });
let bytes = 0;
for (const name of files) {
  const rel = name.slice(DIST.length);
  const target = path.resolve(OUT, rel);
  if (!target.startsWith(OUT + path.sep)) fail(`${name}: path leaves the output folder`);
  const data = read(name);
  const listed = manifest.get(name.slice(PACKAGE_DIR.length));
  if (!listed) fail(`${name} is not listed in MANIFEST.sha256`);
  if (sha256(data) !== listed) fail(`${name}: SHA-256 does not match MANIFEST.sha256`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, data);
  bytes += data.length;
}
// 4. Third-party notices for this exact package, copied beside the package's files.
const NOTICES = path.join(ROOT, "THIRD-PARTY-NOTICES.txt");
if (!process.argv.includes("--without-notices")) {
  if (!existsSync(NOTICES)) fail("THIRD-PARTY-NOTICES.txt is missing (see scripts/build-third-party-notices.mjs)");
  const notices = readFileSync(NOTICES);
  if (!notices.toString("utf8").includes(`SHA-256: ${expected}`)) fail("THIRD-PARTY-NOTICES.txt was made for another package; regenerate it (scripts/build-third-party-notices.mjs)");
  writeFileSync(path.join(OUT, "third-party-notices.txt"), notices);
}

console.log(`build-site: ${files.length} files (${(bytes / 1024).toFixed(0)} KiB) from the verified package → ${path.relative(process.cwd(), OUT) || "."}/`);
console.log(`build-site: package SHA-256 ${expected.slice(0, 12)}…, every file matches MANIFEST.sha256`);
