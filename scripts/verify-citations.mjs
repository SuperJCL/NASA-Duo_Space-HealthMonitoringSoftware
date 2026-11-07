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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchTo, htmlToText, isPdf, normalise, pdfText } from "./lib/source-text.mjs";

const root = new URL("..", import.meta.url).pathname;
const sources = JSON.parse(readFileSync(join(root, "src/data/sources.json"), "utf8"));
const scenario = JSON.parse(
  readFileSync(join(root, "src/data/scenarios/jezero-margin-unit.json"), "utf8"),
);
const registry = JSON.parse(
  readFileSync(join(root, "src/data/scenarios/jezero-margin-unit.reviews.json"), "utf8"),
);
const skip = new Set((process.env.VERIFY_SKIP ?? "").split(",").filter(Boolean));

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
for (const g of scenario.gaps) {
  if (g.origin.kind === "cited") add(g.id, g.origin.citations);
  if (g.priority) add(`${g.id} (priority)`, g.priority.citations);
}
for (const a of scenario.assumptions) add(a.id, a.citations);
for (const t of scenario.tasks) for (const l of t.addresses) add(`${t.id} → ${l.gapId}`, l.citations);
for (const a of scenario.discriminationAssessments ?? []) add(a.id, a.citations);
// Review-registry evidence (RI-1): verified quotes, which are NOT scientific approvals.
for (const e of registry.entries) add(`review ${e.id}`, e.evidence);
// Geographic records and coordinate conventions (MF-0).
const geo = JSON.parse(readFileSync(join(root, "src/data/geo/jezero-geo.json"), "utf8"));
for (const c of geo.conventions) add(`geo convention ${c.id}`, c.citations);
for (const r of geo.records) add(`geo ${r.id}`, r.citations);
// Location briefings (BR-1): presence here; section scope in verify-briefing.mjs.
const briefing = JSON.parse(readFileSync(join(root, "src/data/briefings/lefroy-bay.json"), "utf8"));
for (const i of briefing.items) add(`briefing ${i.id}`, i.citations);
// SCI-1 candidate evidence (pending proposals, not engine inputs): presence here;
// report and section scope in verify-sci1.mjs.
const sci1 = JSON.parse(readFileSync(join(root, "src/data/scenarios/jezero-margin-unit.sci1-proposals.json"), "utf8"));
for (const e of sci1.evidence) add(`sci1 ${e.id}`, [e]);

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
        fetchTo(url, file);
      } catch {
        console.log(`FAIL  ${source.id}: could not fetch ${url}`);
        failures++;
        continue;
      }
      text += " " + (isPdf(file) ? pdfText(file) : htmlToText(readFileSync(file, "utf8")));
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
