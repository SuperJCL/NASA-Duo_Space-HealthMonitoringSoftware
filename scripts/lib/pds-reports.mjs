/**
 * PDS Mars 2020 Initial Reports: split pdftotext output into sample reports
 * keyed by page-label prefix (e.g. "27" = M2020-1088-27), with page offsets.
 * Shared by verify-briefing.mjs and verify-sci1.mjs.
 */
import { normalise } from "./source-text.mjs";

/** Splits pdftotext output into sample reports keyed by page-label prefix. */
export function splitReports(text) {
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

export const pageAt = (report, offset) => {
  let label = report.offsets[0][1];
  for (const [o, l] of report.offsets) if (o <= offset) label = l;
  return label;
};
