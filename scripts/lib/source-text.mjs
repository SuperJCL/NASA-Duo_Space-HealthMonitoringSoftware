/**
 * Shared helpers for the live source checks (verify-citations, verify-briefing):
 * fetch with curl (honours the HTTPS proxy), extract text, normalise it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…", deg: "°" };
export const decodeEntities = (t) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return NAMED[e.toLowerCase()] ?? m;
  });
export const htmlToText = (html) =>
  decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
export const normalise = (t) => t.normalize("NFKC").replace(/­/g, "").replace(/\s+/g, " ");

export const fetchTo = (url, file, agent = "MDI-citation-check") =>
  execFileSync("curl", ["-sSfL", "--max-time", "600", "-A", agent, "-o", file, url]);
export const isPdf = (file) => readFileSync(file).subarray(0, 5).toString() === "%PDF-";
export const pdfText = (file) => execFileSync("pdftotext", [file, "-"], { maxBuffer: 1 << 30 }).toString();
