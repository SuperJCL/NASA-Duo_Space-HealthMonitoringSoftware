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
| Observation | What an instrument measured or imaged, as reported by a cited source | Curated from NASA / peer-reviewed sources | OBSERVED |
| Interpretation | A scientific claim inferred from observations, attributed to its authors | Curated from cited sources | INTERPRETED |
| Evidence gap | An open question, either cited from literature or produced by a stated rule | Cited, or derived by a documented rule | GAP (cited / derived) |
| Assumption | A premise the decision model relies on, stated by the MDI team | Team-authored, user-visible | ASSUMED |
| Simulated parameter | A hypothetical mission resource value (time, power, data volume…) | Team-authored, **never real NASA values** | SIMULATED |
| Team judgement | A rubric score assigned by a human curator, with written justification | Team-authored | JUDGEMENT |

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
  interpretation, cited gap). It is the date the information became public:
  the publication or release date of its earliest cited source. Acquisition
  dates are stored separately and are informational only.
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

## 5. Decision logic (MVP)

- **Deterministic weighted multi-criteria scoring**, a pure function with the
  same output for the same inputs, versioned (`engineVersion`).
- Example criteria (to be finalised with the team):
  - **Gap coverage**: how many open gaps the task addresses.
  - **Discriminating power**: how many competing interpretations the result
    could tell apart.
  - **Resource cost**: from simulated parameters.
  - **Feasibility / risk**: team judgement.
- Scores come from one of two places. Each score records which.
  1. **Rule-derived**: computed from structured data, e.g. counting the gaps a
     task links to.
  2. **Team judgement**: a 0–3 rubric score with a fixed meaning for each
     level and a written justification.
- Users can adjust the criterion weights. The breakdown updates live.
- **Rank stability check**: report whether the top-ranked task stays on top
  when weights are perturbed (e.g. ±20%).
- **LLMs are never used to assign scores, gaps or rankings.** Later, an LLM may
  only rephrase the structured engine output into prose. Its input and output
  must be shown, and it runs server-side.

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

## 9. Open questions

1. Who curates and approves evidence records and rubric scores? The agent can
   draft records only from sources it can actually read.
2. Which snapshot date should the first scenario use? It must fall before at
   least one key Margin Unit observation, so the reveal is meaningful.
