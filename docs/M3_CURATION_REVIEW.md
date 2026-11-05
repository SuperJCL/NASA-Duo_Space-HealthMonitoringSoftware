# M3 curation review: AI-drafted items awaiting human decision

Prepared on 2026-11-05 by the AI agent. **Nothing here has been approved.**
The "Suggested disposition" column is a recommendation only. The human
reviewer decides.

Data file: `src/data/scenarios/jezero-margin-unit.json`. Quotes are verbatim
and were verified live (`npm run verify:citations`, 37/37).

## A. Which unapproved items currently influence the ranking?

This was measured by removing one item at a time and re-running the engine
at the default weights. The script lives in the agent scratchpad and is not
part of the repo.

| Item | Affects ranking at 2023-09-08? | Affects ranking at 2025-05-06? |
|---|---|---|
| L1 Stand-off → *No rover measurement yet* | **Yes**: stand-off 81 → 67 | No (the gap is already addressed) |
| L2 Stand-off → *How the margin rocks formed* | **Yes**: 81 → 67 | **Yes**: 67 → 24 |
| L3 Abrasion → *No rover measurement yet* | **Yes — top task flips** to stand-off (abrasion 89 → 74) | No |
| L4 Abrasion → *How the margin rocks formed* | **Yes — top task flips** | **Yes — top task flips** to core |
| L5 Abrasion → *Link to the lake* | **Yes — top task flips** | **Yes — top task flips** to core |
| L6 Core → *How the margin rocks formed* | **Yes**: core 56 → 13 | **Yes**: core 70 → 56 |
| L7 Core → *Sedimentary or igneous?* | No (link not yet public) | **Yes**: core 70 → 56 |
| L8 HiRISE → *Link to the lake* | **Yes**: 40 → 26 | **Yes**: 40 → 26 |
| P1, P2 priority statements | No (Not Evaluated, so excluded) | No |
| D1 discrimination assessment | No (not yet public) | No (Not Evaluated) |

**Other AI-curated structures that influence the ranking but are not
review-gated yet:**
- **The derived gap *No rover measurement yet*.** Without it, at the default
  snapshot: stand-off 81 → 74, core 56 → 63.
- **Gap → hypothesis mappings.** These decide which hypotheses count as
  competing, and therefore the evidence-quality score and whether
  discrimination can be evaluated.
- **Observation → gap "addresses" links.** These close gaps at later
  snapshots.
- **The local / regional-context classification.** It sets the coverage
  denominator.
- **The evidence-hierarchy assumption.** With its weight set to 0, HiRISE
  overtakes coring.
- **Simulated costs and the default weights.**

**Conclusion.** The current top recommendation depends on unreviewed
AI-drafted links: removing any one of L3, L4 or L5 changes it. Policy choice
for the reviewer (see the proposal, decision D2):
- **(a)** keep counting pending links in coverage, as today, with a visible
  warning; or
- **(b)** count only approved links. In that case coverage becomes Not
  Evaluated until the review is done.

## B. Task → evidence-gap links (8)

| # | Claim | Source | Reasoning | Assumptions | Limitations | Suggested disposition |
|---|---|---|---|---|---|---|
| L1 | A stand-off survey (SuperCam, Mastcam-Z) gives a rover-based measurement of margin-unit composition. | None cited | The gap rule is "addressed once a rover compositional measurement … is published"; SuperCam is a rover compositional instrument. | `asm-instrument-capability`; stand-off analysis of natural surfaces counts as "compositional measurement". | Mastcam-Z is multispectral imaging, not elemental chemistry. Natural surfaces may be dust-coated or weathered. The gap's wording does not say whether stand-off data qualify. | **Revise.** Clarify the gap rule and cite a pre-2023 NASA instrument description, then approve. |
| L2 | Survey results inform how the margin rocks formed. | None | They are inputs for choosing targets. | Survey data are diagnostic of formation. | A loose "input to" relation; under this standard almost any task addresses the gap. | **Revise or reject.** Needs a stricter definition of "addresses" (directly produces evidence bearing on the competing hypotheses). |
| L3 | PIXL, SHERLOC and WATSON on an abraded surface give a rover compositional measurement. | None cited | Matches the gap rule directly. | `asm-instrument-capability`. | Using later knowledge (rover results 2023–2025) to justify the link would be hindsight; a pre-snapshot source is needed. | **Approve**, ideally with a pre-2023 instrument citation. |
| L4 | Fine-scale chemistry, mineralogy and texture of an abraded surface bear directly on how the rock and its carbonate formed. | None | Plausible petrological reasoning. | The measurements are diagnostic between lake deposition and mineral carbonation. | No pre-snapshot source states this. Hindsight risk: PDS later used such data, and still found the origin "undetermined". | **Needs expert review.** Approve only with a citation or the expert's own judgement. |
| L5 | Fine-scale textures and mineral relationships bear on whether the carbonate precipitated in a lake. | None | Horgan 2020 notes that lacustrine carbonates could preserve microbialite textures "detectable by Mars 2020". | Texture is diagnostic of lake precipitation. | Horgan's statement is conditional on a lacustrine origin; it is not a test of it. | **Revise.** Cite Horgan's sentence with the caveat, or downgrade. |
| L6 | Coring for Earth laboratories addresses how the rocks formed. | NASA blog 2023: "the team is eager to drill into these rocks and unlock their secrets" | The team states drilling is how it will learn more. | `asm-sample-return` (Earth analysis will happen). | The quote is about rover drilling, not Earth labs. The value depends on sample return, which is uncertain. | **Approve with a caveat** in the rationale (rover coring vs. Earth analysis). |
| L7 | Earth-lab study addresses *sedimentary or igneous?* | PDS Vol. 4: "Detailed laboratory study of the suite of grains/clasts would address this unknown" | Direct statement in the source. | `asm-sample-return`. | The PDS "unknown" is whether the carbonate is detrital or from in-situ alteration, which is narrower than the full sedimentary/volcanic/igneous question. | **Approve**, with the rationale narrowed to the detrital vs. in-situ question. |
| L8 | Targeted HiRISE stereo would re-examine the topographic basis of the lake hypothesis. | Horgan 2020: the proposal is based on "topographic properties, and location" | Tests one stated basis of the lacustrine proposal. | HiRISE is available for targeting (`asm-orbital-availability`). | **A HiRISE DTM of Jezero already exists** (Trek: "MRO HiRISE, Jezero DEM, Controlled"; Trek catalog record dated 2020-08-03, which is not necessarily when the DTM was produced), so new imaging may be redundant. Topography alone cannot settle the carbonate's origin. | **Revise:** reframe as "analyse the existing HiRISE DTM", or reject. |

## C. Scientific priority statements (2)

| # | Claim | Source | Reasoning | Assumptions | Limitations | Suggested disposition |
|---|---|---|---|---|---|---|
| P1 | Whether the carbonates are lacustrine is a high-priority question. | Horgan et al. 2020 (abstract): "This distinction is critical for evaluating the astrobiological potential of the site" | The source states it explicitly. | One peer-reviewed abstract is enough to flag priority. | The authors are proponents of the lacustrine hypothesis. Priority is binary in the engine. | **Approve.** |
| P2 | *How the margin rocks formed* is a high-priority question. | NASA blog 2023: the unit "played a pivotal role in selecting Jezero as the landing site" | The importance of the unit is used as a stand-in for the importance of the question. | The importance of the unit carries over to its formation question. | Indirect: the source speaks about the unit, not the question. It is an outreach blog by a student collaborator. | **Revise wording** to "the unit is described as pivotal" (approve as such), or find a formal Mars 2020 objective statement. |

## D. Hypothesis discrimination assessment (1)

| # | Claim | Source | Reasoning | Assumptions | Limitations | Suggested disposition |
|---|---|---|---|---|---|---|
| D1 | If Earth-lab study shows detrital carbonate grains, that favors a sedimentary origin over a crystalline igneous one. | PDS Vol. 4: "the origin of the carbonate, whether detrital grains or the result of in situ alteration, is still unknown"; "Whether Comet Geyser is a carbonated ultramafic igneous rock … or a cemented and altered sedimentary rock remains undetermined" | Detrital grains imply transport and deposition. | Detrital carbonate cannot come from an igneous protolith. | It ignores the **volcanic (pyroclastic)** hypothesis, which is also fragmental. It has only one outcome; the "in-situ alteration" outcome favors nothing. It becomes visible only from 2025-05-06. | **Reject in its current form,** or revise with an expert: add the volcanic hypothesis and define outcomes for both branches. |

## Registry ids (RI-1)

Decisions are now recorded in the review registry,
`src/data/scenarios/jezero-margin-unit.reviews.json`.

| Item | Registry id |
|---|---|
| L1 | `task-gap:task-standoff-survey->gap-no-in-situ-data` |
| L2 | `task-gap:task-standoff-survey->gap-formation-unknown` |
| L3 | `task-gap:task-abrasion-proximity->gap-no-in-situ-data` |
| L4 | `task-gap:task-abrasion-proximity->gap-formation-unknown` |
| L5 | `task-gap:task-abrasion-proximity->gap-lake-connection` |
| L6 | `task-gap:task-core-for-earth->gap-formation-unknown` |
| L7 | `task-gap:task-core-for-earth->gap-sedimentary-or-igneous` |
| L8 | `task-gap:task-orbital-stereo->gap-lake-connection` |
| P1 | `priority:gap-lake-connection#statement` |
| P2 | `priority:gap-formation-unknown#statement` |
| D1 | `discrimination:da-core-detrital-carbonate` |

RI-1 added 39 further entries: relevance classifications, gap–hypothesis
links, observation–gap links, hypothesis support and the derived gap. They
are also pending. RI-1 also found a fourth pivotal input:
`relevance:gap-lake-connection`.

## How to record a decision

For each item, set `review` to the following, keeping a short `notes` value:

```json
{ "draftedBy": "ai-agent", "status": "approved" | "rejected", "reviewedBy": "<name>", "reviewedOn": "YYYY-MM-DD" }
```

Alternatively, reply with a list such as "Approve L3, L7, P1; revise L1, L5,
L6, P2; reject L2, D1", and the agent will apply it. The agent applies only
the dispositions the reviewer gives.
