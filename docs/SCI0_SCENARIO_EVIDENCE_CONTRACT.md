# SCI-0: Scenario Evidence Contract

**Scenario:** the simulated 2026 EVA at Lefroy Bay, Mission Glass. The
scenario is `src/data/prototype/mission-glass.json`; the evidence is
`src/data/scenarios/jezero-margin-unit.json`.

## About this audit

- **Status:** research audit, docs only. No application code, data, review
  status or ranking formula was changed.
- **Inputs read:**
  - the evidence scenario and the review registry (50 entries);
  - `sources.json`;
  - the Lefroy Bay briefing;
  - the verified geo records;
  - the 2026 mission framing;
  - the Mission Glass scenario;
  - the UI strings that present ranks.
- **Engine probe:** read-only, using the existing `rankProvisional` and
  `rankReviewed` with `DEFAULT_WEIGHTS` and the orbital platform excluded,
  at:
  - 2025-05-06, the latest record date, used by Mission Glass;
  - 2023-09-08, the default historical snapshot;
  - budgets of 100 and 50 points.

  The probe was run from a temporary test file, deleted before commit.
- **Sources:** all claims come from the dataset's verified quotes;
  `verify:citations` confirms that all 129 are present in the live sources.
  **A verified quotation is not an expert validation.** No new sources were
  added.

## Scope of the conclusions

**Supplementary review materials:** see the package index in
[`sci0/README.md`](sci0/README.md):

- [evidence matrix](sci0/EVIDENCE_MATRIX.md);
- [ranking claims](sci0/RANKING_CLAIMS.md);
- [issue list](sci0/ISSUES.md);
- [reproduction record](sci0/REPRODUCTION.md), with exact parameters,
  hashes and full-precision outputs;
- [follow-up proposals](sci0/FOLLOW_UP_PROPOSALS.md).

**Evidence sufficiency is not scientific value.** This audit concludes that
the current dataset's evidence is insufficient to support a *scientific
ordering* of the three actions. It does **not** conclude that any action has
low or no scientific value.

- **Repeating an operation type is not the same as adding nothing.** All
  three actions repeat operation types already performed in the unit. A new
  survey, abrasion or core at another outcrop could still add information,
  for example a lithology or structure not yet sampled. The dataset simply
  does not describe what it would add.
- **What the evidence leaves open is the value, not its absence.** Where the
  sources show that earlier measurements left a question open, that
  constrains what a similar measurement can be *assumed* to resolve. It is
  not evidence that it would fail.

**Data cutoff, unread sources and unverified status:**

- The latest record in the dataset is 2025-05-06 (PDS Initial Reports
  Vol. 4).
- The quotes were re-verified live on 2026-11-07.
- The full list of unread sources and of unverified current-status items is
  in [`sci0/README.md`](sci0/README.md) §4.

## Verdict

**The scenario cannot yet support a meaningful, explainable scientific
comparison of the three actions.** It does support an honest *operational*
comparison: which simulated actions fit a simulated budget.

1. **The order comes from unreviewed links and simulated costs, not
   science.** At 2025-05-06 and 100 pts the provisional order is:

   | Action | Score |
   |---|---|
   | Abrade | 0.743 |
   | Core | 0.700 |
   | Survey | 0.671 |

   - **The scores come from three criteria only:**
     - gap coverage, which uses AI-drafted, pending task–gap links;
     - resource feasibility, which uses simulated costs;
     - evidence quality, which is identical (1.0) for all three actions and
       so separates nothing.
   - **Hypothesis discrimination and scientific priority are "Not Evaluated"
     for every action.**
   - **The lead is small and fragile.** Abrade leads by 0.043
     (0.04285714285714293). Removing any one of three unreviewed
     relationships makes Core #1 (the engine's `pivotalInputs`):
     - `relevance:gap-lake-connection`;
     - `task-gap:task-abrasion-proximity->gap-formation-unknown`;
     - `task-gap:task-abrasion-proximity->gap-lake-connection`.
   - **At 50 pts, Survey and Abrade tie exactly** (both
     0.6285714285714286). Survey is listed first only by the engine's
     cheaper-first tie-break.
2. **The reviewed ranking is unavailable.** All 50 relationships are
   pending; none is approved.
3. **Every action type has already been done in this unit, around the
   anchor site:**
   - stand-off imaging and analysis;
   - abrasion with proximity science;
   - coring of three Margin samples.

   The scenario does not model what a new survey, abrasion or core at
   Targets A, B or C would add to those. The project already recorded this
   problem as R4 (`docs/EVIDENCE_CURATION.md`).
4. **The targets are not verified places.** They are scenario-defined
   offsets 118–163 m from the verified Lefroy Bay site. There is no verified
   Margin-unit boundary, and nothing says what rock is at A, B or C.
5. **Both additional sources and a human scientific review are essential**
   before the ranking can be improved meaningfully (§8).

## 1. Mission scientific objective

**What the sources state (verified quotes):**

| Question | Source | Gap id |
|---|---|---|
| How did the margin rocks, and the carbonate in them, form? "we don’t yet know exactly how the margin rocks, or the carbonate within them formed" | NASA blog, 2023-09-07 | `gap-formation-unknown` |
| Are the marginal carbonates related to the lake? "it is unclear whether or not the carbonates in Jezero are related to the lacustrine activity" | Horgan et al. 2020 | `gap-lake-connection` |
| Is the unit sedimentary, volcanic (pyroclastic) or crystalline igneous? | Mars 2020 team, NASA blog, 2024-08-30 | `gap-sedimentary-or-igneous` |
| The depositional environment "has not yet been established", and whether the carbonate is "detrital grains or the result of in situ alteration … is still unknown" | PDS Initial Reports Vol. 4, 2023–2025 reports | **not** a gap in the dataset |

**Proposed objective, for review:**

> Help distinguish between the working hypotheses for the origin of the
> Margin unit by making measurements that add information *beyond the three
> existing Margin samples* (Pelican Point, Lefroy Bay, Comet Geyser).

This wording is the audit's proposal. It is not a NASA objective and has not
been reviewed.

**The framing is simulated:**

- The 2026 astronaut mission is fictional
  (`src/data/missions/jezero-2026.json`).
- The instruments are Perseverance's.
- The EVA steps, effort points, events and target positions are all
  scenario-defined.

## 2. The three candidate actions

**Abbreviations used below:**

- Gaps: GF = `gap-formation-unknown`, GL = `gap-lake-connection`, GS =
  `gap-sedimentary-or-igneous`, GN = `gap-no-in-situ-data`.
- "Blocking" = relationships pending review that keep the action out of the
  reviewed ranking.

| | **Survey the outcrops** (`task-standoff-survey`, Target A) | **Abrade and analyse** (`task-abrasion-proximity`, Target B) | **Core for Earth** (`task-core-for-earth`, Target C) |
|---|---|---|---|
| Instruments (scenario) | SuperCam, Mastcam-Z | PIXL, SHERLOC, WATSON | coring drill, Earth laboratories |
| Linked questions (all AI-drafted, pending) | GF; GN (closed at 2025-05-06) | GF, GL; GN (closed) | GF, GS |
| Citations on its links | none | none | 2 (blog "eager to drill"; PDS "Detailed laboratory study … would address this unknown") |
| Already done in the unit (sources) | SuperCam LIBS on Turquoise Bay natural surfaces and the Bills Bay abrasion ("compositionally heterogeneous"); Mastcam-Z multispectral (sol 936); WATSON/RMI at the core site (sol 920) | Amherst Point abrasion (sol 915, 2023-09-16, first in the unit); Bills Bay abrasion, 8 mm (sol 935), with SHERLOC (sols 938–939); PIXL on the Castle Geyser abrasion; SHERLOC at Pelican Point | three Margin cores: Pelican Point (M2020-923-25, 2023-09-23), Lefroy Bay (M2020-949-26, 2023-10-13), Comet Geyser (M2020-1088-27, 2024-03-11). PDS: "the two previous Margin samples" |
| Could it plausibly address the question? | **Partly.** Texture and layering bear on sedimentary vs igneous: PDS says "In the absence of strong evidence for sedimentary structures, the Margin unit could alternatively be … igneous". That link is **not** in the dataset. Natural surfaces may be dust-coated (registry limitation). | **Uncertain for a new target.** The same measurement types already produced carbonate, hydrated silica and Fe-Mg carbonate–silicate results, yet "Whether Comet Geyser is … igneous … or … sedimentary … remains undetermined". The value depends on choosing a lithology not yet sampled, which is not modelled. The GL link is weak: microbialite textures are conditional on a lake origin, not a test of it. | **Conditionally.** PDS states laboratory study "would address" detrital vs in-situ carbonate, and crystallization ages would bound timing. All of it depends on sample return, which is not guaranteed; the dataset only has NASA's Dec 2023 "will hopefully be brought back". The value of a 4th Margin core beyond the existing 3 is not assessed. |
| Unreviewed relationships it depends on | 21 blocking (2 task–gap) | 25 blocking (3 task–gap). Its GF and GL links are each pivotal. | 16 blocking (2 task–gap, plus the pending discrimination assessment) |
| Scenario-defined assumptions | rover access; instrument capability (uncited); 15 pts | rover access; instrument capability (uncited); 40 pts | rover access; **sample return**; 55 pts. Sample-tube availability and analysis timescale are not modelled. |
| Geography | Target A: offset −110 E / +120 N, **163 m** from Lefroy Bay. Simulated; inside the DTM crop. | Target B: +70 E / +95 N, **118 m**. Simulated. | Target C: +130 E / −45 N, **138 m**. Simulated. |
| Fair comparison? | Under-represented: its strongest source-supported question (GS) is not linked, so it scores 1/3 gap coverage. | Over-dependent on two weak, pivotal, unreviewed links. | Mixes a near-term in-situ result with a deferred, conditional lab result on one scale. Time horizon and conditionality are not modelled. |
| Scientific usefulness | **Not established by reviewed evidence.** No reviewed links and no discrimination assessment. Not assessed as low. | **Not established by reviewed evidence.** Not assessed as low. | **Not established by reviewed evidence.** One pending, AI-drafted discrimination assessment, whose limitations note it ignores the pyroclastic hypothesis. Not assessed as low. |
| Simulated feasibility | Fits at 100 and 50 pts | Fits at 100 and 50 pts | Fits at 100; **not** at 50 |

Common to all three actions:

- None has a verified geographic target. The anchor, Lefroy Bay, is a
  verified PDS site, with its coordinate convention *inferred* by
  cross-validation. Targets A, B and C are not verified outcrops: no source
  places Margin-unit rock, an accessible surface or a safe workspace there.
- Their DTM elevations (A −2,412 m, B −2,409 m, C −2,415 m) are real values
  at simulated points and say nothing about lithology.

## 3. Source-supported claims

| Claim | Class | Source |
|---|---|---|
| A distinct carbonate-bearing unit lies along the inner margin (CRISM) | Orbital observation | Horgan et al. 2020 |
| The marginal carbonates *may* be lake carbonates | Published hypothesis (proponents) | Horgan et al. 2020 |
| Mineral carbonation of olivine is an alternative | Published hypothesis (outreach blog) | NASA blog 2023 |
| Three working hypotheses: sedimentary, pyroclastic, crystalline igneous | Team statement | NASA blog 2024 |
| First abrasion in the unit (Amherst Point, sol 915) | Rover operation (imaging, not composition) | NASA blog 2023 |
| Carbonate, hydrated silica, Mg-sulfate; silica cement; sand-sized olivine/pyroxene grains (Lefroy Bay) | Rover observations (SHERLOC, PIXL, SuperCam, WATSON) | PDS Vol. 4 |
| Hydrated carbonates, first in Jezero (Pelican Point) | Rover observation (SHERLOC) | PDS Vol. 4 |
| Silica-rich areas and Fe-Mg carbonate + silicate (Castle Geyser / Comet Geyser) | Rover observation (PIXL) | PDS Vol. 4 |
| "Tentatively … silica-cemented … sandstone" (Pelican Point, Lefroy Bay) | Preliminary published interpretation | PDS Vol. 4 |
| Comet Geyser could be altered intrusive igneous; "remains undetermined" | Preliminary published interpretation | PDS Vol. 4 |
| Lab study of grains/clasts "would address" detrital vs in-situ carbonate | Proposed by source (conditional on return) | PDS Vol. 4 |
| Lefroy Bay "will hopefully be brought back to Earth" | Status statement, Dec 2023 | NASA, Meet the Mars Samples |
| Every task–gap link (8) | **AI-drafted, pending** | none for Survey and Abrade; quotes on 2 of Core's links |
| The GN rule ("open until a rover compositional result is published") | **AI-drafted rule, pending** | none |
| Priority statements (2) and discrimination assessment (1) | **AI-drafted, pending; not scored** | verified quotes, unreviewed reading |
| Costs, budget, effort events, target offsets, EVA steps | **Scenario-defined** | none (by design) |

## 4. Assumptions and uncertainties

### Scenario-defined assumptions (not science)

- `asm-simulated-costs`: effort points are abstract.
- `asm-rover-access`: "Traverse planning, terrain and hazards are outside
  this simulation."
- `asm-instrument-capability`: capabilities are "summarised by the MDI team
  … not taken from cited instrument documentation".
- `asm-sample-return`: "this task's value depends on this assumption".
- The target offsets, steps and events (scenario file).
- The 2026 astronaut persona.

### MDI methodology (pending review)

- `asm-evidence-hierarchy`: regional < orbital < rover < Earth lab.
- The derived GN rule.
- Equating Horgan's "Marginal Carbonates" with the Mars 2020 "margin unit".
  The registry notes that no source states this explicitly.

### Scientific uncertainty (sources)

- The interpretations are preliminary initial reports (Dec 2023 – 2025).
- Later peer-reviewed studies are not in the dataset. R1 (Zastrow & Glotch
  2021) and R2 (Moreland et al. 2025) remain blocked.

### A modelling artefact that affects comparison

- **Evidence quality is misleading at the present-day snapshot.** Its
  explanation reads "best existing support for these hypotheses: orbital",
  although the dataset holds rover measurements of Margin rocks. Those rover
  observations support sample-level interpretations (sandstone, altered
  igneous), which are not linked to the gap hypotheses. The engine therefore
  credits all three actions with the same evidence-quality gain.
- **Gaps overlap.** GF overlaps GL and GS, so gap coverage can count the same
  scientific question twice.

## 5. Missing evidence

1. **No reviewed scientific relationship.** None of the 50 is approved.
2. **No marginal-value model.** Nothing describes what a new measurement at A,
   B or C would add beyond the three existing Margin samples (R4).
3. **No target geology.** No verified unit boundary, outcrop, lithology or
   access information exists for A, B or C.
4. **No source-supported links for Survey and Abrade.** The best candidate
   text (the PDS statement on sedimentary structures) is not linked.
5. **No hypothesis-support links** from rover observations or PDS
   interpretations to the Margin-unit working hypotheses.
6. **Gaps not updated to the PDS framing.** Depositional environment,
   stratigraphic position and the detrital vs in-situ question are missing,
   and gap overlap is not declared.
7. **No cited instrument-capability documentation.**
8. **No current sample-return status** after Dec 2023, and no model of
   sample-tube availability.
9. **Discrimination assessments:** none for Survey or Abrade; Core's is
   AI-drafted and incomplete.
10. **No briefings for Pelican Point and Comet Geyser.** Only Lefroy Bay has a
    curated briefing.

## 6. Task comparison readiness

| Criterion | State at 2025-05-06 | Usable for a scientific comparison? |
|---|---|---|
| Gap coverage | Evaluated from AI-drafted, pending links; gaps overlap | **Provisional only** |
| Hypothesis discrimination | Not Evaluated (Core: 1 pending assessment; others: none) | **No** |
| Scientific priority | Not Evaluated (2 pending statements) | **No** |
| Evidence quality | 1.0 for all three; rests on incomplete support links | **No.** It does not discriminate and its text is misleading. |
| Resource feasibility | Evaluated on simulated costs | **Operational only** (valid as a simulation) |
| Reviewed ranking | Unavailable (50 pending) | **No** |
| Stability | 6/6 at 100 pts, 4/6 at 50 pts; **weights only**. 3 pivotal unreviewed inputs at each budget | Shows fragility |

**Readiness:**

- Operational comparison (fits / does not fit / order within a simulated
  budget): **ready**.
- Scientific comparison: **not ready.**

## 7. Recommendations

These recommendations change nothing yet; SCI-1 and SCI-2 must not start
until this audit is reviewed.

### SCI-1: evidence and curation (every new judgement drafted as `pending`)

1. **Re-scope the actions for the present-day framing (R4).** Define each
   action by the new information it would add beyond the three Margin
   samples, with a scientist's review. Examples:
   - a survey aimed at sedimentary structures;
   - an abrasion of a lithology not yet sampled;
   - a core only where a laboratory question cannot be answered in situ.
2. **Add source-supported, pending task–gap links where text exists.** For
   example, Survey → GS through the PDS sedimentary-structures statement.
   Re-examine the weak links: Survey → GF ("input to") and Abrade → GL.
3. **Add pending hypothesis-support links** from the rover observations and
   PDS interpretations to the working hypotheses, so that evidence quality
   reflects the rover data that already exists.
4. **Bring the gaps up to the PDS framing.** Add environment, stratigraphy
   and detrital vs in-situ carbonate, and declare overlaps so that coverage
   does not double-count.
5. **Replace `asm-instrument-capability` with cited instrument
   documentation.** Record the current, official sample-return status;
   never treat return as guaranteed.
6. **Widen the reading base.** Curate Pelican Point and Comet Geyser
   briefings, and unblock R1 and R2.
7. **Draft discrimination assessments** for all three actions, with an
   outcome per hypothesis, including the pyroclastic one.

### SCI-2: ranking and presentation (only after review)

1. **Show scientific usefulness and simulated feasibility as two separate
   axes,** not one blended score. Feasibility should act as a constraint.
2. **Next to any rank, show input sensitivity** ("depends on N unreviewed
   links; removing one changes #1"), not only weight stability.
3. **Condition lab-dependent value on sample return, and show its time
   horizon.**
4. **Keep the reviewed ranking primary.** Nothing changes without approval.

## 8. Are more sources or a scientific review essential first?

**Yes, both.**

- **Without review,** reweighting would only reshuffle AI-drafted inputs.
  Discrimination and priority stay unscored, and the reviewed ranking stays
  unavailable.
- **Without additional sources,** new links would be AI judgement rather than
  source-supported. The missing sources include:
  - instrument documentation;
  - the current sample-return status;
  - later Margin-unit literature;
  - the PDS reports for Pelican Point and Comet Geyser.

**Order of work:**

1. Review this contract.
2. Re-scope the actions (R4).
3. Curate and review (SCI-1).
4. Only then change the ranking or its presentation (SCI-2).

## Ranking statements: display safety

### Safe to display now (true as stated; keep the existing labels)

- "Simulated scenario … not a NASA plan".
- Targets are "scenario-defined positions".
- Lefroy Bay, Pelican Point and Comet Geyser are verified PDS sample sites.
  Their coordinate convention is inferred by cross-validation
  (`docs/GEO_DATA.md`; the 2D map draws inferred sites with a dashed ring).
- Historical facts with their sources: the abrasions, analyses and three
  Margin cores already performed, and the measured results, with the class
  shown.
- Fit statements: "Fits: 40 of 100 pts" and "Not feasible: needs 55 pts, 50
  available". They are labelled simulated points.
- "Reviewed ranking unavailable: 50 relationships await expert review".
- A criterion shown as "Not Evaluated", with its reason.
- Straight-line separations, labelled "not a travel distance".
- Verified quotations, labelled as quotations rather than validations.

### Must stay labelled provisional (most already are)

- **Rank numbers and order:** "Provisional priority #n", "Fill with suggested
  order", the replan "Suggested" order, and "Why this rank (existing engine,
  provisional)".
- **"Covers N of 3 open questions" on the Level 1 card.** It counts
  AI-drafted, pending links. Level 3 labels each link, but **Level 1 does
  not**: add the label in SCI-2.
- **"Stays #1 in 6 of 6 runs …":** label it as weight stability only. It
  hides the input fragility.
- **"adds close-up rover evidence" / "adds Earth-lab evidence, if
  returned":** label these as an MDI evidence-type assumption.
- **A gap shown as "already addressed":** label it as an AI-drafted rule.

### Cannot currently be supported (do not display as claims)

- Any statement that one action is scientifically more valuable or more
  important than another, or that the order is a NASA or expert
  recommendation.
- "Best existing support for these hypotheses: orbital" at the present-day
  snapshot. It contradicts rover data in the dataset.
- That a new survey or abrasion would resolve the origin question.
  Existing in-situ data left it "undetermined".
- That a core will reach Earth, or that lab results will be obtained.
- That Targets A, B or C are Margin-unit outcrops, accessible or safe.
- That the actions are new for this unit. All three are repeat operation
  types (R4).
- Any value for hypothesis discrimination or scientific priority.
