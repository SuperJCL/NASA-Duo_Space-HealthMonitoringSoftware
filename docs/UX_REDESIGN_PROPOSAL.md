# MDI — M3 acceptance & UX redesign proposal

Status: **proposal; direction approved 2026-11-05** (decisions 1–3; see the
PRD decisions log). D2 was decided as *not approved*: unreviewed
relationships must not silently drive an authoritative recommendation (see
`docs/RANKING_INTEGRITY_PROPOSAL.md`). UX-0 was implemented on 2026-11-05.
**UX-1 (guided shell) was implemented on 2026-11-05 on branch
`ux1-guided-workflow`**, not yet merged; manual test script:
`docs/UX1_MANUAL_TEST.md`. UX-2 to UX-5 are not started.
Date: 2026-11-05. Baseline: branch `m3-scientific-integrity` @ `64506ea`.

## 1. M3 acceptance status

| M3 item | Status |
|---|---|
| Snapshot policy, date distinctions, no future leakage | Met; tested, including a metamorphic test |
| Nue / Margin Unit reclassified as regional context | Met; documented in `SCIENTIFIC_REVIEW_M3.md` |
| Five-dimension model; Not Evaluated; curated vs deterministic | Met |
| Scientific integrity tests; citations valid (37/37 live) | Met |
| Literature: Zastrow & Glotch 2021, Moreland et al. 2025 | **Blocked.** `pmc.ncbi.nlm.nih.gov` is proxy-denied; agupubs returns a bot challenge |
| Optional sample markers | Deferred: the PDS coordinate convention is not stated in the source |
| Manual testing: translation crash | **Bug found; root cause confirmed** (§3.6). Not fixed, pending approval |
| Manual testing: usability | **Not acceptable** per the owner's feedback. This proposal addresses it |

Recommendation:
- Fix the translation crash on the M3 branch (UX-0, small).
- Then merge M3, with the literature item explicitly waived or deferred to
  M4.
- Do the UX work on new branches.

## 2. Diagnosis (measured on M3, 1440×900 desktop)

- **Length.** The right panel is **5,431 px** tall in a 665 px viewport,
  about 8 screens.
- **Recommendation buried.** It starts at **4,387 px**, about 6.6 screens of
  scrolling. The reveal is at 5,324 px.
- **Density.** 2,079 words, 49 badges, 26 controls and 17 quotes are all on
  one scrolling panel.
- **Jargon in the primary UI.**
  - "gap" ×21, "hypothes…" ×21
  - "Not Evaluated"/NE ×16, "pending" ×12, "curated" ×12
  - "deterministic" ×7
- **Map disconnected.** No interaction in the panel changes the map, and
  the map shows no investigation geometry.
- **Unhelpful empty states.**
  - "No task is feasible…" gives no recovery path.
  - The reasons for NE appear only in hover tooltips, which neither touch
    users nor screen-reader users can reach.
- **Scientific-review gap** (`M3_CURATION_REVIEW.md`). The current top task
  changes if any one of three unreviewed AI-drafted task–gap links is
  removed.

## 3. Proposed experience

### 3.1 Interaction model: a guided mission with five steps

The design question is: *"You have limited time to investigate Mars. What
should you observe next, and why?"*

| Step | User question | Primary content (always visible) | Advanced / scientific details (expandable) |
|---|---|---|---|
| 1 Mission | "What am I doing?" | Briefing: the date is 8 Sep 2023, and Perseverance is about to reach the margin unit. The goal in one sentence, a 5-step preview, the expected outcome. The note "Simulated scenario: not a NASA plan". CTA: "Look at the evidence". | Scenario definition, snapshot policy, how dates work |
| 2 Evidence | "What did we know then?" | Plain-language cards: **Measured** (1) and **Proposed explanations** (2). Each has a source chip (publisher + date). A "Regional background (4)" toggle with a one-line explanation. | Verbatim quotes, observation vs interpretation, curation notes, relevance rules |
| 3 Unknowns | "What don't we know?" | 3 **open questions**. Each shows "Why it matters" (marked *expert review pending*) and "Which explanations it could tell apart". | Cited vs derived questions, the derivation rule, priority-statement provenance |
| 4 Decision | "What could we do?" | 4 **option cards**: what it does, what it could tell us, cost against the budget. The **mission budget** and platform toggles sit inline with validation. "Compare side by side" is optional. | Weights, the five factors with their rules, the task–gap link rationales and their review status |
| 5 Result | "What should we do, and how sure are we?" | **Recommendation hero:** best option for this scenario. A "Scenario decision score 89/100" chip that links to its explanation. Three plain reasons. A "How confident?" panel listing factors not scored yet and the stability check. CTA: "Reveal what happened next". | Full breakdown, assumptions, limitations, engine version, then the retrospective timeline |

**Navigation.**
- A stepper (`<nav aria-label="Mission steps">`, with `aria-current`) is
  always visible at the top.
- Each step ends with Back and Next.
- Steps can be revisited freely. Changing the mission date in any step keeps
  the user on that step and recomputes the result.
- State stays in memory. Optional `?step=` deep links are deferred because
  of the `cacheComponents`/`useSearchParams` Suspense requirements.

**Always-visible integrity strip.** This appears on every step and is never
collapsed:
- `Mission date: 8 Sep 2023 · 11 later records hidden`
- `Simulated mission`
- `9 expert reviews pending` (the count visible on 8 Sep 2023; 11 in total), which links to the review list

### 3.2 Layout

```
Desktop (≥1024 px)
┌───────────────────────────────────────────────────────────────────────┐
│ MDI · Jezero Margin Unit   [1 Mission][2 Evidence][3 Unknowns][4 Decision][5 Result] │
│ Mission date 8 Sep 2023 · 11 later records hidden · Simulated · 9 reviews pending  │
├──────────────────────────────────────┬────────────────────────────────┤
│                                      │  Step panel (current step only) │
│      NASA Trek map (≈ 58%)           │  heading + 1-sentence purpose   │
│  - step-driven layers & highlights   │  primary cards                  │
│  - legend shows location precision   │  ▸ Scientific details           │
│                                      │  [Back]                 [Next →]│
└──────────────────────────────────────┴────────────────────────────────┘
Mobile (<1024 px): stepper (scrollable) → collapsible map (35dvh) → step panel.
```

- Each step's panel should fit about 1–2 screens.
- The recommendation becomes its own screen: Step 5.

### 3.3 Plain-language vocabulary

The primary UI uses these terms. The scientific term remains in tooltips,
in details sections and in the glossary.

| Internal / scientific term | Primary UI wording |
|---|---|
| Evidence gap | Open question |
| Observation (orbital / in situ) | Measured from orbit / Measured by the rover |
| Hypothesis / Interpretation | Proposed explanation / Scientists' conclusion |
| Regional context | Regional background (not specific to this site) |
| Hypothesis discrimination | Helps tell the explanations apart |
| Gap coverage | Answers open questions |
| Evidence quality gain | Better kind of evidence than we have |
| Curated + pending review | Expert judgement — **awaiting review** (drafted by AI) |
| Deterministic | Calculated from the data |
| Not Evaluated (NE) | **Not scored yet** — and the reason, as visible text, not hover only |
| Snapshot date | Mission date |
| Score | **Scenario decision score** (not a probability, not a NASA recommendation) |

- Every term in the right-hand column links to a glossary entry with its
  formal definition.
- **No scientific claim text is rewritten.** Plain language applies only to
  labels, headings and explanations of the method. Source quotes and record
  statements stay as they are. If plain summaries of claims are wanted, they
  become new curated fields that need human review.

### 3.4 Scientific provenance presentation

- **Source chip** on every card, e.g. `NASA · 2023-09-07`. It expands to the
  verbatim quote, the link, the locator and the date basis.
- **Review badges are never hidden.** Collapsed sections show counts, e.g.
  "▸ Scientific details (2 awaiting review)".
- **Regional background** is a labelled, separate group. Its cards have a
  distinct pattern and the text label "Regional background". Colour alone is
  never the signal.
- **Score label.** The text "Scenario decision score" is always shown with
  the number. Its explanation: "How well this option fits this simulated
  scenario's open questions and budget, using the factors that could be
  scored. It is not the probability that a hypothesis is true and not a
  NASA recommendation."
- **Unscored factors** are stated in the hero, e.g. "2 of 5 factors not
  scored yet: awaiting expert review".

### 3.5 Map integration (verified geometry only)

| Layer | Source | Precision label | Steps |
|---|---|---|---|
| Jezero crater outline and centre | USGS Gazetteer, Feature 14300 (MDIM 2.1 WKT, 361 vertices; 18.41°N, 77.69°E) | "Crater outline (USGS)" | 1–5 |
| CTX / HiRISE mosaic coverage extents | Trek capabilities BoundingBox | "Data coverage area" | 2 |
| Margin unit | **No published footprint found.** No polygon is drawn | Textual locator from the source, e.g. "along the inner margin… near the western delta" (Horgan 2020) | 2–3 |
| Sample coring sites (Pelican Point, Lefroy Bay, Comet Geyser) | PDS Vol. 4 lat/lon | **Only after the convention is confirmed** (spike) | 5 (reveal only) |
| Perseverance traverse | Trek product "Perseverance (Mars 2020) Path" (Feature service, catalog date 2024-07-03) | Spike: verify format and dates. Reveal only, because it postdates the default snapshot | 5 (reveal only) |

**Interaction.**
- Selecting a card highlights its geometry.
- Cards without geometry say "No mapped location in the source", so
  absence is explicit.
- Moving between steps changes which layers are shown.
- The map never shows post-snapshot geometry before the reveal.

### 3.6 Empty, error and edge states (including the translation crash)

- **Translation crash: root cause confirmed.**
  - Browser page translation replaces React's text nodes. When every task
    becomes infeasible, the comparison-table header `{inBasis ? "" : "*"}`
    removes such a text node, and the page throws `removeChild` NotFoundError.
  - It reproduced with a simulated translation. In a throwaway worktree,
    wrapping that expression in a `<span>` fixed both crash paths (all
    platforms off; budget 0).
  - **Fix:** wrap the conditional-text sites in elements (6 found so far; the fix includes a full audit). Add a
    "simulated translation" pass to the smoke test.
  - **Related logic fix:** with zero feasible tasks, the basis currently
    says "In ranking basis". It should say "not applicable".
- **No feasible option.** Replace the message with an explanation card. It
  lists each option's blocking reason and offers one-click fixes, e.g.
  "Enable rover operations", "Raise budget to 40 (allows abrasion)" and
  "Restore defaults".
- **All factors weighted 0:** "Choose at least one factor that matters", with
  a reset button.
- **Tile errors:** a non-blocking map banner with a retry.
- **Dates:** an invalid or out-of-range date shows inline help with the valid
  range (2019-11-11 to 2025-05-06). The control is not ignored silently.
- **Accessibility.**
  - Focus moves to the step heading on navigation.
  - NE reasons are visible as text.
  - Recommendation changes are announced in a polite live region.
  - Keyboard-operable stepper and toggles.
  - Contrast checked.
  - `prefers-reduced-motion` disables map fly animations.

## 4. What is preserved, and what changes

**Preserved, unchanged.**
- Scientific engine, schema and integrity rules.
- Snapshot filtering.
- Data, citations, `verify:citations`, and all 85 tests.
- The NASA Trek map and its Mars geodesy.
- Next.js/TypeScript architecture. No new dependencies are planned: the
  stepper, disclosure and glossary are plain React and Tailwind.

**Changes (UI layer only).**
- `InvestigationWorkspace` becomes a step controller.
- New components:
  - `components/flow/{Stepper, IntegrityStrip, MissionStep, EvidenceStep, UnknownsStep, DecisionStep, ResultStep}`
  - `components/common/{Disclosure, SourceChip, Glossary, EmptyState}`
- The existing cards are reused inside the steps.
- The map gains a small selection context, plus a verified-geometry data
  module: `src/data/geometry/*.json` with citations, validated by Zod and
  checked by the integrity tests.

**Why.** These changes fix the hierarchy and onboarding problems without
touching the logic that was verified in M3.

## 5. Work breakdown

Complexity: S/M/L. Estimates are agent wall-clock time and are
**estimates, not measurements**. Each milestone keeps all tests green and
adds smoke checks.

| # | Milestone | Scope | Complexity (estimate) |
|---|---|---|---|
| UX-0 | Translation-crash fix | Wrap the conditional text; fix the empty-basis logic; simulated-translation smoke test | S (≈20–40 min) |
| UX-1 | Guided shell | Stepper, integrity strip, step panels reusing existing cards, Back/Next, focus management | M (≈1–1.5 h) |
| UX-2 | Plain language and progressive disclosure | Vocabulary, glossary, source chips, Scientific details sections, visible NE reasons | M (≈1 h) |
| UX-3 | Result and states | Recommendation hero with score label, "How confident?" panel, reveal timeline, empty/error states with recovery actions | M (≈1 h) |
| UX-4 | Map integration | Gazetteer outline, coverage extents, card↔map highlighting, precision legend. Spikes: sample convention, traverse path | L (≈1.5–2 h, plus spikes) |
| UX-5 | Polish and acceptance | Accessibility pass, responsive check, usability script for first-time users (5 tasks) | M (≈1 h) |

## 6. Risks

- **Plain language could distort the science.** Mitigation: only labels and
  method text change; claims and quotes stay verbatim.
- **Progressive disclosure could hide warnings.** Mitigation: the integrity
  strip and the review counts stay visible, and a smoke test asserts it.
- **Unreviewed links drive the top recommendation.** This is not a UX
  problem, but the UX must make it obvious (decision D2).
- **Geometry availability.** The margin unit has no published footprint.
  The sample-coordinate convention and the traverse data are unverified.
- **No real-user testing.** The agent can script checks but cannot judge
  first-time comprehension; the team must run the usability script.
- **Scope creep** into M4 science work. Mitigation: UX milestones change the
  UI only.

## 7. Decisions needed from the owner

- **D1. Interaction model:** approve the guided 5-step mission, or propose
  changes.
- **D2. Unreviewed links in coverage:** keep counting them with a visible
  warning, or count only approved links (coverage is Not Evaluated until
  review).
- **D3. M3 merge path:** UX-0 fix → merge M3 with the literature item
  deferred? Or wait for the literature?
- **D4. Curation dispositions** for the 11 items (`M3_CURATION_REVIEW.md`).
- **D5. Order of UX milestones,** and whether UX-4's spikes are in scope now.
