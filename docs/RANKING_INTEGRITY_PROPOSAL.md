# Ranking integrity: reviewed vs exploratory relationships

Status: **proposal (not implemented)**. Date: 2026-11-05.

Owner decision 4 (2026-11-05): *Unreviewed AI-curated scientific
relationships must not silently influence an authoritative recommendation.*

## Problem

The engine (v0.2.0) scores tasks using relationships that the AI agent
drafted and no human has reviewed:

| Relationship | Used by | Review field today |
|---|---|---|
| Task → gap links (8) | Gap coverage; which hypotheses count as competing | `review`, all pending |
| Gap → hypothesis mappings | Competing set; discrimination evaluability; evidence quality | none |
| Observation → gap "addresses" links | Which gaps are open | none |
| Derived gap (`gap-no-in-situ-data`) | Gap coverage | none |
| Local / regional-context classification | Coverage denominator; evidence quality | none |
| Priority statements (2), discrimination assessment (1) | Already review-gated; currently Not Evaluated | `review`, all pending |

At the default snapshot, removing any one of three links (L3, L4, L5)
changes the top task (`docs/M3_CURATION_REVIEW.md` §A). The current UI flags
pending links in the coverage explanation, but it still presents the result
as "Top-ranked".

## Proposal (small; the engine stays unchanged)

1. **One review manifest.** Add
   `src/data/scenarios/jezero-margin-unit.reviews.json`, mapping a
   deterministic relationship key to a `Review`. Example keys:
   - `task:task-abrasion-proximity→gap:gap-lake-connection`
   - `gap:gap-lake-connection→hyp:interp-lacustrine-carbonate`
   - `obs:…→gap:…`
   - `gap:gap-no-in-situ-data#derived`
   - `relevance:obs-crism-marginal-carbonates`

   The existing inline `review` fields on links, priorities and assessments
   migrate into it, so the reviewer edits **one file**. An integrity test
   requires an entry for every ranking-relevant relationship. Missing entries
   are treated as pending.
2. **A pure filter.** `selectReviewed(snapshot, reviews) → ReviewedSnapshot`
   (branded). It drops every relationship whose review is not `approved`.
   Records stay, because their quotes are source-verified; their
   *connections* are removed.
3. **Two runs of the same engine.**
   - **Validated:** `recommend(selectReviewed(snapshot))`. This becomes the
     main result.
   - **Exploratory:** `recommend(snapshot)`, as today. Shown only with a
     "Provisional — uses unreviewed relationships" label.
4. **Availability rule.** A validated ranking is **available** only if its
   ranking basis includes at least one scientific criterion: coverage,
   discrimination or priority. Feasibility and evidence quality alone would
   rank by cost and platform, not by science. Otherwise the result reads:
   *"Validated ranking unavailable: N relationships await expert review."*
   It lists them and links to the review list.
5. **Exploratory transparency.**
   - The provisional ranking lists every unreviewed input it used.
   - It marks the **pivotal** inputs: those whose individual removal changes
     the top task.
   - Pivotal inputs are found deterministically, by recomputing once without
     each input (about 20 relationships, which is cheap).
6. **UI, minimal and before UX-1.**
   - The result card states first whether a validated ranking is available.
   - The provisional ranking has a different style and title, and never uses
     the word "recommendation" without "provisional".

**Expected result with today's data.** Nothing is approved, so the validated
ranking is **unavailable**. The provisional ranking is the current one
(abrasion 89 …), with pivotal inputs L3, L4 and L5.

## Tests to add

- **Metamorphic:** adding, changing or removing *unapproved* relationships
  never changes the validated result.
- Approving a relationship changes the validated result deterministically
  (fixture with hand-computed values).
- The validated result is unavailable when no scientific criterion is
  evaluable from approved relationships.
- The exploratory result lists exactly the unreviewed inputs it used, and
  pivotal detection is correct on the fixture.
- The existing 86 tests and the 36-state engine baseline stay unchanged,
  since the engine is not modified.

## Effort and open choices

- **Complexity:** S–M. **Estimate (not measured):** about 1–1.5 h of agent
  time.
- **Dependencies:** none new. No engine changes. Data changes: the manifest,
  with all entries pending.
- **Choices for the owner:**
  - (a) one manifest vs inline review fields;
  - (b) whether relevance classifications must be reviewed;
  - (c) provisional ranking expanded or collapsed by default;
  - (d) whether the minimum-basis rule above is acceptable.
