import type {
  Assumption,
  CandidateTask,
  EvidenceGap,
  Interpretation,
  Observation,
  Scenario,
  SimulatedResource,
} from "./schema";

declare const snapshotBrand: unique symbol;

export type GapStatus =
  | { state: "open" }
  | { state: "addressed"; byObservationIds: string[] };

export type SnapshotGap = EvidenceGap & { status: GapStatus };

/**
 * Everything the decision engine is allowed to see: evidence that was public
 * on or before `asOf`, plus the scenario's simulated tasks and resources.
 *
 * The brand means a SnapshotEvidence value can only be created by
 * `selectEvidenceAsOf`, so the engine cannot be handed unfiltered evidence.
 */
export type SnapshotEvidence = {
  readonly [snapshotBrand]: true;
  readonly asOf: string;
  readonly observations: readonly Observation[];
  readonly interpretations: readonly Interpretation[];
  readonly gaps: readonly SnapshotGap[];
  readonly tasks: readonly CandidateTask[];
  readonly resources: readonly SimulatedResource[];
  readonly assumptions: readonly Assumption[];
  readonly limitations: readonly string[];
  /** Count only: how many records exist after `asOf` (their content is withheld). */
  readonly hiddenLaterCount: number;
};

/** Evidence published after the snapshot date, for the retrospective reveal only. */
export type LaterEvidence = {
  readonly observations: readonly Observation[];
  readonly interpretations: readonly Interpretation[];
  readonly gaps: readonly EvidenceGap[];
};

export function selectEvidenceAsOf(
  scenario: Scenario,
  asOf: string,
): { snapshot: SnapshotEvidence; later: LaterEvidence } {
  const visible = <T extends { availableFrom: string }>(r: T) => r.availableFrom <= asOf;
  const hidden = <T extends { availableFrom: string }>(r: T) => r.availableFrom > asOf;

  const visibleGapIds = new Set(scenario.gaps.filter(visible).map((g) => g.id));
  // Strip references to gaps that did not exist yet, so not even their ids leak.
  const observations = scenario.observations.filter(visible).map((o) => ({
    ...o,
    addressesGapIds: o.addressesGapIds.filter((id) => visibleGapIds.has(id)),
  }));
  const interpretations = scenario.interpretations.filter(visible);
  const visibleInterpretationIds = new Set(interpretations.map((i) => i.id));
  const visibleObservationIds = new Set(observations.map((o) => o.id));

  const gaps: SnapshotGap[] = scenario.gaps.filter(visible).map((gap) => {
    const byObservationIds = observations
      .filter((o) => o.addressesGapIds.includes(gap.id))
      .map((o) => o.id);
    return {
      ...gap,
      discriminatesInterpretationIds: gap.discriminatesInterpretationIds.filter((id) =>
        visibleInterpretationIds.has(id),
      ),
      status:
        byObservationIds.length > 0 ? { state: "addressed", byObservationIds } : { state: "open" },
    };
  });

  const visibleInterpretations = interpretations.map((i) => ({
    ...i,
    supportingObservationIds: i.supportingObservationIds.filter((id) => visibleObservationIds.has(id)),
  }));

  const later: LaterEvidence = {
    observations: scenario.observations.filter(hidden),
    interpretations: scenario.interpretations.filter(hidden),
    gaps: scenario.gaps.filter(hidden),
  };

  const snapshot = {
    asOf,
    observations,
    interpretations: visibleInterpretations,
    gaps,
    tasks: scenario.tasks,
    resources: scenario.resources,
    assumptions: scenario.assumptions,
    limitations: scenario.limitations,
    hiddenLaterCount:
      later.observations.length + later.interpretations.length + later.gaps.length,
  } as unknown as SnapshotEvidence;

  return { snapshot, later };
}
