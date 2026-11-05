import type { Citation, Scenario, Source } from "./schema";

/**
 * Referential, temporal and epistemic integrity checks that Zod's per-record
 * schemas cannot express. Returns human-readable problems (empty = OK).
 *
 * Temporal rules (snapshot policy: "public availability"):
 *  - A record's `availableFrom` equals the LATEST `publishedOn` among the
 *    sources it cites, so no quote is ever shown before it was published.
 *  - An interpretation cannot rest on an observation published after it.
 *  - Curated items with citations (gap links, priority statements,
 *    assessments) cannot become visible before their citations do.
 *  - Site and assumption citations are always visible, so their sources must
 *    be published on or before `minSnapshotDate`.
 *
 * Epistemic rules:
 *  - Regional-context records are never local evidence: they cannot support a
 *    local interpretation, address a local gap, or be a competing hypothesis.
 *  - Discrimination assessments may only reference local hypotheses that the
 *    task's own gaps bear on, and every outcome must favor or weaken one.
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
      ...scenario.discriminationAssessments,
    ].map((r) => r.id),
  );

  const latestPublished = (where: string, citations: readonly Citation[]): string | undefined => {
    let latest: string | undefined;
    for (const c of citations) {
      const source = sourceById.get(c.sourceId);
      if (!source) {
        problems.push(`${where}: unknown source "${c.sourceId}"`);
        continue;
      }
      if (!latest || source.publishedOn > latest) latest = source.publishedOn;
    }
    return latest;
  };

  const checkAvailableFrom = (where: string, availableFrom: string, citations: readonly Citation[]) => {
    const latest = latestPublished(where, citations);
    if (latest && availableFrom !== latest) {
      problems.push(`${where}: availableFrom ${availableFrom} must equal latest cited source date ${latest}`);
    }
  };

  const checkAlwaysVisible = (where: string, citations: readonly Citation[]) => {
    const latest = latestPublished(where, citations);
    if (latest && latest > scenario.minSnapshotDate) {
      problems.push(`${where}: cites a source published ${latest}, after minSnapshotDate ${scenario.minSnapshotDate}`);
    }
  };

  checkAlwaysVisible("site", scenario.site.citations);
  for (const a of scenario.assumptions) checkAlwaysVisible(`assumption ${a.id}`, a.citations);

  const observationById = new Map(scenario.observations.map((o) => [o.id, o]));
  const interpretationById = new Map(scenario.interpretations.map((i) => [i.id, i]));
  const gapById = new Map(scenario.gaps.map((g) => [g.id, g]));
  const taskById = new Map(scenario.tasks.map((t) => [t.id, t]));
  const resourceIds = new Set(scenario.resources.map((r) => r.id));
  const assumptionIds = new Set(scenario.assumptions.map((a) => a.id));
  const contextIds = new Set(
    [...scenario.observations, ...scenario.interpretations]
      .filter((r) => r.relevance === "regional-context")
      .map((r) => r.id),
  );

  for (const o of scenario.observations) {
    checkAvailableFrom(`observation ${o.id}`, o.availableFrom, o.citations);
    if (o.observedOn && o.observedOn > o.availableFrom) {
      problems.push(`observation ${o.id}: observedOn ${o.observedOn} is after availableFrom ${o.availableFrom}`);
    }
    for (const gapId of o.addressesGapIds) {
      const gap = gapById.get(gapId);
      if (!gap) problems.push(`observation ${o.id}: unknown gap "${gapId}"`);
      else if (o.relevance === "regional-context" && gap.relevance === "local") {
        problems.push(`observation ${o.id}: regional-context record cannot address local gap "${gapId}"`);
      }
    }
  }

  for (const i of scenario.interpretations) {
    checkAvailableFrom(`interpretation ${i.id}`, i.availableFrom, i.citations);
    for (const obsId of i.supportingObservationIds) {
      const obs = observationById.get(obsId);
      if (!obs) problems.push(`interpretation ${i.id}: unknown observation "${obsId}"`);
      else {
        if (obs.availableFrom > i.availableFrom) {
          problems.push(`interpretation ${i.id}: supported by later observation "${obsId}"`);
        }
        if (i.relevance === "local" && obs.relevance === "regional-context") {
          problems.push(
            `interpretation ${i.id}: regional-context observation "${obsId}" cannot be local support (use contextRecordIds)`,
          );
        }
      }
    }
    for (const id of i.contextRecordIds) {
      if (!contextIds.has(id)) problems.push(`interpretation ${i.id}: contextRecordIds "${id}" is not a regional-context record`);
    }
  }

  for (const g of scenario.gaps) {
    if (g.origin.kind === "cited") checkAvailableFrom(`gap ${g.id}`, g.availableFrom, g.origin.citations);
    for (const interpId of g.discriminatesInterpretationIds) {
      const interp = interpretationById.get(interpId);
      if (!interp) problems.push(`gap ${g.id}: unknown interpretation "${interpId}"`);
      else if (interp.relevance === "regional-context") {
        problems.push(`gap ${g.id}: regional-context interpretation "${interpId}" cannot be a competing hypothesis`);
      }
    }
    if (g.priority) {
      const latest = latestPublished(`gap ${g.id} priority`, g.priority.citations);
      if (latest && latest > g.availableFrom) {
        problems.push(`gap ${g.id}: priority cites a source (${latest}) published after the gap (${g.availableFrom})`);
      }
    }
  }

  for (const t of scenario.tasks) {
    for (const link of t.addresses) {
      const gap = gapById.get(link.gapId);
      if (!gap) problems.push(`task ${t.id}: unknown gap "${link.gapId}"`);
      const latest = latestPublished(`task ${t.id} link ${link.gapId}`, link.citations);
      if (latest && link.availableFrom !== latest) {
        problems.push(`task ${t.id} link ${link.gapId}: availableFrom must equal latest cited source date ${latest}`);
      }
      if (!latest && link.availableFrom) {
        problems.push(`task ${t.id} link ${link.gapId}: availableFrom given without citations`);
      }
    }
    for (const resourceId of Object.keys(t.costs)) {
      if (!resourceIds.has(resourceId)) problems.push(`task ${t.id}: unknown resource "${resourceId}"`);
    }
    for (const assumptionId of t.assumptionIds) {
      if (!assumptionIds.has(assumptionId)) problems.push(`task ${t.id}: unknown assumption "${assumptionId}"`);
    }
  }

  for (const a of scenario.discriminationAssessments) {
    const where = `assessment ${a.id}`;
    const task = taskById.get(a.taskId);
    if (!task) problems.push(`${where}: unknown task "${a.taskId}"`);
    let latest = latestPublished(where, a.citations) ?? "0000-01-01";
    const linkedHypotheses = new Set(
      (task?.addresses ?? []).flatMap((l) => gapById.get(l.gapId)?.discriminatesInterpretationIds ?? []),
    );
    for (const h of a.hypothesisIds) {
      const interp = interpretationById.get(h);
      if (!interp) {
        problems.push(`${where}: unknown hypothesis "${h}"`);
        continue;
      }
      if (interp.relevance === "regional-context") problems.push(`${where}: "${h}" is regional context, not a local hypothesis`);
      if (!linkedHypotheses.has(h)) problems.push(`${where}: "${h}" is not concerned by any gap the task addresses`);
      if (interp.availableFrom > latest) latest = interp.availableFrom;
    }
    if (a.availableFrom !== latest) problems.push(`${where}: availableFrom must be ${latest}`);
    for (const [n, o] of a.outcomes.entries()) {
      if (o.favors.length + o.weakens.length === 0) problems.push(`${where}: outcome ${n + 1} favors/weakens nothing`);
      for (const h of [...o.favors, ...o.weakens]) {
        if (!a.hypothesisIds.includes(h)) problems.push(`${where}: outcome ${n + 1} references "${h}" outside hypothesisIds`);
      }
      if (o.favors.some((h) => o.weakens.includes(h))) problems.push(`${where}: outcome ${n + 1} both favors and weakens a hypothesis`);
    }
  }

  if (scenario.defaultSnapshotDate < scenario.minSnapshotDate) {
    problems.push("defaultSnapshotDate is before minSnapshotDate");
  }

  return problems;
}
