# MDI — Architecture & Development Plan

Status: **v0.3 — updated 2026-11-04 after direction approval and M1b**
Companion to `docs/PRODUCT_REQUIREMENTS.md`.

## 1. Architecture (unchanged stack)

```
Browser
  └─ Next.js App Router page (Server Component shell)
       ├─ MarsMap (client-only, OpenLayers)  ← Mars Trek WMTS tiles fetched directly by the browser
       └─ Evidence / Decision panels (client components)
             └─ call pure functions in src/lib/decision (deterministic, no I/O)
Server
  └─ reads curated JSON from src/data at build/request time
  └─ (later) Route Handler for optional LLM narration — API key server-side only
```

No database, no microservices, no agent framework. The scoring engine is a pure
TypeScript module. It runs client-side so weight changes give instant feedback,
and it can be called unchanged from a Route Handler later.

### Directory layout (target)

```
src/
  app/                       routes, layouts, (later) Route Handlers — thin
  components/
    layout/                  AppHeader                                [exists]
    map/                     MarsMap, MarsMapLoader                   [exists]
    evidence/                ObservationList, InterpretationList, GapList, EpistemicBadge
    decision/                TaskComparisonTable, WeightControls, RecommendationCard
  lib/
    map/                     geodesy, projection, Trek layer catalog  [partly exists]
    evidence/                schema (types + validation), repository (queries), integrity checks
    decision/                criteria, scoring, sensitivity, explanation builder
  data/
    sources.json             bibliography (id, citation, url, accessed)
    jezero-margin/           site, observations, interpretations, gaps, tasks,
                             assumptions, simulated-parameters, criteria, assessments
```

## 2. Reuse assessment of current code

| File | Verdict |
|---|---|
| Project scaffold, `tsconfig` (strict), ESLint, Tailwind tokens, Vitest config, npm scripts | Reuse unchanged |
| `src/lib/map/mars-geodesy.ts` + tests | Reuse unchanged |
| `src/lib/map/mars-projection.ts` | Reuse unchanged (needs a runtime test once tiles are visible) |
| `src/components/map/MarsMapLoader.tsx` | Reuse unchanged |
| `src/components/map/MarsMap.tsx`, `src/lib/map/*` | Done in M1b. Verified against live Trek tiles |
| `scripts/smoke-test.mjs` | Done in M1b. Passes against the live services |
| `src/app/page.tsx`, `layout.tsx` | Reuse. Display name and metadata change to MDI |
| `src/components/layout/AppHeader.tsx` | Reuse. Title text change only |
| `src/components/investigation/InvestigationPanel.tsx` | Replace. It is a placeholder listing the old 6-step workflow; its role passes to the evidence/decision panels |
| `CLAUDE.md` | Reuse. Rename, and add the epistemic-category rules |

## 3. Data model (proposed)

All records are local JSON, validated at load time and in unit tests.

```ts
type SourceRef = {
  id: string; citation: string; url: string;
  kind: "peer-reviewed" | "nasa" | "dataset" | "mission-doc"; accessed: string; // ISO date
};
type Cite = { sourceId: string; locator?: string };          // e.g. "Fig. 3", "Sec. 4.2"

type Site = {
  id: string; name: string; parentFeature: string;           // "Jezero Crater"
  geometry: { kind: "point" | "bbox"; coordinates: number[]; cite: Cite }; // only sourced geometry
  evidenceSnapshotDate: string;
};

type Observation = {                                         // OBSERVED
  id: string; siteId: string;
  mission: string; instrument: string; dataProductId?: string;
  statement: string;                                         // what was measured/imaged, no inference
  quantity?: { value: number; unit: string; uncertainty?: string };
  cites: Cite[];                                             // ≥1
};

type Interpretation = {                                      // INTERPRETED
  id: string; siteId: string; claim: string;
  supportingObservationIds: string[]; conflictingObservationIds: string[];
  standing: "proposed" | "debated" | "widely-supported";     // as characterised by cited sources
  cites: Cite[];
};

type EvidenceGap = {                                         // GAP
  id: string; siteId: string; question: string;
  discriminatesBetween: string[];                            // interpretation ids
  origin: { kind: "cited"; cites: Cite[] } | { kind: "derived"; rule: string };
};

type Assumption = { id: string; statement: string; rationale: string };          // ASSUMED
type SimulatedParameter = {                                                      // SIMULATED
  id: string; name: string; value: number; unit: string; rationale: string; simulated: true;
};

type CandidateTask = {
  id: string; siteId: string; title: string; capability: string;
  addressesGapIds: string[]; resourceParameterIds: string[]; assumptionIds: string[];
};

type Criterion = {
  id: string; name: string; direction: "benefit" | "cost"; defaultWeight: number;
  scoring: { kind: "rule"; rule: string } | { kind: "judgement"; rubric: Record<0|1|2|3, string> };
};
type Assessment = {                                          // per task × judgement criterion
  taskId: string; criterionId: string; score: 0|1|2|3; justification: string; author: string;
};

type Recommendation = {                                      // engine output, never stored as data
  engineVersion: string; weights: Record<string, number>;
  ranking: { taskId: string; total: number;
             breakdown: { criterionId: string; raw: number; normalised: number; weighted: number;
                          origin: "rule" | "judgement" }[] }[];
  stability: { topTaskStable: boolean; perturbation: number };
  assumptionsUsed: string[]; simulatedParametersUsed: string[]; limitations: string[];
};
```

**Temporal fields (approved 2026-11-04):**
- `availableFrom: string` (ISO date) on `Observation`, `Interpretation` and
  cited `EvidenceGap`. It equals the publication date of the latest cited
  source (changed from "earliest" during M2).
- `observedOn?: string` is informational only.
- `Scenario = { id, siteId, defaultSnapshotDate, candidateTaskIds, criterionIds }`.
- `SnapshotEvidence` is a branded type returned only by
  `selectEvidenceAsOf(scenario, date)`. The engine signature is
  `recommend(evidence: SnapshotEvidence, tasks, criteria, weights)`, so
  leakage is prevented by the type system and by unit tests.

**Validation:** Zod schemas live in `src/lib/evidence/schema.ts`, with types
from `z.infer`. They are used for curated JSON at load time, and for any
external NASA data the app fetches at runtime.

## 4. Milestones

Each milestone ends with lint, typecheck, unit tests, build and smoke test; a
`DEVELOPMENT_LOG.md` entry; and a commit pushed to GitHub.

Priority (approved): **build the vertical slice first, then add breadth.**

| # | Goal | Main deliverables | Needs from the team |
|---|---|---|---|
| M1 / M1b | Shell + real NASA map | **Done 2026-11-04**: Trek basemaps plus Jezero CTX/HiRISE overlays, Mars scale line, smoke test | — |
| M2 | Thin vertical slice, end to end | **Done 2026-11-04** (see below and `docs/EVIDENCE_CURATION.md`) | Review the seed records; confirm the snapshot date |
| M3 | Scientific integrity & decision-engine refinement | **Implemented 2026-11-05 on branch `m3-scientific-integrity`, not merged**: one literature criterion is blocked (see below) | Add `pmc.ncbi.nlm.nih.gov` to the allowed domains or upload the PDFs; review the curated judgements |
| M4 (proposed) | Human review loop + literature | Approve or reject curated judgements; add Zastrow & Glotch 2021 and Moreland et al. 2025 once readable; resolve the PDS coordinate convention and add sample markers | Reviewer time; source access |
| M5 | Report + optional LLM narration | Print/Markdown report from engine output; optional server-side LLM rephrasing, with input and output shown | API key (server-side); approval |
| M6 | Deploy | Vercel preview deploy | Approval |

**M2 deliverables:**

1. **Zod schemas and repository:** `lib/evidence`.
2. **Seed data:** one scenario (Jezero Margin Unit), about 3–5 observations,
   2 competing interpretations, 2–3 gaps, 3 candidate tasks, and 2–3
   rule-derived criteria. Every record cites a source the agent has actually
   read.
3. **Leakage control:** `selectEvidenceAsOf` plus leakage tests.
4. **Decision engine:** deterministic, with a breakdown and a stability check,
   in `lib/decision`.
5. **UI:**
   - evidence list with epistemic badges and source links
   - snapshot date picker
   - task comparison with weight sliders
   - recommendation card showing assumptions and limitations
   - "What happened later" reveal

**MVP = M1b + M2** (reached 2026-11-04). M3 makes it credible; M4 makes it presentable.

**M3 outcome.**
- Evidence relevance classes: local vs regional context. SIM 3464 unit Nue is
  reclassified as regional context.
- Hypotheses are separated from interpretations, and dates are labelled
  explicitly.
- Five-dimension decision model with review-gated curated criteria and
  explicit Not Evaluated.
- Mission constraints in the UI.
- Scientific integrity test suite.
- Details: `docs/DECISION_MODEL.md` and `docs/SCIENTIFIC_REVIEW_M3.md`.

## 5. Risks

### Scientific

1. **Curation is the critical path.** The decision logic is only as good as the
   sourced records. This environment cannot reach NASA, USGS or journal sites
   today, so sourcing needs network access or human-provided documents.
2. **Subjective scores in disguise.** Removing the LLM from scoring does not
   remove subjectivity. Mitigations: prefer rule-derived criteria; label team
   judgements with written justifications; show sensitivity to weights.
3. **Fabricated gaps.** Every gap must be cited, or derived by a rule written
   down in the data.
4. **Observation vs interpretation is a blurry line.** A mineral identification
   from spectral fitting is already model-based. Rule: an observation states the
   instrument result *as reported by the source*, and the method is noted.
   Anything inferred beyond the source goes in an interpretation.
5. **Simulated resources mistaken for real constraints.** Mitigations: abstract
   units, a SIMULATED label everywhere, and no false precision.
6. **Hindsight.** The rover has already visited parts of Jezero. Show an
   evidence snapshot date and frame recommendations as an exercise, not as a
   claim about what NASA should do.
7. **Geometry.** Draw a Margin Unit outline only if a published geologic-map
   polygon is available. Otherwise show a sourced point or bbox. Never
   hand-digitise without a citation.

### Technical

1. **Network policy:** `trek.nasa.gov`, `science.nasa.gov` and
   `pds-geosciences.wustl.edu` are allowed as of 2026-11-04. Journal sites and
   the USGS Gazetteer are still blocked, which limits source curation.
2. **Trek service:** verified live on 2026-11-04 (CORS `*`, single-slash
   paths, 404 outside extents). Still unknown: official attribution wording,
   rate limits, and no `Cache-Control` header was observed.
3. **Trek capabilities need special handling:** the CRS is
   `EPSG::104905` and the scale denominators assume an Earth-sized sphere. The
   tile grid must be hand-built rather than parsed (see `NASA_MAP_RESEARCH.md`).
4. **The demo depends on an external tile server.** The app must degrade
   gracefully; the current design shows a tile-status badge.
5. **The work lives in an ephemeral cloud container.** Mitigated: each
   milestone is pushed to GitHub (`SuperJCL/NASA--11-Mars-Discovery-Intellegence`).
6. **New Next.js 16.4 defaults** (`cacheComponents`, `partialPrefetching`) are
   unfamiliar. Keep data loading simple and static.
7. **Hand-edited JSON drifts.** Referential-integrity tests are mandatory.
