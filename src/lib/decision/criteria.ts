/**
 * Rule-derived decision criteria (MVP). Every score is computed from
 * structured, curated links in the snapshot — never by an LLM and never by
 * free-form judgement. See docs/PRODUCT_REQUIREMENTS.md §5.
 */

export const CRITERIA = [
  {
    id: "gap-coverage",
    name: "Open-gap coverage",
    direction: "benefit",
    defaultWeight: 3,
    rule: "Fraction of evidence gaps that are open on the snapshot date and that the task addresses.",
  },
  {
    id: "discrimination",
    name: "Discriminating power",
    direction: "benefit",
    defaultWeight: 3,
    rule: "Fraction of the competing interpretations known on the snapshot date that the task's open gaps could tell apart.",
  },
  {
    id: "independent-evidence",
    name: "Independent line of evidence",
    direction: "benefit",
    defaultWeight: 2,
    rule: "1 if the task's platform (orbital or rover) is not yet represented among the observations supporting the interpretations its open gaps concern; otherwise 0.",
  },
  {
    id: "resource-cost",
    name: "Simulated resource cost",
    direction: "cost",
    defaultWeight: 2,
    rule: "Average over simulated resources of 1 − (task cost ÷ scenario budget). Higher means cheaper.",
  },
] as const;

export type CriterionId = (typeof CRITERIA)[number]["id"];
export type Weights = Record<CriterionId, number>;

export const DEFAULT_WEIGHTS: Weights = Object.fromEntries(
  CRITERIA.map((c) => [c.id, c.defaultWeight]),
) as Weights;

export const MAX_WEIGHT = 5;
