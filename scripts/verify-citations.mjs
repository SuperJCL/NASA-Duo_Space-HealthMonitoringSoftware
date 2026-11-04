#!/usr/bin/env node
/**
 * Re-verify every citation quote in the curated evidence data against the
 * live source documents.
 *
 *   npm run verify:citations                 # all sources
 *   VERIFY_SKIP=pds-m2020-initial-reports-vol4 npm run verify:citations   # skip large downloads
 *
 * For each source, fetches `fullTextUrls` (or `url`) with curl, extracts text
 * (HTML tags stripped; PDFs via `pdftotext`), normalises whitespace/Unicode,
 * and checks that every quote citing that source occurs verbatim.
 * Exit code 1 if any quote is missing or any source cannot be fetched.
 *
 * Requires: curl, and pdftotext (poppler-utils) for PDF sources.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const sources = JSON.parse(readFileSync(join(root, "src/data/sources.json"), "utf8"));
const scenario = JSON.parse(
  readFileSync(join(root, "src/data/scenarios/jezero-margin-unit.json"), "utf8"),
);
const skip = new Set((process.env.VERIFY_SKIP ?? "").split(",").filter(Boolean));

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…", deg: "°" };
const decodeEntities = (t) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return NAMED[e.toLowerCase()] ?? m;
  });
const htmlToText = (html) =>
  decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
const normalise = (t) => t.normalize("NFKC").replace(/­/g, "").replace(/\s+/g, " ");

// Collect quotes by source.
const quotesBySource = new Map();
const add = (record, citations) => {
  for (const c of citations ?? []) {
    if (!quotesBySource.has(c.sourceId)) quotesBySource.set(c.sourceId, []);
    quotesBySource.get(c.sourceId).push({ record, quote: c.quote });
  }
};
add("site", scenario.site.citations);
for (const o of scenario.observations) add(o.id, o.citations);
for (const i of scenario.interpretations) add(i.id, i.citations);
for (const g of scenario.gaps) if (g.origin.kind === "cited") add(g.id, g.origin.citations);
for (const a of scenario.assumptions) add(a.id, a.citations);

const work = mkdtempSync(join(tmpdir(), "mdi-verify-"));
let failures = 0;
let checked = 0;
try {
  for (const source of sources) {
    const quotes = quotesBySource.get(source.id) ?? [];
    if (skip.has(source.id)) {
      console.log(`SKIP  ${source.id} (${quotes.length} quotes)`);
      continue;
    }
    let text = "";
    for (const [n, url] of (source.fullTextUrls ?? [source.url]).entries()) {
      const file = join(work, `${source.id}-${n}`);
      try {
        execFileSync("curl", ["-sSfL", "--max-time", "600", "-A", "MDI-citation-check", "-o", file, url]);
      } catch {
        console.log(`FAIL  ${source.id}: could not fetch ${url}`);
        failures++;
        continue;
      }
      const isPdf = readFileSync(file).subarray(0, 5).toString() === "%PDF-";
      text += " " + (isPdf
        ? execFileSync("pdftotext", [file, "-"], { maxBuffer: 1 << 30 }).toString()
        : htmlToText(readFileSync(file, "utf8")));
    }
    const haystack = normalise(text);
    for (const { record, quote } of quotes) {
      checked++;
      const ok = haystack.includes(normalise(quote));
      if (!ok) failures++;
      console.log(`${ok ? "OK  " : "MISS"}  ${source.id} ← ${record}: “${quote.slice(0, 60)}…”`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${checked} quote(s) checked, ${failures} problem(s).`);
process.exit(failures ? 1 : 0);
