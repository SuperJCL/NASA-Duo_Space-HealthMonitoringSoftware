#!/usr/bin/env node
/**
 * Section-scoped live verification of location briefings (BR-1).
 *
 *   npm run verify:briefing
 *   BRIEFING_PDF=/path/to/initial_reports_volume4.pdf npm run verify:briefing   # reuse a local copy
 *
 * For each quote taken from the PDS initial report, this checks that it:
 *  1. occurs inside THIS sample's report (pages labelled "<prefix>-N"), not
 *     merely somewhere in the volume;
 *  2. lies in the declared section (from its heading to the next heading);
 *  3. lies on the declared page label(s);
 *  4. is, or is not, also printed in other sample reports, exactly as declared
 *     in `sharedWith`. This catches text shared with e.g. Pelican Point.
 *
 * Quarantined statements and source notes are located the same way, so their
 * documentation stays accurate. Quotes from other sources (web pages) are
 * checked for presence. Exit code 1 on any problem.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchTo, htmlToText, normalise, pdfText } from "./lib/source-text.mjs";

const root = new URL("..", import.meta.url).pathname;
const sources = JSON.parse(readFileSync(join(root, "src/data/sources.json"), "utf8"));
const briefings = ["lefroy-bay"].map((f) => JSON.parse(readFileSync(join(root, `src/data/briefings/${f}.json`), "utf8")));

let failures = 0;
let checked = 0;
const fail = (msg) => {
  failures++;
  console.log(`FAIL  ${msg}`);
};

/** Splits pdftotext output into sample reports keyed by page-label prefix. */
function splitReports(text) {
  const reports = new Map(); // prefix -> { title, pages: [{ label, body }] }
  for (const page of text.split("\f")) {
    const lines = page.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const m = /^(\d+)-(\d+)$/.exec(lines.at(-1).trim());
    if (!m) continue;
    const prefix = m[1];
    let body = lines.slice(0, -1);
    let title = null;
    if (body.length && new RegExp(`^M2020-\\d+-${prefix} `).test(body[0].trim())) {
      title = body[0].trim();
      body = body.slice(1);
    }
    if (!reports.has(prefix)) reports.set(prefix, { title: null, pages: [] });
    const r = reports.get(prefix);
    r.title ??= title;
    r.pages.push({ label: lines.at(-1).trim(), body: normalise(body.join(" ")).trim() });
  }
  for (const r of reports.values()) {
    let text = "";
    r.offsets = [];
    for (const p of r.pages) {
      r.offsets.push([text.length, p.label]);
      text += p.body + " ";
    }
    r.text = text;
  }
  return reports;
}

function sectionSpans(text, headings) {
  const found = [];
  let start = 0;
  for (const h of headings) {
    const i = text.indexOf(normalise(h), start);
    if (i < 0) {
      fail(`section heading not found: "${h}"`);
      continue;
    }
    found.push([h, i]);
    start = i + 1;
  }
  return found.map(([h, i], n) => ({ heading: h, start: i, end: n + 1 < found.length ? found[n + 1][1] : text.length }));
}

const pageAt = (report, offset) => {
  let label = report.offsets[0][1];
  for (const [o, l] of report.offsets) if (o <= offset) label = l;
  return label;
};

function locate(report, spans, quote) {
  const n = normalise(quote).trim();
  const hits = [];
  for (let i = report.text.indexOf(n); i >= 0; i = report.text.indexOf(n, i + 1)) {
    const span = spans.find((s) => s.start <= i && i < s.end);
    const first = pageAt(report, i);
    const last = pageAt(report, i + n.length - 1);
    hits.push({ section: span?.heading ?? null, pages: first === last ? [first] : [first, last] });
  }
  return { n, hits };
}

const work = mkdtempSync(join(tmpdir(), "mdi-briefing-"));
try {
  for (const b of briefings) {
    const reportSource = sources.find((s) => s.id === b.report.sourceId);
    let pdf = process.env.BRIEFING_PDF;
    if (!pdf) {
      pdf = join(work, "report.pdf");
      console.log(`INFO  downloading ${reportSource.url}`);
      fetchTo(reportSource.url, pdf);
    }
    const reports = splitReports(pdfText(pdf));
    const report = reports.get(b.report.pagePrefix);
    if (!report) {
      fail(`${b.id}: no pages labelled ${b.report.pagePrefix}-N in the PDF`);
      continue;
    }
    if (report.title !== b.report.title) fail(`${b.id}: report title is "${report.title}", expected "${b.report.title}"`);
    console.log(`INFO  ${b.report.title}: ${report.pages.length} labelled pages`);
    for (const o of b.report.otherReports) {
      if (reports.get(o.pagePrefix)?.title !== o.title) fail(`${b.id}: other report ${o.pagePrefix} is not "${o.title}"`);
    }
    const spans = sectionSpans(report.text, b.report.sections);
    const sharedIn = (n) =>
      b.report.otherReports.filter((o) => reports.get(o.pagePrefix)?.text.includes(n)).map((o) => o.title);

    const checkLocated = (label, { quote, section, pages, sharedWith }) => {
      checked++;
      const { n, hits } = locate(report, spans, quote);
      if (!hits.length) return fail(`${label}: quote not found inside report ${b.report.id}`);
      const inSection = hits.filter((h) => h.section === section);
      if (!inSection.length) return fail(`${label}: quote is in ${hits.map((h) => h.section).join(", ")}, not "${section}"`);
      if (!inSection.some((h) => JSON.stringify(h.pages) === JSON.stringify(pages))) {
        return fail(`${label}: quote is on page(s) ${inSection.map((h) => h.pages.join("–")).join(", ")}, not ${pages.join("–")}`);
      }
      const actualShared = sharedIn(n);
      if (JSON.stringify(actualShared) !== JSON.stringify(sharedWith)) {
        return fail(`${label}: also printed in [${actualShared.join(", ")}], declared [${sharedWith.join(", ")}]`);
      }
      console.log(`OK    ${label} · ${section} · p. ${pages.join("–")}${sharedWith.length ? ` · shared with ${sharedWith.join(", ")}` : ""}`);
    };

    checkLocated(`${b.id} report date`, { quote: b.report.reportDateQuote, section: b.report.sections[0], pages: [`${b.report.pagePrefix}-1`], sharedWith: sharedIn(normalise(b.report.reportDateQuote)) });

    const webText = new Map();
    for (const item of b.items) {
      item.citations.forEach((c, k) => {
        const label = `${item.id}#${k} [${item.classification}]`;
        if (c.sourceId === b.report.sourceId) return checkLocated(label, c);
        checked++;
        if (!webText.has(c.sourceUrl)) {
          const file = join(work, `web-${webText.size}`);
          fetchTo(c.sourceUrl, file);
          webText.set(c.sourceUrl, normalise(htmlToText(readFileSync(file, "utf8"))));
        }
        if (webText.get(c.sourceUrl).includes(normalise(c.quote).trim())) console.log(`OK    ${label} · ${c.sourceUrl}`);
        else fail(`${label}: quote not found at ${c.sourceUrl}`);
      });
    }
    for (const q of b.quarantine) checkLocated(`quarantine ${q.id}`, q);
    for (const s of b.sourceNotes) checkLocated(`source note ${s.id}`, s);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${checked} location check(s), ${failures} problem(s).`);
process.exit(failures ? 1 : 0);
