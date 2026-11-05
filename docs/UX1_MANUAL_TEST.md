# UX-1 manual test script: the guided five-step workflow

> **Superseded by `MF1_MANUAL_TEST.md`.** MF-1 (2026-11-05) removed the
> five-step wizard; this script applies only to branch `ux1-guided-workflow`.

## Setup

Branch `ux1-guided-workflow`. Run:

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in a desktop browser at ≥1024 px wide. Turn
browser page translation **off** for the first pass.

## Steps

| # | Do | Expect |
|---|---|---|
| 1 | Load the page | The stepper shows **1 Mission** (highlighted) → 2 Evidence → 3 Unknowns → 4 Decision → 5 Result. The integrity bar below it reads: *Mission date 2023-09-08 · 11 later record(s) hidden · Simulated scenario · not a NASA plan or endorsement · Reviewed ranking: unavailable · 4 feasible task(s) excluded pending review · 28 relationship(s) awaiting expert review*. The map is on the left. The right panel shows only **Mission** |
| 2 | Read the Mission panel | It shows the question "You have limited time to investigate Mars. What should you observe next, and why?", a 5-item "How it works" list, the scenario card, mission-date controls, and a "Before you start" caveats box |
| 3 | Click **Next: Evidence →** | The Evidence panel appears, keyboard focus is on its heading, and the panel is scrolled to the top. It contains Observations (1), Hypotheses & interpretations (2) and collapsed Regional geological context (4) |
| 4 | Click **← Back: Mission** | You return to Mission, with focus on its heading |
| 5 | Press **Tab** until "3 Unknowns" in the stepper is focused, then press **Enter** | The Unknowns panel shows 3 open questions |
| 6 | Click **4 Decision** | You see the ranking status box (reviewed unavailable; provisional top task, not validated), tasks with their gap links and review ids, mission constraints, criteria and weights, and a collapsed "Compare tasks side by side (provisional, not validated)" |
| 7 | Set the budget slider to 30 | The status box changes the provisional top task to *Stand-off survey…*. Opening the comparison shows abrasion and coring "Not ranked" with reasons |
| 8 | Click **1 Mission**, then **4 Decision** again | The budget is still 30, so selections persist. Click **Reset constraints** |
| 9 | Click **5 Result** (or the "Reviewed ranking: unavailable" chip in the integrity bar) | You see "Reviewed ranking unavailable" with its reason, and "Feasible tasks excluded because their scientific review is incomplete: 4". The provisional ranking is collapsed. "What happened later" and the Scientific review registry (28) follow |
| 10 | Expand the **Provisional exploratory ranking** | You see the "PROVISIONAL · NOT VALIDATED" badge, 4 pivotal inputs with review ids, and the provisional top task labelled *not scientifically validated* |
| 11 | Click **Reveal later evidence** | Later rover observations appear, labelled "Published later" and "revealed: N days after snapshot" |
| 12 | Go to **1 Mission** and click **All evidence** | The integrity bar shows the new date and 0 hidden records. On Result, the registry lists 50 entries, all pending, and the reveal is hidden again |
| 13 | Decision: uncheck all three platforms | No crash. "Not ranked: No task is feasible…" appears and the basis labels read "not applicable". Reset afterwards |
| 14 | Repeat steps 6–13 with browser page translation **on** | No "removeChild" error, and numbers (budget, weights, top task) still update |
| 15 | Resize to phone width (≈390 px) | Map above, step panel below, Back/Next fixed at the bottom, the stepper scrolls sideways, no horizontal page scroll |

**Report any step that does not match.** Known gaps are listed in
`DEVELOPMENT_LOG.md` under UX-1, "Remaining UX problems".
