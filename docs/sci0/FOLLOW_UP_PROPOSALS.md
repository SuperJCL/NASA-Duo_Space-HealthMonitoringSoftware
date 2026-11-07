# SCI-0 follow-up proposals (not implemented)

**Status:** proposals for review. Nothing here has been implemented.

**Rules for every track:**

- No change to formulas, weights or review statuses.
- New relationships are drafted as `pending`.
- Merging or de-duplicating questions is proposed only; scored data is not
  edited.
- Replacement wording describes the scope of the existing evidence and adds
  no new scientific claim.

"Insufficient evidence for a scientific ordering" is never turned into "no
scientific value".

## A. Scientific wording corrections

These are text only: the same values, order, weights and review states.

**Acceptance for every A item:**

1. Engine totals, ranks, margins and pivotal inputs are byte-identical
   before and after. Re-run the probe in [REPRODUCTION.md](REPRODUCTION.md)
   and diff the JSON.
2. `git diff` touches only string literals (and their tests). No change to
   `src/data/`, weights or `criteria.ts` rules.
3. Unit and smoke tests assert the new strings, and the old strings no
   longer appear.
4. A manual check at desktop and phone widths confirms the text is visible
   where stated.

### A1. Card rationale: unreviewed link count (priority 1)

- **Current:** "Covers 2 of 3 open questions · adds close-up rover
  evidence".
- **Location:** `src/lib/prototype/mission-glass.ts:147` (`rationale`),
  rendered at `TaskCard.tsx:95–96`: Level 1 of each Mission Glass card.
- **Problem:**
  - "Covers" states as fact a count of AI-drafted, pending links.
  - The pending label exists only at Level 3.
- **Proposed:** "Linked to 2 of 3 open questions (AI-drafted links, not yet
  reviewed) · close-up rover evidence".
- **Acceptance:**
  - the Level 1 text contains "AI-drafted" and "not yet reviewed";
  - the count equals the engine's gap-coverage numerator;
  - nothing else changes.

### A2. Stability scope (priority 2)

- **Current, Mission Glass:** "Stays #1 in 6 of 6 runs with each weight
  changed by ±20%."
- **Current, research workspace:** "stays #1 in 6 of 6 runs with each basis
  weight changed by ±20%; lead over #2: N points."
- **Location:** `mission-glass.ts:155` (shown at `TaskCard.tsx:158`,
  "Priority holds"), and `DecisionSection.tsx:269–271`.
- **Problem:**
  - It reads as general robustness.
  - It perturbs three weights only.
  - It does not test unreviewed inputs; three are individually pivotal at
    100 pts.
- **Proposed:** "Weights only: stays #1 in 6 of 6 runs with each scored
  weight changed by ±20%. Not covered by this check: 47 unreviewed inputs;
  removing any one of 3 of them changes #1."
  - Uses `rankProvisional().pivotalInputs` and `unreviewedInputs`, which
    are already computed.
  - When there are no pivotal inputs: "Removing any single unreviewed input
    does not change #1."
- **Acceptance:**
  - the numbers equal `stability`, `unreviewedInputs.length` and
    `pivotalInputs.length` (2025-05-06 at 100 pts: 6/6, 47, 3; at 50 pts:
    4/6, 47, 3);
  - the strings contain "Weights only".

### A3. "Best existing support: orbital" (priority 3)

- **Current:** "Would add rover in situ evidence; best existing support for
  these hypotheses: orbital."
- **Location:** `src/lib/decision/engine.ts:248`. Shown in Mission Glass
  Level 3 (`EvidenceSheet.tsx:88`) and the research workspace
  (`DecisionSection.tsx:360`).
- **Problem:**
  - It reads as a scientific statement that no closer evidence exists.
  - The dataset holds rover measurements of Margin rocks; they are just not
    linked to these hypotheses.
- **Proposed:**
  - "Would add rover in situ evidence. Closest evidence currently linked to
    these hypotheses in this dataset: orbital. Other observations may not
    be linked yet (links await curation and review)."
  - Matching variant for line 249: "Its rover in situ evidence does not
    exceed the closest evidence currently linked to these hypotheses in
    this dataset (orbital)."
- **Acceptance:**
  - the evidence-quality `value` is unchanged for every task, date and
    budget;
  - only the explanation string changes;
  - engine unit tests pass with updated string expectations only.

### A4. "Already addressed" / "(addressed)" / "Addressed by" (priority 4)

- **Current:**
  - "No rover measurement yet (already addressed)" (Mission Glass);
  - "(addressed)" (research);
  - "Addressed by: <observations>" (research).
- **Location:** `EvidenceSheet.tsx:99`, `DecisionSection.tsx:109`,
  `EvidenceSection.tsx:125–126`.
- **Problem:**
  - It can read as "the scientific question is resolved".
  - The rule only records that a rover compositional measurement has been
    published.
  - The rule itself is AI-drafted and pending.
- **Proposed:**
  - Mission Glass: "No rover measurement yet: no longer counted as open
    (rover results have been published; MDI rule, awaiting review)".
  - Research: "(no longer counted as open: MDI rule, awaiting review)".
  - "Addressed by" becomes "No longer counted as open after: <observations>.
    This closes only the question of whether a rover measurement exists."
- **Acceptance:**
  - gap states are unchanged;
  - the strings contain "MDI rule" and "awaiting review";
  - no string says or implies the formation question is answered.

### A5. Lower priority

| # | Current (location) | Proposed |
|---|---|---|
| A5a | "adds close-up rover evidence" / "adds Earth-lab evidence, if returned" (`mission-glass.ts:113–116`) | "close-up rover evidence (MDI evidence-type assumption)" / "Earth-lab evidence, only if the sample is returned (not guaranteed)" |
| A5b | "Fill with suggested order" (`MissionGlass.tsx`, `mg-use-suggested`) | "Fill with provisional suggested order" |
| A5c | Research "lead over #2: N points" (`DecisionSection.tsx:271`) | "lead over #2: N points (provisional score)" |

## B. SCI-1: evidence and action definitions

This track proposes definitions and draft relationships only. Every new
relationship is drafted as `pending`. No scored data is edited until a
named reviewer approves it.

### B1. What each action would add, stated as questions for reviewers

| | Survey (Target A) | Abrade (Target B) | Core (Target C) |
|---|---|---|---|
| Historical work it repeats | SuperCam LIBS and Mastcam-Z at Turquoise Bay; WATSON/RMI (sol 920) | Amherst Point (sol 915) and Bills Bay (sol 935) abrasions; PIXL (Castle Geyser); SHERLOC (Pelican Point, Lefroy Bay) | three Margin cores (Pelican Point, Lefroy Bay, Comet Geyser) |
| Possible new information (hypothesis for review, not a finding) | Whether outcrops away from the sampled sites show sedimentary structures (the PDS notes their absence keeps igneous origins possible), and how composition varies laterally ("compositionally heterogeneous") | Whether an outcrop not yet sampled has a different lithology, or a different carbonate–silica–clast relationship, from the three samples | Whether a lithology not represented by the three cores exists and carries a question only laboratories can answer (detrital vs in-situ carbonate; crystallization ages) |
| Testable question (draft) | "Do outcrops at A show bedding or cross-bedding?" "Does composition at A fall outside the range reported for Turquoise Bay?" | "Is carbonate at B present as grains or as cement/alteration, at the scale PIXL and SHERLOC map?" (whether in-situ data can settle this is itself a reviewer question: the PDS points to the laboratory) | "Does C sample a lithology absent from the three cores?" Lab questions are conditional on return |
| Observations and instruments needed | Stand-off imaging and chemistry (Mastcam-Z, SuperCam). Capabilities are to be cited, not assumed | Abrasion plus PIXL, SHERLOC, WATSON. Capabilities are to be cited | Coring and sealing. Laboratory methods only after return; tube availability to be confirmed |
| Source gaps | Instrument documentation; full PDS reports for Pelican Point and Comet Geyser; geology at A | Instrument documentation; full PDS reports; which lithologies are already sampled; geology at B | Current official sample-return status; tube inventory; "Returned Sample Science Considerations" for all three cores; geology at C |
| Draft pending relationships | `task-gap: Survey → gap-sedimentary-or-igneous`, with the PDS quote above | Re-examine `Abrade → gap-lake-connection` (weak); draft an outcome-based discrimination assessment | Extend `da-core-detrital-carbonate` to the pyroclastic hypothesis and the "in situ" outcome |

### B2. Evidence and links (all pending)

1. **Link the rover results to the working hypotheses.** Draft links from
   `obs-sherloc-hydrated-carbonates`, `obs-pixl-castle-geyser` and the
   sample interpretations (`interp-silica-cemented-sandstone`,
   `interp-altered-igneous`) to `hyp-sedimentary` and
   `hyp-crystalline-igneous`.
   - The current schema links observations to interpretations and has no
     "sample interpretation supports unit hypothesis" type.
   - Propose that type as a schema change for review; do not force it into
     an existing type.
2. **Replace `asm-instrument-capability` with cited instrument
   documentation.** Primary NASA/PDS instrument sources, quoted verbatim.
3. **Record the current sample-return status** from an official source,
   dated, conditional and never guaranteed.
4. **Curate briefings for Pelican Point and Comet Geyser** from the PDS
   reports. Retry R1 and R2.
5. **Draft discrimination assessments for all three actions**, with an
   outcome per hypothesis, including "no discrimination".

### B3. Question structure (suggestions only; scored data is not edited)

- **GF as an umbrella.** Treat `gap-formation-unknown` as an umbrella
  question, not scored separately. Score its parts: GL, GS and, from the
  PDS, *depositional environment*, *stratigraphic position* and *detrital
  vs in-situ carbonate*. This would remove double counting.
- **Keep GN as history.** `gap-no-in-situ-data` stays as a closed record,
  "a rover measurement exists".
- **Who decides:** a scientist decides the structure. The engine changes
  only after approval.

## C. SCI-2: comparison and sensitivity

### C1. Explain simulated feasibility and scientific value separately

Show two blocks for each action:

- **Simulated feasibility:**
  - cost, budget fit and effort left;
  - deterministic;
  - labelled simulated.
- **Scientific value:**
  - per criterion: value, Not Evaluated with its reason, and the pending
    relationships it rests on;
  - no blended number until both science criteria can be evaluated from
    approved judgements.

The current blended total stays available, labelled "provisional combined
score", until review decides otherwise.

### C2. Input sensitivity, not only weight sensitivity

Each item lists the engine data it uses:

1. **Leave-one-out per unreviewed input.** Already computed
   (`pivotalInputs`). Display it next to the rank (A2).
2. **Per-task range.**
   - Score with all of the task's unreviewed links removed versus as
     drafted.
   - The order under "only feasibility and evidence type" (all task–gap
     links removed).
3. **Minimal review set.** The smallest set of pending relationships whose
   approval or rejection would decide #1. This tells reviewers where to
   start.
4. **Tie reporting.** When the margin is 0, show "tie, broken by lower
   simulated cost" instead of a rank difference (2025-05-06, 50 pts).

**Acceptance:**

- each output is reproduced by the probe method;
- no scoring rule changes.

### C3. What needs scientific approval and what does not

| Needs **no** scientific approval (presentation only; values unchanged) | Needs scientific review before any change |
|---|---|
| A1–A5 wording | Which task–gap links count (approve or reject entries) |
| Showing weight vs input sensitivity (C2.1–C2.4) | Adding or restructuring questions (B3) |
| Separating the feasibility and science blocks (C1) | Discrimination and priority values |
| Showing ties and their tie-break | Re-scoping the actions (B1) and their targets |
| Showing the time horizon and condition of lab-dependent value | Any change to weights, the evidence hierarchy or the score formula |
| | Any statement that one action is scientifically preferable |

A change in rank order is a **scientific conclusion** only when it follows
from approved relationships (the reviewed ranking). Every other order stays
"provisional".
