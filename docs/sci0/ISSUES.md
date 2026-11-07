# SCI-0 issue list

This file lists issues only; nothing here is implemented.

- **Severity** reflects the risk of misleading a user about the science:
  - **H:** a wrong scientific impression is likely;
  - **M:** a wrong impression is possible;
  - **L:** completeness.
- **Track:** A = wording correction (no formula, weight or review change);
  B = SCI-1 evidence and action definition; C = SCI-2 comparison and
  sensitivity. Proposals are in
  [FOLLOW_UP_PROPOSALS.md](FOLLOW_UP_PROPOSALS.md).

**Ground rule for reading these issues:** "current evidence is insufficient
to support a scientific ordering" is **not** "the action has no scientific
value". No issue below concludes the latter.

| # | Issue | Evidence | Effect | Sev. | Track |
|---|---|---|---|---|---|
| I1 | The order is set by unreviewed inputs | 2025-05-06, 100 pts: three single removals each make Core #1; at 50 pts, Survey and Abrade tie exactly (REPRODUCTION §4–5) | Rank numbers look more settled than they are | H | A, C |
| I2 | Level 1 states AI-drafted link counts as fact ("Covers N of 3 open questions") | `mission-glass.ts:147`; registry `task-gap:*` all pending | Users read scientific coverage | H | A |
| I3 | The stability statement covers weights only | `engine.ts` `recommend`: 6 weight trials; inputs untested | "Priority holds" overstates robustness | H | A, C |
| I4 | "Best existing support … orbital" contradicts the dataset at 2025-05-06 | `engine.ts:248`; rover observations (`obs-sherloc-hydrated-carbonates`, `obs-pixl-castle-geyser`) support sample-level interpretations that are not linked to the gap hypotheses | It implies no rover evidence exists for these hypotheses | H | A (wording), B (links) |
| I5 | "(already addressed)" / "(addressed)" can read as "question resolved" | `EvidenceSheet.tsx:99`, `DecisionSection.tsx:109`, `EvidenceSection.tsx:125`; `derived-gap:gap-no-in-situ-data#rule` pending | It may suggest the origin question is settled | M | A |
| I6 | Evidence quality is identical (1.0) for all three actions | REPRODUCTION §4 | It adds score but no discrimination; its text implies a gain for each | M | B, C |
| I7 | Both science criteria are Not Evaluated for every action | discrimination: none for Survey and Abrade, pending for Core; priority: 2 pending statements | The order cannot express scientific usefulness | H | B |
| I8 | The actions repeat operation types already performed in this unit | three Margin cores, the Amherst Point and Bills Bay abrasions, PIXL/SHERLOC/SuperCam/Mastcam-Z results (EVIDENCE_MATRIX §1, §7); R4 | The added value of A, B and C over existing work is undefined. **This is not proof of no value.** | H | B |
| I9 | Targets A, B and C have no geology | scenario offsets only; no verified Margin-unit boundary | No basis for target-specific value; access and safety unknown | M | B |
| I10 | Survey's best source-supported question is not linked | PDS: "In the absence of strong evidence for sedimentary structures, the Margin unit could alternatively be a pyroclastic or extrusive or intrusive igneous deposit." Survey links only GF and GN | Survey's gap coverage is understated | M | B |
| I11 | Weak links among the scored inputs | Survey→GF ("Loose 'input to' relation"); Abrade→GL (microbialite textures conditional on a lake origin) | Pivotal inputs include weak links | M | B |
| I12 | The questions overlap and are out of date | GF overlaps GL and GS; the PDS framing (depositional environment, stratigraphy, detrital vs in-situ carbonate) is not a gap | Possible double counting; questions behind the sources | M | B (proposal only) |
| I13 | Instrument capability is uncited | `asm-instrument-capability` | Measurement plausibility rests on an MDI summary | M | B |
| I14 | Sample-return status is stale and tube availability is not modelled | Newest status: Dec 2023 "will hopefully be brought back" | Core's value is conditional, and the condition is not displayed with the score | M | B, C |
| I15 | Core mixes a deferred, conditional result with in-situ results on one scale | engine evidence level `lab` > `rover`; no time horizon | Not fairly comparable without explicit conditioning | M | C |
| I16 | Simulated feasibility and scientific value are blended into one total | `total = Σ weight × value / 7`, with feasibility weight 2 | A cheaper action can outrank on cost alone (e.g. the 50 pts tie) | H | C |
| I17 | The reading base is narrow | R1 and R2 blocked; only Lefroy Bay has a briefing; no peer-reviewed Margin-unit results after the initial reports | Interpretations may be outdated | M | B |
| I18 | The Marginal Carbonates are equated with the margin unit | `relevance:obs-crism-marginal-carbonates` limitation | The lake hypothesis may not apply as stated | L | B |
| I19 | The current mission status is unverified | see the review-package README, "Unverified current status" | Present-day framing may be stale | M | B |
