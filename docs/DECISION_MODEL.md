# MDI decision model (engine v0.2.0, M3)

Code: `src/lib/decision/criteria.ts`, `src/lib/decision/engine.ts`.
Tests: `engine.test.ts`, `scientific-integrity.test.ts`,
`src/lib/evidence/jezero-data.test.ts`.

## Principles

1. **Two kinds of criteria.**
   - A **deterministic** criterion is computed by a fixed rule from
     structured snapshot data.
   - A **curated** criterion is computed by a fixed rule from a scientific
     judgement that a human has approved.
   - An LLM never assigns a score. Judgements drafted by the AI agent are
     shown in the UI as `AI draft · pending review` and are not scored.
2. **"Not Evaluated" is a result, not a zero.**
   - When a value cannot be justified, the criterion returns `not-evaluated`
     with a reason. This happens with missing data, an unapproved judgement,
     or fewer than two competing hypotheses.
   - A zero is returned only when it follows from the rule. Example: a task
     that addresses no open gap has zero coverage.
3. **Same terms for every task.** A criterion enters the **ranking basis**
   only if it has weight > 0 and is evaluated for every feasible task.
   Otherwise it is shown for each task but excluded from the score, and the
   UI states why. Without this rule, a task with fewer evaluated criteria
   could be ranked higher or lower for no scientific reason.
4. **Leakage-proof input.** The engine accepts only `SnapshotEvidence` from
   `selectEvidenceAsOf`. Records, task-gap links, assessments and citations
   that were not public on the snapshot date are removed before scoring.

## The five criteria

| Criterion | Basis | Rule | When Not Evaluated |
|---|---|---|---|
| Evidence-gap coverage | deterministic | Open **local** gaps the task is linked to ÷ all open local gaps. Regional-context gaps are excluded. | No local gap is open. |
| Hypothesis discrimination | curated | From an **approved** assessment that lists possible results and which hypotheses each would favor or weaken: competing hypotheses affected ÷ competing hypotheses concerned by the task's open gaps. | Fewer than 2 competing hypotheses, or no approved assessment (pending or rejected ones don't count). |
| Resource feasibility | deterministic | Mean over resources of 1 − cost ÷ budget under the current constraints. | Never. The task is instead not ranked if it is over budget, needs an unavailable platform, or has a **missing** cost (missing ≠ 0). |
| Scientific priority | curated | 1 if the task addresses an open gap with an **approved**, cited priority statement. | No approved statement. Absence of a citation is not low priority. |
| Evidence quality gain | deterministic | 1 if the task's evidence type ranks above the best existing support for the competing hypotheses; otherwise 0. The ordering is regional context (0) < orbital (1) < rover in situ (2) < Earth lab (3). Regional context never counts above 0. | Never; a task with no open gaps gets 0. |

**Total.** The weighted average over the ranking-basis criteria only.

**Tie-break.** Higher total first, then higher feasibility (cheaper), then
task id.

**Stability.** Each basis weight is changed by ±20%, one at a time, and the
engine reports how often the top task stays first and its lead over #2.

## Mission constraints

`Constraints = { budgets, unavailablePlatforms }`. The UI exposes these as a
budget slider and checkboxes for the orbital, rover and Earth-lab platforms.
Changing a constraint re-runs the same pure function. Excluded tasks are
listed with their reason, for example:
"Needs 40 points of Investigation effort; simulated budget is 30."

## Why the M2 discrimination metric gave every task 100

- In M2, discrimination was computed as the fraction of known
  interpretations that a task's gaps "concern".
- Every gap listed all three interpretations, so every task scored 100.
- The metric measured gap–hypothesis bookkeeping, not discriminating power.
  It said nothing about whether a possible observation would favor one
  hypothesis over another.
- M3 replaces it with explicit, reviewable assessments. Each one lists
  "if observed X → favors H1 / weakens H2", with citations.
- At the default snapshot (2023-09-08), no source in the dataset states how a
  candidate observation would favor or weaken lacustrine versus
  mineral-carbonation origins. Discrimination is therefore **Not Evaluated**
  for every task, rather than given invented differences.

## Worked example: default snapshot 2023-09-08, default weights

The ranking basis is coverage (w3), feasibility (w2) and evidence quality
(w2), so each total is divided by 7.

| Task | Coverage | Feasibility | Quality | Total |
|---|---|---|---|---|
| Abrade + PIXL/SHERLOC/WATSON | 3/3 | 0.60 | 1 (rover > orbital) | (3 + 1.2 + 2)/7 = **0.886** |
| Stand-off SuperCam/Mastcam-Z | 2/3 | 0.85 | 1 | (2 + 1.7 + 2)/7 = 0.814 |
| Core for Earth labs | 1/3 | 0.45 | 1 (lab > orbital) | (1 + 0.9 + 2)/7 = 0.557 |
| HiRISE stereo | 1/3 | 0.90 | 0 (orbital = orbital) | (1 + 1.8 + 0)/7 = 0.400 |

- Discrimination and priority: Not Evaluated, so they are excluded from the
  basis.
- These values are locked in a regression test.
- With the budget at 30, abrasion (40) and coring (55) are excluded with
  reasons, and the stand-off survey ranks first.
