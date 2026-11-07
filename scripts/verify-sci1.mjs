#!/usr/bin/env node
/**
 * Verify the SCI-1 candidate evidence (src/data/scenarios/jezero-margin-unit.sci1-proposals.json)
 * against the live sources:
 *   1. every quote occurs verbatim in its source (HTML stripped, PDF via pdftotext, normalised);
 *   2. PDS Initial Reports quotes lie inside the named sample report and section,
 *      with the page labels printed;
 *   3. for the locator-correction proposal, each quoted sentence is reported with the
 *      sample report(s) it actually occurs in.
 *
 *   npm run verify:sci1            (SCI1_PDF=/path/vol4.pdf to reuse a downloaded PDF)
 *
 * These are candidate records, all pending: a verified quote is not a scientific approval.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageAt, splitReports } from "./lib/pds-reports.mjs";
import { fetchTo, htmlToText, isPdf, normalise, pdfText } from "./lib/source-text.mjs";

const root = new URL("..", import.meta.url).pathname;
const sources = JSON.parse(readFileSync(join(root, "src/data/sources.json"), "utf8"));
const data = JSON.parse(readFileSync(join(root, "src/data/scenarios/jezero-margin-unit.sci1-proposals.json"), "utf8"));
const briefing = JSON.parse(readFileSync(join(root, "src/data/briefings/lefroy-bay.json"), "utf8"));
const HEADINGS = briefing.report.sections; // the Initial Reports' common section headings
const PDS = "pds-m2020-initial-reports-vol4";

let failures = 0;
const fail = (m) => {
  failures++;
  console.log(`FAIL  ${m}`);
};
const work = mkdtempSync(join(tmpdir(), "mdi-sci1-"));
const texts = new Map();
const textOf = (sourceId) => {
  if (texts.has(sourceId)) return texts.get(sourceId);
  const s = sources.find((x) => x.id === sourceId);
  let file = sourceId === PDS && process.env.SCI1_PDF ? process.env.SCI1_PDF : join(work, `${sourceId}.bin`);
  if (!(sourceId === PDS && process.env.SCI1_PDF)) {
    console.log(`INFO  downloading ${s.url}`);
    fetchTo(s.url, file);
  }
  const raw = isPdf(file) ? pdfText(file) : htmlToText(readFileSync(file, "utf8"));
  const t = { raw, norm: normalise(raw) };
  texts.set(sourceId, t);
  return t;
};
/** The section (from the common headings) in force at offset `i` of a report's text. */
const sectionAt = (text, i) => {
  let best = null;
  for (const h of HEADINGS) {
    const n = normalise(h);
    for (let j = text.indexOf(n); j >= 0 && j <= i; j = text.indexOf(n, j + 1)) if (!best || j > best.at) best = { heading: h, at: j };
  }
  return best?.heading ?? null;
};

try {
  let reports = null;
  for (const e of data.evidence) {
    const t = textOf(e.sourceId);
    const q = normalise(e.quote).trim();
    if (!t.norm.includes(q)) {
      fail(`${e.id}: quote not found in ${e.sourceId}`);
      continue;
    }
    if (e.sourceId !== PDS) {
      console.log(`OK    ${e.id} · ${e.sourceId}`);
      continue;
    }
    reports ??= splitReports(t.raw);
    const r = reports.get(e.report.pagePrefix);
    const at = r ? r.text.indexOf(q) : -1;
    if (at < 0) {
      const where = [...reports.entries()].filter(([, x]) => x.text.includes(q)).map(([k, x]) => `${k} (${x.title})`);
      fail(`${e.id}: not in report ${e.report.pagePrefix}; found in ${where.join(", ") || "no single report (spans a page break?)"}`);
      continue;
    }
    const section = sectionAt(r.text, at);
    if (section !== e.report.section) fail(`${e.id}: in section "${section}", not "${e.report.section}"`);
    else {
      const p1 = pageAt(r, at);
      const p2 = pageAt(r, at + q.length - 1);
      console.log(`OK    ${e.id} · ${r.title} · ${section} · p. ${p1 === p2 ? p1 : `${p1}–${p2}`}`);
    }
  }
  // 3. Locator correction: where each quote actually is.
  for (const pr of data.proposals.filter((x) => x.type === "locator-correction")) {
    reports ??= splitReports(textOf(PDS).raw);
    for (const c of pr.subject.citations) {
      const q = normalise(c.quote).trim();
      const where = [...reports.entries()].filter(([, x]) => x.text.includes(q)).map(([, x]) => x.title);
      const claimed = /Pelican Point/.test(c.currentLocator) ? "M2020-923-25 Pelican Point" : null;
      const inClaimed = claimed ? where.includes(claimed) : false;
      console.log(`${inClaimed ? "OK  " : "NOTE"}  ${pr.id} · ${c.where}: locator says "${c.currentLocator}"; quote found in: ${where.join(", ") || "none"}`);
      if (!where.length) fail(`${pr.id}: quote not found in any report`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} problem(s).` : `\n${data.evidence.length} SCI-1 evidence quote(s) verified, 0 problem(s).`);
process.exit(failures ? 1 : 0);
