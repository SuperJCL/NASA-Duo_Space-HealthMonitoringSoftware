# Ranking integrity: reviewed vs provisional rankings (RI-1)

Status: **implemented 2026-11-05 (RI-1)**. It supersedes the design sketch
in `RANKING_INTEGRITY_PROPOSAL.md`; the differences are listed at the end.

Code:
- `src/lib/evidence/review-registry.ts`: registry, relationship
  enumeration, integrity checks.
- `src/lib/decision/review-modes.ts`: the two ranking modes.

Data: `src/data/scenarios/jezero-margin-unit.reviews.json`.

## 1. The scientific review registry

- **One registry.** It is a JSON file validated by Zod and is the only place
  where review state is stored. Scenario JSON contains no review fields; the
  loader attaches them from the registry.
- **What it covers.** The registry has one entry per scientific relationship
  that can affect a ranking. The build fails if any relationship is missing,
  duplicated, unknown or mismatched.

| Type | Entries | Can affect |
|---|---|---|
| `relevance-classification` (every observation, interpretation, gap) | 21 | What counts as local evidence; coverage denominator |
| `gap-hypothesis-link` | 9 | Competing hypotheses → discrimination, evidence quality |
| `task-gap-link` | 8 | Gap coverage |
| `observation-gap-link` | 4 | Whether a gap is still open |
| `hypothesis-support` | 4 | Best existing evidence level → evidence quality |
| `priority-statement` | 2 | Scientific priority |
| `derived-gap` | 1 | Rule-defined gap in coverage |
| `discrimination-assessment` | 1 | Hypothesis discrimination |
| **Total** | **50** | All `pending`, drafted by `ai-agent`, no reviewer |

**Excluded on purpose.** Regional-context links (`contextRecordIds`) are
not in the registry. They can only contribute evidence level 0, which every
task level (≥ 1) already exceeds, so they cannot change a score.

### Entry fields

| Field | Meaning |
|---|---|
| `id` | A stable id derived from the relationship, e.g. `task-gap:task-abrasion-proximity->gap-lake-connection` or `relevance:obs-crism-marginal-carbonates` |
| `type` | One of the eight relationship types above |
| `source`, `target` | The two ends of the relationship |
| `status` | `pending`, `approved`, `rejected` or `needs_revision` |
| `draftedBy` | Who drafted the entry |
| `evidence` | Verbatim quotes; they are checked by `npm run verify:citations` |
| `reasoning` | Why the relationship is believed to hold |
| `limitations` | Known weaknesses of the relationship |
| `reviewedBy`, `reviewedOn` | Who reviewed it and when |
| `reviewNotes` | Optional reviewer comments |

**Rules.**
- `reviewedBy` and `reviewedOn` are **required for any non-pending status**
  and **forbidden on pending entries**, so an approval cannot exist without a
  named reviewer.
- A verified citation is **not** an approval: verification checks a quote,
  review checks the reasoning.
- An entry's evidence may not be published after the relationship exists
  (no leakage through review text).

**How to record a decision.** Edit the entry: set `status`, `reviewedBy`,
`reviewedOn` and optionally `reviewNotes`. Then run `npm test` and
`npm run verify:citations`. The agent never sets `approved`, `rejected` or
`needs_revision` unless a named human reviewer asks it to.

## 2. Reviewed scenario ranking (primary)

- **Only approved relationships are used.** Every non-approved relationship
  is removed before scoring. Removing a relevance or derived-gap entry
  removes the whole record from the scoring input; it stays visible in the
  evidence panels.
- **Eligibility.** A task is *assessed* only if **every** relationship its
  scores depend on has been decided (approved or rejected):
  - its gap links;
  - those gaps' relevance, derivation, hypothesis links and addressing
    observations;
  - the competing hypotheses' relevance and their supporting observations.
  
  A task with any `pending` or `needs_revision` dependency is listed as
  **not assessed**, with the blocking review ids. It is never ranked, so no
  task wins because other tasks lack reviewed evidence.
- **Status.**
  - **Unavailable.** One of:
    - no assessed task;
    - fewer than two assessed feasible tasks;
    - the engine cannot rank;
    - no scientific criterion (coverage, discrimination, priority) is in the
      basis with a non-zero result for at least one task. Cost and evidence
      type alone are not a scientific ranking.

    The reason is shown, and **no winner is named**.
  - **Partial.** At least two assessed tasks, but some feasible tasks are not
    assessed. Those tasks are listed, and the UI says the comparison does not
    include them.
  - **Available.** Every feasible task is assessed.
- **Engine.** It is unchanged, and the curated criteria still need approved
  judgements.

## 3. Provisional exploratory ranking (collapsed by default)

- **Inputs.** All draft relationships **except rejected ones**. With no
  rejections it is **byte-identical to the M3 engine output**; this was
  verified on 36 states.
- **Unreviewed inputs.** Lists every unreviewed relationship it uses: 26 at
  the default snapshot. It also lists pending curated judgements, which are
  not scored.
- **Pivotal inputs.** Unreviewed inputs whose removal alone changes the top
  task, computed deterministically by leave-one-out. At 2023-09-08 there are
  four:
  - `relevance:gap-lake-connection`
  - the three abrasion task links (L3, L4, L5)

  At 2025-05-06 there are three:
  - `relevance:gap-lake-connection`
  - L4 and L5
- **Labelling.** "Provisional · not scientifically validated".

## 4. Current result with today's data

Nothing is approved.

- **Reviewed ranking:**
  - **unavailable** at 2023-09-08 (28 relationships await review);
  - **unavailable** with all evidence (50 relationships await review).
- **Provisional ranking:** the M3 ranking (abrasion 89, …), collapsed.

## 5. Differences from the proposal

1. `hypothesis-support` was added as a relationship type, and
   `contextRecordIds` was excluded, with the proof given in §1.
2. A per-task **eligibility** rule and a **partial** status were added, to
   satisfy "must not rank tasks solely because other tasks lack reviewed
   evidence".
3. The availability rule needs a **non-zero** scientific criterion, not just
   one in the basis. Example: if every task link were rejected, all coverage
   would be 0 and the order would be by cost alone.
4. Provisional mode drops **rejected** relationships.
5. **Bug found by a test.** The "N later records withheld" limitation was
   computed on the review-filtered data, so the review status of *future*
   records changed the displayed count. Both modes now take the count from
   the unfiltered snapshot.
