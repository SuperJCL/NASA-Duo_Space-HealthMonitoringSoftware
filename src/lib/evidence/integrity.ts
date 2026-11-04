import type { Citation, Scenario, Source } from "./schema";

/**
 * Referential and temporal integrity checks that Zod's per-record schemas
 * cannot express. Returns a list of human-readable problems (empty = OK).
 *
 * Temporal rules (they protect the retrospective simulation from leakage):
 *  - A record's `availableFrom` equals the earliest `publishedOn` among the
 *    sources it cites. It cannot be public before its evidence.
 *  - An interpretation cannot rest on an observation published after it.
 *  - A gap cannot reference an interpretation published after it.
 */
export function checkScenarioIntegrity(scenario: Scenario, sources: readonly Source[]): string[] {
  const problems: string[] = [];
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const checkUnique = (label: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`duplicate ${label} id "${id}"`);
      seen.add(id);
    }
  };
  checkUnique("source", sources.map((s) => s.id));
  checkUnique(
    "record",
    [
      ...scenario.observations,
      ...scenario.interpretations,
      ...scenario.gaps,
      ...scenario.assumptions,
      ...scenario.resources,
      ...scenario.tasks,
    ].map((r) => r.id),
  );

  const earliestPublished = (where: string, citations: readonly Citation[]): string | undefined => {
    let earliest: string | undefined;
    for (const c of citations) {
      const source = sourceById.get(c.sourceId);
      if (!source) {
        problems.push(`${where}: unknown source "${c.sourceId}"`);
        continue;
      }
      if (!earliest || source.publishedOn < earliest) earliest = source.publishedOn;
    }
    return earliest;
  };

  const checkAvailableFrom = (where: string, availableFrom: string, citations: readonly Citation[]) => {
    const earliest = earliestPublished(where, citations);
    if (earliest && availableFrom !== earliest) {
      problems.push(
        `${where}: availableFrom ${availableFrom} must equal earliest cited source date ${earliest}`,
      );
    }
  };

  earliestPublished("site", scenario.site.citations);
  for (const a of scenario.assumptions) earliestPublished(`assumption ${a.id}`, a.citations);

  const observationById = new Map(scenario.observations.map((o) => [o.id, o]));
  const interpretationById = new Map(scenario.interpretations.map((i) => [i.id, i]));
  const gapIds = new Set(scenario.gaps.map((g) => g.id));
  const resourceIds = new Set(scenario.resources.map((r) => r.id));
  const assumptionIds = new Set(scenario.assumptions.map((a) => a.id));

  for (const o of scenario.observations) {
    checkAvailableFrom(`observation ${o.id}`, o.availableFrom, o.citations);
    for (const gapId of o.addressesGapIds) {
      if (!gapIds.has(gapId)) problems.push(`observation ${o.id}: unknown gap "${gapId}"`);
    }
  }

  for (const i of scenario.interpretations) {
    checkAvailableFrom(`interpretation ${i.id}`, i.availableFrom, i.citations);
    for (const obsId of i.supportingObservationIds) {
      const obs = observationById.get(obsId);
      if (!obs) problems.push(`interpretation ${i.id}: unknown observation "${obsId}"`);
      else if (obs.availableFrom > i.availableFrom) {
        problems.push(`interpretation ${i.id}: supported by later observation "${obsId}"`);
      }
    }
  }

  for (const g of scenario.gaps) {
    if (g.origin.kind === "cited") {
      checkAvailableFrom(`gap ${g.id}`, g.availableFrom, g.origin.citations);
    }
    for (const interpId of g.discriminatesInterpretationIds) {
      const interp = interpretationById.get(interpId);
      if (!interp) problems.push(`gap ${g.id}: unknown interpretation "${interpId}"`);
      else if (interp.availableFrom > g.availableFrom) {
        problems.push(`gap ${g.id}: references later interpretation "${interpId}"`);
      }
    }
  }

  for (const t of scenario.tasks) {
    for (const gapId of t.addressesGapIds) {
      if (!gapIds.has(gapId)) problems.push(`task ${t.id}: unknown gap "${gapId}"`);
    }
    for (const resourceId of Object.keys(t.costs)) {
      if (!resourceIds.has(resourceId)) problems.push(`task ${t.id}: unknown resource "${resourceId}"`);
    }
    for (const assumptionId of t.assumptionIds) {
      if (!assumptionIds.has(assumptionId)) {
        problems.push(`task ${t.id}: unknown assumption "${assumptionId}"`);
      }
    }
  }

  if (scenario.defaultSnapshotDate < scenario.minSnapshotDate) {
    problems.push("defaultSnapshotDate is before minSnapshotDate");
  }

  return problems;
}
