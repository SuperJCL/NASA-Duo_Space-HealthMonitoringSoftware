/** The five guided steps (UX-1). Order matters: index = step number − 1. */
export const STEPS = [
  { id: "mission", label: "Mission", heading: "Mission" },
  { id: "evidence", label: "Evidence", heading: "Evidence: what was known" },
  { id: "unknowns", label: "Unknowns", heading: "Unknowns: what was not yet known" },
  { id: "decision", label: "Decision", heading: "Decision: compare candidate observations" },
  { id: "result", label: "Result", heading: "Result" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];
export const stepIndex = (id: StepId) => STEPS.findIndex((s) => s.id === id);
