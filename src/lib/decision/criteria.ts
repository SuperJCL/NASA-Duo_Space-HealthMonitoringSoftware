/**
 * Decision criteria (M3). Five separate dimensions:
 *  - deterministic: computed by a fixed rule from structured snapshot data;
 *  - curated: derived by a fixed rule from a human-approved scientific
 *    judgement. Without an approved judgement the result is "Not Evaluated",
 *    never a number. An LLM never assigns these values.
 * See docs/PRODUCT_REQUIREMENTS.md §5.
 */

export const CRITERIA = [
  {
    id: "gap-coverage",
    name: "Evidence-gap coverage",
    basis: "deterministic",
    defaultWeight: 3,
    rule: "Fraction of the local evidence gaps open on the snapshot date that the task is linked to.",
  },
  {
    id: "hypothesis-discrimination",
    name: "Hypothesis discrimination",
    basis: "curated",
    defaultWeight: 3,
    rule: "From a human-approved assessment of how possible task results would favor or weaken competing hypotheses: fraction of the competing hypotheses (concerned by the task's open gaps) that some outcome favors or weakens. Not Evaluated without an approved assessment or with fewer than two competing hypotheses.",
  },
  {
    id: "resource-feasibility",
    name: "Resource feasibility",
    basis: "deterministic",
    defaultWeight: 2,
    rule: "Average over simulated resources of 1 − (task cost ÷ budget) under the current constraints. Tasks over budget, needing an unavailable platform, or with missing cost data are not ranked.",
  },
  {
    id: "scientific-priority",
    name: "Scientific priority",
    basis: "curated",
    defaultWeight: 2,
    rule: "1 if the task addresses an open gap whose importance is stated in a cited source and the statement is human-approved; otherwise Not Evaluated (absence of a citation is not low priority).",
  },
  {
    id: "evidence-quality",
    name: "Evidence quality gain",
    basis: "deterministic",
    defaultWeight: 2,
    rule: "1 if the task's evidence type ranks above the best existing evidence for the hypotheses its open gaps concern (regional context < orbital < rover in situ < Earth lab); otherwise 0.",
  },
] as const;

export type CriterionId = (typeof CRITERIA)[number]["id"];
export type Weights = Record<CriterionId, number>;

export const DEFAULT_WEIGHTS: Weights = Object.fromEntries(
  CRITERIA.map((c) => [c.id, c.defaultWeight]),
) as Weights;

export const MAX_WEIGHT = 5;

/** Ordering used by the evidence-quality criterion (an explicit MDI methodological assumption). */
export const EVIDENCE_LEVEL = {
  "regional-context": 0,
  orbital: 1,
  rover: 2,
  lab: 3,
} as const;

export const EVIDENCE_LEVEL_LABEL: Record<number, string> = {
  0: "regional context",
  1: "orbital",
  2: "rover in situ",
  3: "Earth lab",
};
