# SCI-0 ranking claims list

This file lists every statement the app shows today about priority, rank,
order or scientific contribution. For each one it gives the exact
location, what the statement rests on, and a classification:

- **Safe:** true as stated with its current label.
- **Provisional, labelled:** rests on unreviewed inputs and already says so.
- **Provisional, label missing:** must say so but doesn't.
- **Unsupported:** cannot currently be shown as a claim.

The line numbers refer to `main` at `6fd4222`.

Two cautions apply throughout:

- **A rank or score is not a scientific finding.** It is the existing
  engine's output on AI-drafted, pending relationships and simulated costs
  ([REPRODUCTION.md](REPRODUCTION.md)).
- **"Insufficient evidence for a scientific ordering" does not mean "no
  scientific value".** Nothing here says an action lacks value.

## Mission Glass (`/`)

### C1. Rank badge on target markers and buttons

- **Text:** the rank digit (`1`, `2`, `3`). The legend reads "Number:
  provisional priority (existing engine, not validated)".
- **Where:**
  - `src/lib/prototype/target-markers.ts` (`badge`);
  - the map markers and the target buttons;
  - the legend at `MissionGlass.tsx`.
- **Rests on:** the engine's provisional rank.
- **Class:** Provisional, labelled (legend and aria labels).

### C2. Target summary priority line

- **Text:** "Provisional priority #1 · not validated · 40 pts".
- **Where:** `TargetMapOverlay.tsx:109`, in the summary card on the map.
- **Rests on:** the provisional rank.
- **Class:** Provisional, labelled.

### C3. Card rationale

- **Text:** "Covers 2 of 3 open questions · adds close-up rover evidence".
- **Where:** `mission-glass.ts:147` (`rationale`), shown at
  `TaskCard.tsx:95–96`: Level 1 of each card, always visible.
- **Rests on:** a count of **AI-drafted, pending** task–gap links, plus the
  MDI evidence-type assumption.
- **Class:** **Provisional, label missing.**
  - "Covers" reads as an established fact.
  - Level 3 labels each link "drafted by AI · awaiting expert review", but
    Level 1 does not.
  - See proposal A1.

### C4. Card rank number

- **Text:** a circled rank, with `aria-label` "Provisional priority 1".
- **Where:** `TaskCard.tsx:73`.
- **Rests on:** the provisional rank.
- **Class:** Provisional, labelled (aria; the panel heading note).

### C5. Planning panel note

- **Text:** "Priorities are provisional: existing MDI engine, not
  scientifically validated (50 relationships await expert review)."
- **Where:** `MissionGlass.tsx` (`mg-ranking-note`).
- **Rests on:** the registry count.
- **Class:** Safe.

### C6. Weight stability ("Priority holds")

- **Text:** "Stays #1 in 6 of 6 runs with each weight changed by ±20%."
- **Where:** `mission-glass.ts:155`, shown at `TaskCard.tsx:158`: Level 2,
  "Priority holds".
- **Rests on:** the engine's weight perturbation (weights only).
- **Class:** **Provisional, label missing.**
  - It reads as robustness of the priority.
  - It does not test the 47 unreviewed inputs, three of which each flip
    #1. See A2.

### C7. Other "Priority holds" conditions

- **Text:** "Rank can change if the weights change." and "Depends on N
  scientific relationship(s) that await expert review."
- **Where:** `mission-glass.ts:156–157`.
- **Rests on:** the registry.
- **Class:** Safe. The second line is the right kind of statement.

### C8. "Why this rank" heading and engine notes

- **Text:** "Why this rank (existing engine, provisional)", followed by the
  engine notes verbatim.
- **Where:** `EvidenceSheet.tsx:82–90` (Level 3).
- **Rests on:** engine explanations.
- **Class:**
  - **Gap-coverage note:** Provisional, labelled ("N link(s) are
    AI-drafted and pending human review").
  - **Feasibility note:** Safe ("— simulated").
  - **Not Evaluated notes:** Safe.
  - **Evidence-quality note:** see C9.

### C9. Evidence-quality explanation

- **Text:** "Would add rover in situ evidence; best existing support for
  these hypotheses: orbital."
- **Where:**
  - `engine.ts:248` (the explanation string);
  - shown at `EvidenceSheet.tsx:88` and `DecisionSection.tsx:360`.
- **Rests on:** the hypothesis-support links in the dataset, which link only
  orbital observations to the gap hypotheses.
- **Class:** **Unsupported as worded at 2025-05-06.**
  - The dataset holds rover measurements of Margin rocks (SHERLOC, PIXL),
    which are not linked to these hypotheses.
  - "Best existing support" reads as a statement about the science. See
    A3.

### C10. "Already addressed" on a question

- **Text:** "No rover measurement yet (already addressed)".
- **Where:** `EvidenceSheet.tsx:99` (Level 3, under "Open questions it
  addresses").
- **Rests on:** the AI-drafted derived rule (`derived-gap:…#rule`,
  pending).
- **Class:** **Provisional, label missing.**
  - It can read as "the scientific question is resolved".
  - What it actually closes is only "has a rover compositional
    measurement been published". See A4.

### C11. "Fill with suggested order"

- **Text:** "Fill with suggested order".
- **Where:** `MissionGlass.tsx` (`mg-use-suggested`).
- **Rests on:** the provisional order plus budget fit.
- **Class:** Provisional. The label is implicit through C5. A6 suggests
  "provisional".

### C12. Plan review bullet

- **Text:** "Order and priorities are provisional (existing engine, not
  scientifically validated)."
- **Where:** `PlanReview.tsx`.
- **Class:** Safe.

### C13. Replan dialog

- **Text:** "Suggested" and the ordered list, followed by "Order from the
  existing engine: provisional, not scientifically validated."
- **Where:** `ReplanDialog.tsx`.
- **Rests on:** the engine order at the effort still available.
- **Class:** Provisional, labelled.

### C14. EVA priority chip

- **Text:** "Priority #1 · provisional, not validated" / "Not ranked now ·
  provisional engine".
- **Where:** `EvaHud.tsx:298`.
- **Class:** Provisional, labelled.

### C15. Fit statements

- **Text:** "Fits: 40 of 100 pts", "Fits: 40 pts, leaving 60 pts.", "Not
  feasible: needs 55 pts, 50 pts available."
- **Where:** `mission-glass.ts:149, 871`, `target-markers.ts`,
  `ReplanDialog.tsx`.
- **Rests on:** simulated costs and budget.
- **Class:** Safe, as *simulated* feasibility. It must never be read as
  scientific value (C-track proposal C1).

### C16. Target distance

- **Text:** "118 m straight-line from the verified Lefroy Bay site. No route
  or safety assessment."
- **Where:** `TargetMapOverlay.tsx`, `TaskCard.tsx`.
- **Rests on:** the scenario offsets.
- **Class:** Safe.

### C17. Sequence chips and lines (MAP-2)

- **Text:** "Seq n: plan order (not priority)", "Conceptual mission
  sequence — not a navigable route".
- **Where:** `SequenceViews.tsx`, `MarsMap.tsx`.
- **Class:** Safe.

## Research workspace (`/research`)

### C18. Provisional stability line

- **Text (template):** "… stays #1 in {topUnchanged} of {trials} runs with
  each basis weight changed by ±{p}%; lead over #2: {margin} points." The
  research workspace uses its own constraints, so the numbers can differ
  from Mission Glass.
- **Where:** `DecisionSection.tsx:269–271` (`stability`).
- **Rests on:** weight perturbation and the margin.
- **Class:** **Provisional, label missing** (weights only), as C6. See A2.

### C19. "(addressed)" on a question

- **Text:** "(addressed)".
- **Where:** `DecisionSection.tsx:109`.
- **Rests on:** the AI-drafted derived rule.
- **Class:** **Provisional, label missing**, as C10. See A4.

### C20. "Addressed by: …"

- **Text:** "Addressed by: <observation titles>".
- **Where:** `EvidenceSection.tsx:125–126`.
- **Rests on:** the derived rule and the pending observation–gap links.
- **Class:** **Provisional, label missing**, as C10. See A4.

### C21. Engine notes in the provisional ranking

- **Text:** the engine explanations, including C9.
- **Where:** `DecisionSection.tsx:360`.
- **Class:** As C8 and C9.

### C22. Reviewed ranking

- **Text:** "unavailable … N relationship(s) await expert review".
- **Where:** `DecisionSection.tsx`.
- **Class:** Safe.

## Statements that must not appear (none appear today)

- That an action is scientifically better, more important or more valuable
  than another.
- That the order is a NASA, Mars 2020 team or expert recommendation.
- That a new survey or abrasion would resolve the origin of the Margin unit.
- That a core will be returned to Earth or analysed there.
- That Targets A, B or C are Margin-unit outcrops, accessible or safe.
- That the candidate actions are new kinds of operation for this unit.
- Any numeric value for hypothesis discrimination or scientific priority.
