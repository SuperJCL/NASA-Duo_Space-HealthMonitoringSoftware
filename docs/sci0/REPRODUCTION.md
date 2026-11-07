# SCI-0 reproduction record

Exact inputs, parameters and full-precision outputs behind the numbers in [`../SCI0_SCENARIO_EVIDENCE_CONTRACT.md`](../SCI0_SCENARIO_EVIDENCE_CONTRACT.md). The probe only *calls* the existing engine; it changes no code, data, weight or review status.

## 1. Versions

| Item | Value |
|---|---|
| Code and data | `main` at `6fd4222df4cc1d63b2cda51c4b6b4af896d9f7fa` (identical on `sci0-scenario-evidence-audit`; that branch changes only `docs/` and `DEVELOPMENT_LOG.md`) |
| Engine | `ENGINE_VERSION` = `0.2.0` (`src/lib/decision/engine.ts`) |
| Runtime | Node v22.23.4, vitest 5.1.0 (linux-x64) |
| Probe runs | 2026-11-07T00:41:50Z (SCI-0); re-run on 2026-11-07 (after 01:32:59Z) for this record with identical results (same commit) |

Data and engine files (SHA-256 of the file; git blob id at `6fd4222`):

| File | SHA-256 | git blob |
|---|---|---|
| `src/data/scenarios/jezero-margin-unit.json` | `6f25e0864c54379b1118b9c0632da24e8b08acd3f1e51da7cc544bee081354f4` | `7703c0d71fa176065010b91e680465bf2aee5854` |
| `src/data/scenarios/jezero-margin-unit.reviews.json` | `63ad5f0baa8b8ac9a25160e6633a440b69eca45d8cce2c5997fae5da45203dbb` | `738a3856fa5d4b0fd10f7216fdc855f24edac2f4` |
| `src/data/prototype/mission-glass.json` | `6a816f810166cbc5bcf3f56b0da3eb068f35c5a78166f594a967b5fc7548e73e` | `f9e615fba549c8c3a3e10c549abe46ae6866fa6a` |
| `src/data/sources.json` | `516f7c75a81b9716f61bff605d020b379cb3377ef89134cb4417ada9093136d4` | `6e82b53258c1f12a788fb32cfb5898adb44cdfb5` |
| `src/lib/decision/engine.ts` | `044ec4cf0621e4ca038294de57817a1b4bc2925f61ca882f89cf365366f8d947` | `cd4458f34f7cf1a689d43deb15c804a1d66bb5f2` |
| `src/lib/decision/criteria.ts` | `06d95f5115d05864fc7b960b43b86140edea204e1a3a0cc3ed74e7f539aa9d56` | `33e930385dbb6d87e4f53e2a5c838f38a6eb117a` |
| `src/lib/decision/review-modes.ts` | `5ba7c4fd9c61819d9daf210d4569c5f9beffaa5f1eb2a774648afe11fe6233ee` | `863eaa096f630b6fc943f9ff3b809410b407a4be` |

## 2. Parameters

- **Weights:** `DEFAULT_WEIGHTS` = `{"gap-coverage": 3, "hypothesis-discrimination": 3, "resource-feasibility": 2, "scientific-priority": 2, "evidence-quality": 2}`. Only criteria evaluated for every feasible task enter the score (the *basis*); here: gap-coverage (3), resource-feasibility (2), evidence-quality (2), so the weight sum is 7.
- **Constraints (as Mission Glass):** `budgets: {"res-effort": 100}` or `50`; `unavailablePlatforms: ["orbital"]` (the scenario's `excludedPlatforms`).
- **Snapshot dates:** `2025-05-06` (latest record date; Mission Glass present day) and `2023-09-08` (the scenario's default historical snapshot).
- **Review registry:** as committed (50 entries, all `pending`, none `rejected`).
- **Action IDs:** Survey = `task-standoff-survey`, Abrade = `task-abrasion-proximity`, Core = `task-core-for-earth` (`task-orbital-stereo` is infeasible: orbital platform excluded).

**Rules (as implemented, not changed):**

- Score: `total = Σ_basis weight × value / Σ_basis weight` (`engine.ts` `rank`). Order: higher total, then higher resource-feasibility value (cheaper), then task id.
- Margin: `ranking[0].total − ranking[1].total` (`recommend`).
- Weight stability: each basis weight × 0.8 and × 1.2, one at a time (2 × 3 = 6 trials); counts trials whose #1 is unchanged (`recommend`, `STABILITY_PERTURBATION = 0.2`). **It perturbs weights only, never inputs.**
- Pivotal inputs: for each visible, non-approved *decision input* relationship (all registry types except priority statements and discrimination assessments), remove it alone with `withoutRelationships` and re-rank; it is pivotal if #1 changes (`rankProvisional`). Removing a `relevance:` entry removes that record; removing a `task-gap:` entry removes that one link.

## 3. How to reproduce

Copy the probe below to `src/__sci0_probe.test.ts` (vitest only collects `src/**/*.test.ts`), run it, and delete it:

```bash
SCI0_OUT=/tmp/sci0-probe.json npx vitest run src/__sci0_probe.test.ts && rm src/__sci0_probe.test.ts
```

```ts
// SCI-0 read-only engine probe. Copy to src/__sci0_probe.test.ts, run, then delete:
//   SCI0_OUT=/tmp/sci0-probe.json npx vitest run src/__sci0_probe.test.ts && rm src/__sci0_probe.test.ts
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { ENGINE_VERSION, defaultConstraints, recommend } from "@/lib/decision/engine";
import { rankProvisional, rankReviewed, withoutRelationships } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";

it("SCI-0 read-only engine probe", () => {
  const { scenario, registry } = loadJezeroMarginScenario();
  const runs: Record<string, unknown> = {};
  for (const asOf of ["2025-05-06", "2023-09-08"]) {
    const { snapshot } = selectEvidenceAsOf(scenario, asOf);
    for (const budget of [100, 50]) {
      // Mission Glass constraints: the scenario excludes the orbital platform.
      const c = { ...defaultConstraints(snapshot), budgets: { "res-effort": budget }, unavailablePlatforms: ["orbital" as const] };
      const p = rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, c);
      const rec = p.recommendation;
      // The engine's own stability rule: each basis weight × 0.8 and × 1.2, one at a time (no rejected entries, so this equals its snapshot).
      const trials = rec.basis
        .filter((b) => b.inBasis)
        .flatMap((b) =>
          [0.8, 1.2].map((f) => {
            const w = { ...DEFAULT_WEIGHTS, [b.criterionId]: b.weight * f };
            const r = recommend(snapshot, w, c);
            return { criterion: b.criterionId, factor: f, weight: w[b.criterionId], top: r.ranking[0]?.taskId, totals: r.ranking.map((x) => [x.taskId, x.total]) };
          }),
        );
      // Ranking after removing each pivotal unreviewed input alone (same rule as rankProvisional.pivotalInputs).
      const pivots = p.pivotalInputs.map((pi) => ({
        removed: pi.reviewId,
        ranking: recommend(selectEvidenceAsOf(withoutRelationships(scenario, new Set([pi.reviewId])), asOf).snapshot, DEFAULT_WEIGHTS, c).ranking.map((x) => [x.taskId, x.total]),
      }));
      const r = rankReviewed(scenario, registry, asOf, DEFAULT_WEIGHTS, c);
      runs[`${asOf}@${budget}`] = {
        constraints: rec.constraints,
        basis: rec.basis,
        ranking: rec.ranking.map((x) => ({ rank: x.rank, taskId: x.taskId, total: x.total, contributions: x.contributions, openGapIds: x.openGapIds, outcomes: x.outcomes })),
        infeasible: rec.infeasible,
        stability: rec.stability,
        trials,
        unreviewedInputCount: p.unreviewedInputs.length,
        unreviewedNotScored: p.unreviewedNotScored,
        pivotalInputs: p.pivotalInputs,
        pivots,
        reviewed: { status: r.status, awaitingReview: r.awaitingReview.length, notAssessed: r.notAssessed },
      };
    }
  }
  writeFileSync(process.env.SCI0_OUT ?? "sci0-probe.json", JSON.stringify({ engineVersion: ENGINE_VERSION, weights: DEFAULT_WEIGHTS, runs }, null, 1));
});
```

Output precision: IEEE-754 doubles as computed (JavaScript `number`), printed below in full. The contract rounds to 3 decimals; the UI shows `scorePct = round(total × 100)`.

## 4. Outputs

### 2025-05-06, budget 100

| # | Action | gap-coverage | resource-feasibility | evidence-quality | hypothesis-discrimination | scientific-priority | total |
|---|---|---|---|---|---|---|---|
| 1 | Abrade `task-abrasion-proximity` | 0.6666666666666666 | 0.6 | 1 | Not Evaluated | Not Evaluated | **0.7428571428571429** |
| 2 | Core `task-core-for-earth` | 0.6666666666666666 | 0.44999999999999996 | 1 | Not Evaluated | Not Evaluated | **0.7** |
| 3 | Survey `task-standoff-survey` | 0.3333333333333333 | 0.85 | 1 | Not Evaluated | Not Evaluated | **0.6714285714285714** |

- Infeasible: `task-orbital-stereo` (Platform "orbital" is unavailable under the current constraints.).
- Margin #1 − #2: `0.04285714285714293`.
- Weight stability: #1 unchanged in **6 of 6** trials:
  - gap-coverage × 0.8 (weight 2.4000000000000004): #1 = Abrade; totals Abrade 0.75, Survey 0.703125, Core 0.703125
  - gap-coverage × 1.2 (weight 3.5999999999999996): #1 = Abrade; totals Abrade 0.7368421052631577, Core 0.6973684210526314, Survey 0.644736842105263
  - resource-feasibility × 0.8 (weight 1.6): #1 = Abrade; totals Abrade 0.7515151515151515, Core 0.7151515151515151, Survey 0.6606060606060606
  - resource-feasibility × 1.2 (weight 2.4): #1 = Abrade; totals Abrade 0.735135135135135, Core 0.6864864864864864, Survey 0.681081081081081
  - evidence-quality × 0.8 (weight 1.6): #1 = Abrade; totals Abrade 0.7272727272727273, Core 0.6818181818181819, Survey 0.6515151515151515
  - evidence-quality × 1.2 (weight 2.4): #1 = Abrade; totals Abrade 0.7567567567567566, Core 0.7162162162162161, Survey 0.689189189189189
- Unreviewed decision inputs visible: 47; pending and not scored: `priority:gap-lake-connection#statement`, `priority:gap-formation-unknown#statement`, `discrimination:da-core-detrital-carbonate`.
- Pivotal inputs (3): removing any one alone changes #1:
  - without `relevance:gap-lake-connection` → Core 0.8428571428571429, Survey 0.7428571428571429, Abrade 0.6714285714285714
  - without `task-gap:task-abrasion-proximity->gap-formation-unknown` → Core 0.7, Survey 0.6714285714285714, Abrade 0.6
  - without `task-gap:task-abrasion-proximity->gap-lake-connection` → Core 0.7, Survey 0.6714285714285714, Abrade 0.6
- Reviewed ranking: **unavailable** (50 relationships await review).

### 2025-05-06, budget 50

| # | Action | gap-coverage | resource-feasibility | evidence-quality | hypothesis-discrimination | scientific-priority | total |
|---|---|---|---|---|---|---|---|
| 1 | Survey `task-standoff-survey` | 0.3333333333333333 | 0.7 | 1 | Not Evaluated | Not Evaluated | **0.6285714285714286** |
| 2 | Abrade `task-abrasion-proximity` | 0.6666666666666666 | 0.19999999999999996 | 1 | Not Evaluated | Not Evaluated | **0.6285714285714286** |

- Infeasible: `task-core-for-earth` (Needs 55 points of Investigation effort; simulated budget is 50.), `task-orbital-stereo` (Platform "orbital" is unavailable under the current constraints.).
- Margin #1 − #2: `0`.
- Weight stability: #1 unchanged in **4 of 6** trials:
  - gap-coverage × 0.8 (weight 2.4000000000000004): #1 = Survey; totals Survey 0.65625, Abrade 0.625
  - gap-coverage × 1.2 (weight 3.5999999999999996): #1 = Abrade; totals Abrade 0.631578947368421, Survey 0.6052631578947367
  - resource-feasibility × 0.8 (weight 1.6): #1 = Abrade; totals Abrade 0.6545454545454545, Survey 0.6242424242424243
  - resource-feasibility × 1.2 (weight 2.4): #1 = Survey; totals Survey 0.6324324324324324, Abrade 0.6054054054054052
  - evidence-quality × 0.8 (weight 1.6): #1 = Survey; totals Survey 0.6060606060606061, Abrade 0.6060606060606061
  - evidence-quality × 1.2 (weight 2.4): #1 = Survey; totals Survey 0.6486486486486486, Abrade 0.6486486486486486
- Unreviewed decision inputs visible: 47; pending and not scored: `priority:gap-lake-connection#statement`, `priority:gap-formation-unknown#statement`, `discrimination:da-core-detrital-carbonate`.
- Pivotal inputs (3): removing any one alone changes #1:
  - without `relevance:gap-formation-unknown` → Abrade 0.5571428571428572, Survey 0.19999999999999998
  - without `relevance:gap-sedimentary-or-igneous` → Abrade 0.7714285714285714, Survey 0.7
  - without `task-gap:task-standoff-survey->gap-formation-unknown` → Abrade 0.6285714285714286, Survey 0.19999999999999998
- Reviewed ranking: **unavailable** (50 relationships await review).

### 2023-09-08, budget 100

| # | Action | gap-coverage | resource-feasibility | evidence-quality | hypothesis-discrimination | scientific-priority | total |
|---|---|---|---|---|---|---|---|
| 1 | Abrade `task-abrasion-proximity` | 1 | 0.6 | 1 | Not Evaluated | Not Evaluated | **0.8857142857142857** |
| 2 | Survey `task-standoff-survey` | 0.6666666666666666 | 0.85 | 1 | Not Evaluated | Not Evaluated | **0.8142857142857143** |
| 3 | Core `task-core-for-earth` | 0.3333333333333333 | 0.44999999999999996 | 1 | Not Evaluated | Not Evaluated | **0.5571428571428572** |

- Infeasible: `task-orbital-stereo` (Platform "orbital" is unavailable under the current constraints.).
- Margin #1 − #2: `0.0714285714285714`.
- Weight stability: #1 unchanged in **6 of 6** trials:
  - gap-coverage × 0.8 (weight 2.4000000000000004): #1 = Abrade; totals Abrade 0.875, Survey 0.828125, Core 0.578125
  - gap-coverage × 1.2 (weight 3.5999999999999996): #1 = Abrade; totals Abrade 0.894736842105263, Survey 0.8026315789473684, Core 0.5394736842105263
  - resource-feasibility × 0.8 (weight 1.6): #1 = Abrade; totals Abrade 0.9030303030303031, Survey 0.8121212121212122, Core 0.5636363636363637
  - resource-feasibility × 1.2 (weight 2.4): #1 = Abrade; totals Abrade 0.8702702702702703, Survey 0.8162162162162161, Core 0.5513513513513513
  - evidence-quality × 0.8 (weight 1.6): #1 = Abrade; totals Abrade 0.8787878787878789, Survey 0.803030303030303, Core 0.5303030303030303
  - evidence-quality × 1.2 (weight 2.4): #1 = Abrade; totals Abrade 0.8918918918918919, Survey 0.8243243243243242, Core 0.5810810810810809
- Unreviewed decision inputs visible: 26; pending and not scored: `priority:gap-lake-connection#statement`, `priority:gap-formation-unknown#statement`.
- Pivotal inputs (4): removing any one alone changes #1:
  - without `relevance:gap-lake-connection` → Survey 0.9571428571428571, Abrade 0.8857142857142857, Core 0.6285714285714286
  - without `task-gap:task-abrasion-proximity->gap-no-in-situ-data` → Survey 0.8142857142857143, Abrade 0.7428571428571429, Core 0.5571428571428572
  - without `task-gap:task-abrasion-proximity->gap-formation-unknown` → Survey 0.8142857142857143, Abrade 0.7428571428571429, Core 0.5571428571428572
  - without `task-gap:task-abrasion-proximity->gap-lake-connection` → Survey 0.8142857142857143, Abrade 0.7428571428571429, Core 0.5571428571428572
- Reviewed ranking: **unavailable** (28 relationships await review).

### 2023-09-08, budget 50

| # | Action | gap-coverage | resource-feasibility | evidence-quality | hypothesis-discrimination | scientific-priority | total |
|---|---|---|---|---|---|---|---|
| 1 | Survey `task-standoff-survey` | 0.6666666666666666 | 0.7 | 1 | Not Evaluated | Not Evaluated | **0.7714285714285714** |
| 2 | Abrade `task-abrasion-proximity` | 1 | 0.19999999999999996 | 1 | Not Evaluated | Not Evaluated | **0.7714285714285714** |

- Infeasible: `task-core-for-earth` (Needs 55 points of Investigation effort; simulated budget is 50.), `task-orbital-stereo` (Platform "orbital" is unavailable under the current constraints.).
- Margin #1 − #2: `0`.
- Weight stability: #1 unchanged in **4 of 6** trials:
  - gap-coverage × 0.8 (weight 2.4000000000000004): #1 = Survey; totals Survey 0.78125, Abrade 0.75
  - gap-coverage × 1.2 (weight 3.5999999999999996): #1 = Abrade; totals Abrade 0.7894736842105263, Survey 0.763157894736842
  - resource-feasibility × 0.8 (weight 1.6): #1 = Abrade; totals Abrade 0.8060606060606061, Survey 0.7757575757575758
  - resource-feasibility × 1.2 (weight 2.4): #1 = Survey; totals Survey 0.7675675675675675, Abrade 0.7405405405405405
  - evidence-quality × 0.8 (weight 1.6): #1 = Survey; totals Survey 0.7575757575757576, Abrade 0.7575757575757576
  - evidence-quality × 1.2 (weight 2.4): #1 = Survey; totals Survey 0.7837837837837838, Abrade 0.7837837837837838
- Unreviewed decision inputs visible: 26; pending and not scored: `priority:gap-lake-connection#statement`, `priority:gap-formation-unknown#statement`.
- Pivotal inputs (5): removing any one alone changes #1:
  - without `relevance:gap-formation-unknown` → Abrade 0.7714285714285714, Survey 0.7
  - without `relevance:gap-no-in-situ-data` → Abrade 0.7714285714285714, Survey 0.7
  - without `derived-gap:gap-no-in-situ-data#rule` → Abrade 0.7714285714285714, Survey 0.7
  - without `task-gap:task-standoff-survey->gap-no-in-situ-data` → Abrade 0.7714285714285714, Survey 0.6285714285714286
  - without `task-gap:task-standoff-survey->gap-formation-unknown` → Abrade 0.7714285714285714, Survey 0.6285714285714286
- Reviewed ranking: **unavailable** (28 relationships await review).

## 5. The four headline results

1. **Lead of 0.043 (2025-05-06, 100 pts):** Abrade `0.7428571428571429` − Core `0.7` = `0.04285714285714293` (exactly 0.3/7 in real arithmetic: the two differ only in resource feasibility, 0.6 vs 0.45, weight 2 of 7).
2. **Three single removals flip #1 (2025-05-06, 100 pts):** `relevance:gap-lake-connection` (a relevance classification: removing it removes the lake-connection question), `task-gap:task-abrasion-proximity->gap-formation-unknown` and `task-gap:task-abrasion-proximity->gap-lake-connection` (task–gap links). After any one removal, Core is #1 (totals in §4). **Precision:** the contract calls these “three unreviewed relationships”, which is accurate in the registry's sense; two are task–gap links and one is a relevance classification of a question.
3. **Tie at 50 pts (2025-05-06):** Survey `0.6285714285714286` and Abrade `0.6285714285714286` are the same double; the margin is `0`. Survey is listed first only by the engine's tie-break (higher resource-feasibility value: 0.7 vs 0.2). Core is infeasible (55 > 50).
4. **Weight stability 6/6 (2025-05-06, 100 pts)** and **4/6 at 50 pts:** see the trial lists in §4. These test the three basis weights only; they say nothing about the 47 unreviewed inputs, three of which are individually pivotal.
