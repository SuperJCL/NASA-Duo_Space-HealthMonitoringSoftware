# Mars Discovery Intelligence (MDI) — Product Requirements

Status: **v0.3 — direction approved 2026-11-04** (retrospective simulator,
Zod validation, vertical-slice-first)
Supersedes: "Mars Science Detective" concept (v0.1). This is an evolution of
that concept, not a restart: the map, NASA data layer and app shell carry over.

## 1. Core question

> Given incomplete scientific evidence and limited mission resources, what
> should a Mars explorer investigate next, and why?

MDI is a **retrospective scientific investigation simulator** with decision
support. The user picks a historical **snapshot date**; MDI uses only the
evidence that was available on that date and ranks candidate observation tasks
with explicit, deterministic logic. Each recommendation shows the evidence,
assumptions and limitations behind it. Afterwards, the observations that came
later can be revealed for a retrospective comparison. MDI does not claim to
know what NASA should have done.

## 2. User workflow

1. **Explore** a location on a real NASA Mars basemap (Mars Trek WMTS).
2. **Review** existing scientific observations and interpretations, with sources.
3. **Identify evidence gaps**: questions the current evidence cannot settle.
4. **Compare candidate observation tasks** against those gaps and against
   simulated resource limits.
5. **Get an explainable recommendation**: a ranked list with a per-criterion
   breakdown, the evidence used, the assumptions made, and the limitations.

Initial scope: one site, **Jezero Crater — Margin Unit**.

## 3. Epistemic categories (must stay separate in data, logic and UI)

| Category | Definition | Origin | UI label |
|---|---|---|---|
| Orbital observation | What an orbital instrument detected or imaged, as reported by a cited source | Curated from NASA / USGS / peer-reviewed sources | OBSERVED · ORBITAL |
| In-situ measurement | What a rover instrument measured at the target, as reported | Curated from NASA / PDS sources | MEASURED IN SITU |
| Interpretation | An author's conclusion from observations, attributed | Curated from cited sources | INTERPRETED |
| Hypothesis | A candidate explanation still under consideration, attributed | Curated from cited sources | HYPOTHESIS |
| Regional context (M3) | Crater-wide or regional record not explicitly about the target unit; never local evidence | Curated from cited sources | REGIONAL CONTEXT |
| Evidence gap | An open question, either cited from literature or produced by a stated rule | Cited, or derived by a documented rule | GAP (cited / derived) |
| Assumption | A premise the decision model relies on, stated by the MDI team | Team-authored, user-visible | ASSUMED |
| Simulated parameter | A hypothetical mission resource value (time, power, data volume…) | Team-authored, **never real NASA values** | SIMULATED |
| Curated judgement (M3) | Task–gap link, priority statement or discrimination assessment; AI-drafted ones are not scored until a human approves them | Drafted by agent or team; approved by a human | CURATED + review status |

Rules:

- Every observation and interpretation cites at least one source (URL plus a
  locator such as a figure, table or section).
- An interpretation must reference the observations it relies on.
- A recommendation must list every assumption and simulated parameter it used.
- Simulated values are visibly labelled wherever they appear, including in exports.

## 4. Temporal model (retrospective simulation)

- **Scenario.** A site plus a default snapshot date and a pool of candidate
  tasks. Kept as data, so more scenarios can be added later without code
  changes.
- **`availableFrom` (ISO date)** on every evidence record (observation,
  interpretation, cited gap). It equals the publication or release date of
  the **latest** source the record cites, so no quote is ever shown before it
  was published. (Changed from "earliest" on 2026-11-04 during M2; see the
  decisions log.) Acquisition dates are stored separately and are
  informational only.
- **Leakage prevention.**
  - The decision engine accepts only a `SnapshotEvidence` object. That object
    is produced by a single function, `selectEvidenceAsOf(scenario, date)`,
    which filters out every record with `availableFrom > date`.
  - Unit tests assert that no post-snapshot record id can reach the engine
    output.
- **Retrospective reveal.**
  - Records after the snapshot are shown only in a separate, clearly labelled
    "What happened later" view.
  - They never feed into the scores.
- **Historical vs simulated.**
  - Historical NASA observations carry an OBSERVED label and a citation.
  - Decisions, rankings and resources carry a SIMULATED or ASSUMED label.
- **Not in the MVP:** versioned records, superseded interpretations over time,
  and multiple snapshot comparisons. One date filter is enough.

## 5. Decision logic (engine v0.2.0, M3)

The full specification is in `docs/DECISION_MODEL.md`. Summary:

- **Five separate dimensions:**
  - evidence-gap coverage (deterministic);
  - hypothesis discrimination (curated);
  - resource feasibility (deterministic, under mission constraints);
  - scientific priority (curated);
  - evidence quality gain (deterministic).
- **Curated = human-approved.** AI-drafted judgements are shown but return
  "Not Evaluated" until approved. Hypothesis discrimination requires an
  explicit list of possible results and the hypotheses each would favor or
  weaken.
- **Not Evaluated is explicit.** A criterion that cannot be justified (e.g.
  because of missing data) returns a reason, never a fabricated number.
- **Same terms for every task.** Only criteria evaluated for every feasible
  task enter the ranking basis.
- **Mission constraints** (budget, platform availability) give
  deterministic, explained exclusions.
- **Weight stability check:** each basis weight is changed by ±20%.
- **LLMs never assign scores, gaps or rankings.**

## 6. MVP scope (smallest working product)

Priority: **a working end-to-end vertical slice before feature completeness.**
The first slice runs through all five workflow steps with a minimal dataset.
Breadth comes afterwards.

In scope:

- One site: Jezero Margin Unit.
- Map: one global Trek basemap, plus the Jezero CTX layer if it is verified.
- A small curated dataset. Target sizes, which depend on curation:
  - about 6–10 observations
  - 2–3 competing interpretations
  - 3–5 gaps
  - 3–5 candidate tasks
  - 3–4 criteria
- Evidence panel with epistemic labels and source links.
- Task comparison table, weight sliders, and a ranked recommendation with an
  explanation, assumptions and limitations.
- An "evidence snapshot date" shown on every page.

Out of scope for MVP:

- Multiple sites
- LLM features
- Report export beyond a print-friendly view
- Accounts or a database
- Live NASA data ingestion
- Route planning or traverse simulation

## 7. Non-functional requirements

- Next.js + TypeScript (strict), Tailwind, OpenLayers, local JSON data, deployed on Vercel.
- **Zod** schemas validate curated evidence JSON and any external NASA data at
  runtime. TypeScript types are inferred from the schemas (one source of
  truth). Schemas stay small and reusable.
- Data integrity is enforced by automated tests: references resolve, sources
  exist, simulated values carry their label, and no future data leaks into a
  snapshot.
- No credentials in the client bundle. Any future API keys are read server-side only.
- Accessible, responsive layout (map above the panel on mobile, side-by-side on desktop).

## 8. Decisions log

| Date | Decision |
|---|---|
| 2026-11-04 | Rename the concept to Mars Discovery Intelligence; keep the stack. |
| 2026-11-04 | Retrospective simulator with a configurable snapshot date; reveal later data separately; prevent leakage. |
| 2026-11-04 | Abstract resource units for simulated mission parameters. |
| 2026-11-04 | Zod for runtime validation. |
| 2026-11-04 | Build a vertical slice before adding breadth. |
| 2026-11-04 (M2) | `availableFrom` = latest cited source date, not earliest, so a multi-source record cannot reveal a later quote early. |
| 2026-11-04 (M2) | Scenario default snapshot: **2023-09-08**, the day after NASA's margin-unit preview post and before Perseverance's first margin-unit abrasion (Sol 915, 2023-09-16). Proposed by the agent; awaiting confirmation. |
| 2026-11-04 (M2) | Candidate tasks may target an Earth-lab platform (returned-sample analysis), separate from rover and orbital. |
| 2026-11-05 | Default snapshot 2023-09-08 confirmed by the user. |
| 2026-11-05 (M3) | Records carry `relevance` (local / regional-context); SIM 3464 unit Nue reclassified as regional context (see `docs/SCIENTIFIC_REVIEW_M3.md`). |
| 2026-11-05 (M3) | Five-dimension decision model; curated criteria require human approval; Not Evaluated instead of fabricated scores (see `docs/DECISION_MODEL.md`). |
| 2026-11-05 (acceptance) | **Approved:** the guided five-step experience (Mission → Evidence → Unknowns → Decision → Result). |
| 2026-11-05 (acceptance) | **Approved:** the map stays persistently accessible and is connected to the selected scientific context. |
| 2026-11-05 (acceptance) | **Approved:** progressive disclosure, with provenance, limitations, pending-review status and warnings kept visible when relevant. |
| 2026-11-05 (acceptance) | **Not approved:** unreviewed AI-curated relationships silently influencing an authoritative recommendation. Follow-up: `docs/RANKING_INTEGRITY_PROPOSAL.md`. |
| 2026-11-05 (acceptance) | **Pending review:** all 11 curation items, none auto-approved; D1 stays unapproved. |
| 2026-11-05 (acceptance) | **Approved in principle:** fix the translation crash (UX-0), run regression tests, then merge M3 into `main` if the scientific behavior is preserved. |
| 2026-11-05 (acceptance) | **Deferred:** Zastrow & Glotch and Moreland, recorded as outstanding research tasks (`docs/EVIDENCE_CURATION.md`). |
| 2026-11-05 (RI-1) | One Zod-validated review registry covering every ranking-relevant relationship, including local/regional classification. Statuses: pending, approved, rejected, needs_revision. |
| 2026-11-05 (RI-1) | The reviewed scenario ranking (approved relationships only) is the primary result. The provisional exploratory ranking is collapsed by default and labelled not validated. |

## 9. Open questions

1. Who curates and approves evidence records and rubric scores? The agent can
   draft records only from sources it can actually read.
2. Review the AI-drafted curated judgements (priority statements, task–gap links, one discrimination assessment) — see `docs/SCIENTIFIC_REVIEW_M3.md` §4.
3. Several important journal articles are behind publisher bot protection
   (e.g. Zastrow & Glotch 2021; Williford et al., *Science*, Dec 2025 per search
   snippets — unverified). Should the team supply PDFs for M3?
