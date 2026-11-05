import type { Source } from "@/lib/evidence/schema";
import type { GeoCatalog } from "@/lib/geo/schema";
import { TOPIC_CLASSIFICATIONS, type Briefing } from "./schema";

/**
 * Offline consistency rules for a briefing (BR-1). The live, section-scoped
 * quote check is `npm run verify:briefing`. Each rule returns a readable
 * problem; an empty list means the data passes.
 */

/** Operations already performed at a sample site; the briefing must state each one. */
export const REQUIRED_DONE = ["imaged", "abraded", "cored", "sealed"] as const;
const OPERATION_WORDS = /\b(abrad\w*|drill\w*|cor(e|ed|ing)\b|seal\w*|re-?image\w*|re-?sampl\w*)/i;

export function checkBriefingIntegrity(b: Briefing, geo: GeoCatalog, sources: readonly Source[]): string[] {
  const problems: string[] = [];
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const itemById = new Map(b.items.map((i) => [i.id, i]));
  const otherTitles = new Set(b.report.otherReports.map((r) => r.title));

  const location = geo.records.find((r) => r.id === b.locationId);
  if (!location || location.kind !== "sample-site") problems.push(`location ${b.locationId} is not a sample site in the geo catalog`);
  else if (!b.report.title.startsWith(location.designation.split(" ")[0])) problems.push(`report ${b.report.title} does not match sample ${location.designation}`);

  const ids = [...b.items.map((i) => i.id), ...b.quarantine.map((q) => q.id), ...b.sourceNotes.map((n) => n.id)];
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) problems.push(`duplicate ids: ${[...new Set(dup)].join(", ")}`);

  const why = itemById.get(b.whyItMattersItemId);
  if (!why || why.topic !== "why-here") problems.push("whyItMattersItemId must point to a why-here item");
  const key = itemById.get(b.keyQuestionItemId);
  if (!key || key.classification !== "open-question" || key.scope !== "sample") problems.push("keyQuestionItemId must point to a sample-scoped open question");

  const quarantined = new Set(b.quarantine.map((q) => q.quote));
  const pagePrefix = `${b.report.pagePrefix}-`;

  for (const item of b.items) {
    const where = item.id;
    if (item.locationId !== b.locationId) problems.push(`${where}: locationId ${item.locationId} ≠ briefing location`);
    if (!TOPIC_CLASSIFICATIONS[item.topic].includes(item.classification)) problems.push(`${where}: classification ${item.classification} not allowed in topic ${item.topic}`);

    for (const c of item.citations) {
      const s = sourceById.get(c.sourceId);
      if (!s) problems.push(`${where}: unknown source ${c.sourceId}`);
      else if (s.url !== c.sourceUrl) problems.push(`${where}: sourceUrl differs from the source record`);
      if (quarantined.has(c.quote)) problems.push(`${where}: uses a quarantined quote`);
      const isReport = c.sourceId === b.report.sourceId;
      if (isReport && (!c.section || !b.report.sections.includes(c.section))) problems.push(`${where}: report citation needs a known section`);
      if (isReport && (c.pages.length === 0 || c.pages.some((p) => !p.startsWith(pagePrefix)))) problems.push(`${where}: report pages must be ${pagePrefix}N labels`);
      if (!isReport && (c.section !== null || c.pages.length)) problems.push(`${where}: non-report citations carry no section or pages`);
      for (const t of c.sharedWith) if (!otherTitles.has(t)) problems.push(`${where}: sharedWith names unknown report ${t}`);
    }

    // Shared wording is never presented as specific to this rock.
    const shared = item.citations.filter((c) => c.sharedWith.length > 0);
    if (item.scope === "sample" && item.classification !== "simulated-idea" && !item.citations.some((c) => c.sharedWith.length === 0)) {
      problems.push(`${where}: a sample-scoped claim needs at least one quote unique to this report`);
    }
    for (const c of shared) {
      for (const t of c.sharedWith) {
        if (!item.limitations.some((l) => l.includes(t))) problems.push(`${where}: limitations must say the wording is shared with ${t}`);
      }
      if (item.scope === "sample" && item.classification !== "simulated-idea") problems.push(`${where}: shared wording requires margin-unit scope`);
    }

    if (item.classification === "proposed-by-source") {
      if (!item.limitations.some((l) => /not guaranteed/.test(l))) problems.push(`${where}: must state that sample return is not guaranteed`);
      if (!item.limitations.some((l) => /not an approved NASA mission activity/.test(l))) problems.push(`${where}: must state it is not an approved NASA activity`);
      if (!/^If the sample reaches Earth/.test(item.claim)) problems.push(`${where}: claim must state its condition up front`);
    }

    if (item.provenance.kind === "mdi-simulated-idea") {
      if (item.classification !== "simulated-idea") problems.push(`${where}: MDI provenance requires the simulated-idea classification`);
      if (!/^Simulated idea:/.test(item.claim)) problems.push(`${where}: claim must start with "Simulated idea:"`);
      if (!item.limitations.some((l) => /not a NASA plan/.test(l))) problems.push(`${where}: must say it is not a NASA plan`);
      for (const id of item.provenance.addressesItemIds) {
        if (itemById.get(id)?.classification !== "open-question") problems.push(`${where}: addresses ${id}, which is not an open question`);
      }
      // No repeat of operations already performed, unless a rationale says why (none in BR-1).
      const opWords = item.claim.match(OPERATION_WORDS);
      if (opWords && !/No new rover operation/.test(item.claim)) problems.push(`${where}: proposes an operation (${opWords[0]}) that was already performed here`);
    } else if (item.classification === "simulated-idea") {
      problems.push(`${where}: simulated ideas need MDI provenance with pending review`);
    }
  }

  // Already performed operations must be stated.
  const done = b.items.filter((i) => i.topic === "already-done").map((i) => i.claim.toLowerCase());
  const has = (re: RegExp) => done.some((c) => re.test(c));
  if (!has(/imaged/)) problems.push("already-done must state the imaging");
  if (!has(/abrasion/)) problems.push("already-done must state the abrasion");
  if (!has(/drilled|core/)) problems.push("already-done must state the drilling/coring");
  if (!has(/sealed/)) problems.push("already-done must state the sealing");

  for (const q of b.quarantine) {
    if (q.pages.some((p) => !p.startsWith(pagePrefix)) || !b.report.sections.includes(q.section)) problems.push(`quarantine ${q.id}: bad section or pages`);
  }
  for (const n of b.sourceNotes) {
    if (n.pages.some((p) => !p.startsWith(pagePrefix)) || !b.report.sections.includes(n.section)) problems.push(`source note ${n.id}: bad section or pages`);
  }
  return problems;
}
