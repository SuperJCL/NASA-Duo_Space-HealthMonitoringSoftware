# Development Log

Timestamps are UTC from the container clock (`date -u`) and file modification
times. Durations are computed from those timestamps. Anything estimated is
marked **(estimate)**.

---

## Milestone 1 — Scaffold, app shell, NASA map feasibility

- **Started:** 2026-11-04T20:36:49Z
- **Status:** **Closed by Milestone 1b** (see below). Work had stopped after
  the last file write at about 20:44:34Z, when the product direction changed
  to MDI.
  - Active time: about 7.75 min, from 20:36:49Z to 20:44:34Z.
  - The research subagent ran in parallel for 412 s, as reported by the harness.

### Implemented

- **Next.js scaffold:** `create-next-app@16.4.5` created
  `/home/user/mars-science-detective`.
  - App Router, `src/` directory, TypeScript strict mode.
  - Tailwind v4 via the `@tailwindcss/turbopack` loader (no PostCSS config).
  - ESLint 9, `@/*` import alias.
  - Git initialised with the scaffold commit `70a75c5`.
- **Dependencies:**
  - Added `ol@10.11.0` and `vitest@5.1.0`.
  - Bumped `@types/node` from `^20` to `^22`. Vitest 5 requires it, and it
    matches Node v22.23.4.
- **Conventions:**
  - npm scripts: `typecheck`, `test`, `smoke`, `check`.
  - `.nvmrc` set to 22.
  - `.env.example`, with `.gitignore` adjusted so it is not ignored.
  - `CLAUDE.md` with project rules.
- **App shell:**
  - `AppHeader`.
  - `InvestigationPanel`: a placeholder that lists the planned workflow and
    contains no science content.
  - Responsive page layout: map on top at 55dvh on mobile, side panel from the
    `lg` breakpoint.
  - Dark theme tokens.
- **Map groundwork:**
  - `src/lib/map/mars-geodesy.ts`: Mars sphere constants, longitude wrapping,
    coordinate formatting.
  - `src/lib/map/mars-projection.ts`: OpenLayers projection with Mars
    `metersPerUnit` and `getPointResolution`.
  - `MarsMapLoader`: `next/dynamic` with `ssr: false`.
  - `MarsMap`: OpenLayers map, scale line, pointer lat/lon readout, tile
    health badge, basemap selector.
- **Smoke test:** `scripts/smoke-test.mjs`, a Playwright check of the shell,
  tile URL pattern and mobile overflow. It uses no faked tile responses.

### Not finished

- Three modules imported by `MarsMap.tsx` were never written:
  - `src/lib/map/trek-layers.ts`
  - `src/lib/map/create-trek-source.ts`
  - `src/lib/map/initial-views.ts`
- As a result, `tsc` fails and the app has never been built or run.
- The smoke test has never been executed.
- Nothing after the scaffold commit has been committed.

### Tests performed

- `npx vitest run`: **16/16 passed** (`mars-geodesy.test.ts`).
- `npx eslint`: **passed**, no output.
- `npx tsc --noEmit`: **failed**, 7 errors, all caused by the three missing modules.
- `npm audit --omit=dev`: 0 vulnerabilities.
  - Full audit: 8 moderate, all in the dev-only ESLint chain (`minimatch`,
    GHSA-g3hv-75wg-m249).
- `next build` / `next dev`: **not run.**

### Unexpected problems

- **NASA Trek blocked:** the network policy denies `trek.nasa.gov` (proxy 403
  on CONNECT).
  - The research agent also could not fetch NASA, USGS or Wikipedia pages.
  - Facts were taken from archived capabilities on GitHub; see
    `docs/NASA_MAP_RESEARCH.md`.
- **Peer-dependency conflict:** the scaffold's `@types/node@^20` conflicts with
  `vitest@5.1.0`. Fixed by bumping to `^22`.
- **Vitest config warning:** a `.ts` config triggered an ESM/CJS warning.
  Renamed it to `vitest.config.mts`.
- **Next.js 16.4 defaults:** the scaffold enables `cacheComponents` and
  `partialPrefetching` by default. Not yet exercised.
- **Trek capabilities incompatible with OpenLayers parsing:** the CRS is
  `EPSG::104905` and the scale denominators assume an Earth-sized sphere. The
  tile grid has to be hand-built.

### Blockers and rework

- **Blocker:** real tiles cannot be verified from this container until
  `trek.nasa.gov` is allowed.
- **Rework:**
  - Tile health tracking was changed from per-tile pending counts to map
    `loadstart`/`loadend` events, because aborted tiles emit no end event.
  - `InvestigationPanel` will be replaced under the MDI direction.

### Human intervention required

- Allow `trek.nasa.gov` in the environment's network settings, or run the
  smoke test on a local machine.
- Decide how the work is persisted: the container is ephemeral and no remote
  exists.

### Remaining technical risks

See `docs/DEVELOPMENT_PLAN.md` §5.

---

## Planning task — Product direction update to Mars Discovery Intelligence

- **Started:** about 2026-11-04T20:45:00Z, when the first inspection command ran.
- **Completed:** 2026-11-04T20:47:55Z, after the documents were written.
- **Scope:** inspect and plan only. No application code was modified.
- **Outputs:**
  - `docs/PRODUCT_REQUIREMENTS.md` (v0.2)
  - `docs/DEVELOPMENT_PLAN.md`
  - `docs/NASA_MAP_RESEARCH.md`
  - this log
- **Checks performed:**
  - Re-ran the typecheck, lint and tests listed above.
  - Spot-checked key research claims (Viking TileMatrixSet, Jezero CTX/HiRISE
    bounding boxes) against the archived capabilities XML.
- **Human intervention required:**
  - Approve the PRD and plan.
  - Decide on network access, persistence, and evidence sourcing.

---

## Milestone 1b — Close out M1 under the MDI name

- **Started:** 2026-11-04T21:05:17Z (first command after the user's go-ahead).
- **Completed:** 2026-11-04T21:15Z, at the commit and push (see git log for
  the exact time).
- **Duration:** about 10 min. The user's network and GitHub setup took place
  between 20:47:55Z and 21:05:17Z and is not included.

### Implemented

- **Live NASA Trek verification (2026-11-04):**
  - Capabilities for all four layers are byte-identical to the 2023 archive.
  - CORS `Access-Control-Allow-Origin: *`.
  - A single-slash path returns the same tile bytes as the double slash.
  - Regional mosaics return 404 outside their extent.
  - The Trek catalog API supplied titles, missions and instruments.
- **`src/lib/map/trek-layers.ts`:** layer catalog with only live-verified
  values: Viking and MOLA global basemaps; Jezero CTX (6 m, z0–13) and HiRISE
  (25 cm, z0–17) overlays.
- **`src/lib/map/create-trek-source.ts`:** `ol/source/ImageTile` with a
  hand-built `default028mm` grid limited to each layer's bounding box.
- **`src/lib/map/initial-views.ts`:** the "Jezero" view fits the Trek CTX
  mosaic's bounding box, so no crater-centre coordinate is hard-coded.
- **`MarsMap.tsx` (rewritten before it had ever compiled):**
  - basemap selector and overlay toggles
  - Jezero and Global view buttons
  - Mars scale line
  - pointer lat/lon readout
  - tile health badge
- **Rename to MDI:** header, metadata, package name, `CLAUDE.md`. The
  placeholder panel now lists the five MDI workflow steps.
- **Playwright:** `playwright@1.63.0` added as a devDependency, the same
  version as the preinstalled browser.
- **Smoke test:** now also covers the HiRISE toggle, the MOLA basemap switch,
  and screenshots.
- **Docs:**
  - `README.md` rewritten.
  - `docs/NASA_MAP_RESEARCH.md` updated to live-verified facts.
  - PRD and plan v0.3 with the approved decisions: retrospective simulator,
    snapshot date, leakage prevention, Zod, vertical slice first.
- **GitHub:** remote `origin` set to
  https://github.com/SuperJCL/NASA--11-Mars-Discovery-Intellegence.git; the
  scaffold commit was pushed at about 21:06Z.

### Tests performed (all passed)

- **`npx vitest run`:** 34/34 across three files (geodesy, Trek catalog and
  grid, projection with OpenLayers `getPointResolution` and tile ranges).
- **`npx tsc --noEmit`, `npx eslint`:** clean.
- **`npm run build`:** passed. The first build took 20 s
  (21:10:06–21:10:26Z); `/` is prerendered as static.
- **`SMOKE_LIVE=1 npm run smoke` against `next start`:** 14/14 checks.
  - Real CTX tiles loaded with 0 failures.
  - Every tile URL matches the WMTS pattern and grid bounds.
  - Pointer readout `18.4661° N, 77.4298° E` at the view centre, which is the
    CTX bounding-box centre, as expected.
  - Scale line `5 km`.
  - HiRISE toggle requested 9 tiles; MOLA switch requested 41.
  - No overflow at a 390 px width; no console errors.
- **Same smoke test against `next dev`:** 14/14. Exactly one `.ol-viewport`
  exists, so the Strict Mode double effect is cleaned up correctly.
- **Visual check of the screenshots:** the CTX mosaic of the Jezero delta over
  the Viking basemap; on mobile, the map is stacked above the panel.
  - Hand check of the scale bar: the CTX extent is about 30.3 km over about
    738 px, so about 41 m/px, and 5 km should be about 122 px. This matches
    the rendered bar.
- **`npm run check`:** passed (21:14:13Z).
- **`npm audit --omit=dev`:** 0 vulnerabilities.

### Unexpected problems and debugging

- **`npm run smoke` failed with `ERR_MODULE_NOT_FOUND: playwright`.** ESM
  imports ignore `NODE_PATH`, where the preinstalled Playwright lives. Fixed
  by adding it as a pinned devDependency (about 1 min).
- **GitHub URL:** the push reported that the repository moved, a case
  difference in its URL. Fixed by resetting the remote to the canonical URL.
- **`register_repo_root`:** refused, because the session expected the repo at
  `/home/user/nasa--11-mars-discovery-intellegence`, not the project
  directory. Non-blocking; pushing works.
- **Coordinate discrepancy:** Trek's nomenclature point for Jezero
  (18.4082°N, 77.6873°E) differs from the commonly quoted 18.38°N, 77.58°E.
  This was avoided by using the product extent. It must be resolved before
  any site geometry enters the evidence data.
- **Documentation edit:** one doc edit script failed its own string-match
  assertion and was rerun with corrected text. No file was half-written.

### Blockers and rework

- No blockers.
- **Rework:** `MarsMap.tsx` was restructured from a single swappable source to
  persistent layers with visibility toggles, to support overlays.

### Human intervention required

- **Done by the user:**
  - Allowed `trek.nasa.gov`, `science.nasa.gov`,
    `pds-geosciences.wustl.edu` and `www.spaceappschallenge.org` in the
    network policy. The last one still timed out from the container
    (curl returned `000`).
  - Created the GitHub repository.
- **Next:**
  - Approve the M2 source list and seed records.
  - Choose a snapshot date.

### Remaining technical risks

- **Trek availability:** no official attribution text and no
  `Cache-Control` header; rate limits are unknown for a public demo.
- **Journal sites and the USGS Gazetteer are still blocked.** This limits
  which primary sources the agent can read for M2.
- **Mobile layout:** the layer control covers part of the map at phone width.
  It is acceptable for now; making it collapsible is a candidate later.
- **Next.js 16.4 defaults:** `cacheComponents` and `partialPrefetching` are
  still unexercised by data-loading code.

---

## Milestone 2 — Thin vertical slice, end to end (MVP)

- **Started:** 2026-11-04T21:27:12Z (first command after the user's go-ahead).
- **Completed:** about 2026-11-04T21:55Z. The exact time is the merge commit
  on `main`.
- **Duration:** about 28 min of wall-clock time.
  - Two research subagents ran in parallel: 530 s and 658 s, as reported by
    the harness.

### Implemented

- **Evidence model** (`src/lib/evidence/`):
  - Zod 4 schemas, with TypeScript types inferred from them.
  - Integrity rules: references must resolve; `availableFrom` must equal the
    latest cited source date; interpretations cannot rest on later
    observations; always-visible citations must predate `minSnapshotDate`.
  - Loader that fails the build on invalid data.
- **Leakage control:** `selectEvidenceAsOf` returns a branded
  `SnapshotEvidence`.
  - It filters records by date and drops later interpretations from gaps.
  - It strips the ids of gaps that did not exist yet.
  - A gap becomes "addressed" once an observation linked to it is public.
- **Decision engine** (`src/lib/decision/`):
  - 4 rule-derived criteria: open-gap coverage, discriminating power,
    independent line of evidence, simulated cost.
  - Weighted average with a deterministic tie-break.
  - Over-budget tasks are excluded, with a reason.
  - Stability check: each weight is changed by ±20%.
  - Plain-language explanations, plus the assumptions and limitations used.
  - Retrospective review of later evidence.
- **Data:** a scenario for the Jezero Margin Unit.
  - 10 sources and 23 verbatim citations.
  - 8 observations: 3 orbital, 5 rover.
  - 5 interpretations, 4 gaps (3 cited, 1 derived), 5 assumptions, 4 simulated
    tasks, 1 simulated resource.
  - Default snapshot 2023-09-08 (agent's proposal; see the PRD decisions log).
- **UI:** the `InvestigationWorkspace` replaces the placeholder panel.
  - Snapshot date picker with "Scenario default" and "All evidence" buttons.
  - Observation, interpretation and gap cards with epistemic badges, quotes,
    source links and MDI curation notes.
  - Task list, weight sliders, comparison table.
  - Recommendation card: why, stability, assumptions, limitations.
  - A "What happened later" reveal that re-hides when the date changes.
- **Tooling:**
  - `npm run verify:citations` re-fetches every source and checks each quote
    verbatim.
  - The smoke test now covers the workflow.
  - `docs/EVIDENCE_CURATION.md` added; PRD, plan, research notes, `CLAUDE.md`
    and README updated.

### Tests performed (all passed)

- **`npx vitest run`:** 69/69 across 6 files.
  - Engine scoring on a synthetic fixture, with hand-computed totals.
  - Determinism.
  - A **metamorphic leakage test**: rewriting or adding post-snapshot records
    leaves an earlier recommendation identical.
  - Schema and integrity rules; snapshot filtering.
  - Real-data guards: host allowlist, no orphan sources, a meaningful reveal.
  - A hand-checked ranking regression:
    - at 2023-09-08, the top task is "Abrade a margin rock…" (92);
    - with all evidence, the top task becomes "Core a margin-unit sample for
      Earth laboratories" (79).
- **`npx tsc --noEmit`, `npx eslint`, `npm run build`, `npm run check`:** all
  clean.
- **`SMOKE_LIVE=1 npm run smoke`:** 23/23 checks against `next start`, and
  again against `next dev`.
  - Live NASA tiles load, and the summary reports 8 later records withheld.
  - Badges, recommendation and comparison table render.
  - The reveal opens, and re-hides when the date changes.
  - "All evidence" withholds 0 records.
  - Layer toggles and the 390 px layout still work.
- **Quote verification:**
  - The lead agent re-checked all 23 dataset quotes against the subagents'
    saved copies: 23/23.
  - `npm run verify:citations` against the live sites: 23/23 in 82 s.
  - PDS quotes were confirmed to sit in the right sample section.

### Unexpected problems, debugging and rework

- **Blocked sources:** several were unreachable, so they were left out rather
  than guessed.
  - Proxy policy: `doi.org`, `www.nasa.gov`, `jpl.nasa.gov`.
  - Site-level Cloudflare or WAF challenges, which were not bypassed:
    `science.org`, `agupubs`, `hou.usra.edu`, `lpi.usra.edu`, ADS.
- **Bug in the lead agent's own quote checker** (about 3 min): it stripped
  `<…>` from plain-text files, and a "<0.1 wt %" in the PDS text swallowed
  later passages. Fixed by stripping tags only from HTML.
- **Rework: `availableFrom` rule.** Changed from "earliest" to "latest cited
  source date", after realising a multi-source record would show a later
  quote early.
- **Rework: gaps and later interpretations.** Gaps may now list
  interpretations published later; the snapshot drops them. The earlier rule
  had blocked sensible gap definitions.
- **Data model additions:**
  - `curationNote`, so MDI's own linking choices are visible.
  - `title` on gaps: explanations had shown raw ids.
  - Assumption `scope`: the card had listed every task's assumptions.
  - An Earth-lab task platform.
- **PDS dating:** the verified text is from v2.0 (2025-05-06); v1.0 is dated
  2024-09-01. The later date is used, so content is never shown too early.
- **Coordinate discrepancy from M1b resolved:** Trek's point matches the USGS
  Gazetteer's MDIM 2.1 centre.
- **Stop hook:** it required committing uncommitted changes while the build
  was knowingly broken (data was pending). Handled by pushing a WIP commit to
  branch `m2-vertical-slice`; `main` was left untouched.

### Human intervention required

- **Done by the user:**
  - Allowed `planetarynames.wr.usgs.gov`, `ui.adsabs.harvard.edu`, `doi.org`,
    `agupubs…`, `hou/lpi.usra.edu`, `astrogeology.usgs.gov`, `pubs.usgs.gov`
    and `www.science.org`. `doi.org` was still proxy-denied when tested.
  - Renamed the GitHub repo.
- **Next:**
  - Review the seed records and curation notes.
  - Confirm the default snapshot date.
  - Decide whether to supply journal PDFs for M3.

### Remaining technical and scientific risks

- **Curation by one agent.** MDI's links between tasks, gaps and observations
  need scientific review by a human.
- **Small evidence base.** The key peer-reviewed in-situ results, such as the
  December 2025 *Science* paper seen only in search snippets, are not
  included.
- **Discriminating power is 100 for every task at the default snapshot,**
  because every gap concerns all three interpretations. It only
  differentiates tasks later. The criterion design may need refinement in M3.
- **Bundle size:** the dataset ships to the client, which is fine at this
  size. Larger datasets may need server-side filtering via a Route Handler.

---

## Milestone 3: Scientific integrity & decision-engine refinement

- **Session start:** 2026-11-05T00:06:38Z.
  - Container check, then the M2 review server for the user, built from
    `main` 05cafae.
- **M3 start:** 2026-11-05T00:08:15Z, when branch `m3-scientific-integrity`
  was created from `main` 05cafae.
- **M3 implementation complete:** about 2026-11-05T00:27Z, when the branch
  commit was pushed. **Not merged to `main`**, because one acceptance item is
  blocked (literature access, below).
- **Wall-clock elapsed:** about 19 min from branch creation to push.
  - No subagents were used in M3, so there was no parallel agent time.
  - Human intervention and approval time inside this window: none.
  - The user's network change (allowing `doi.org`, `www.nasa.gov` and
    `jpl.nasa.gov`) happened before the session started.

### Implemented

- **Schema** (`src/lib/evidence/schema.ts`):
  - `relevance` (local / regional-context) on observations, interpretations
    and gaps.
  - `stance` (hypothesis / interpretation).
  - `contextRecordIds`.
  - A `Review` record (draftedBy, status, reviewer, date).
  - Curated `GapLink` with rationale, citations and review, replacing the bare
    `addressesGapIds` on tasks.
  - Gap `priority` statements.
  - `DiscriminationAssessment`, with outcomes listing what each would favor
    or weaken.
- **Integrity** (`integrity.ts`):
  - Regional context cannot be local support, cannot address a local gap,
    and cannot be a hypothesis.
  - An assessment may reference only local hypotheses concerned by the task's
    gaps; every outcome must favor or weaken something, never both for the
    same hypothesis.
  - Curated items cannot appear before their citations.
  - `observedOn` cannot be later than `availableFrom`.
- **Snapshot:** also filters task–gap links, assessments and context
  references by date.
- **Engine v0.2.0** (`engine.ts`, `criteria.ts`):
  - Five criteria: 3 deterministic, 2 curated and review-gated.
  - Explicit Not Evaluated results.
  - Ranking basis limited to criteria evaluated for every feasible task.
  - Mission constraints: budgets and unavailable platforms.
  - A missing cost makes a task "not ranked" (it is never treated as 0).
  - Explicit not-ranked states.
  - Stability check over the basis criteria.
- **Data:**
  - Reclassified to regional context: SIM 3464 Nue observation,
    interpretation and gap; the PIA23380 crater-wide map.
  - Added 3 local hypotheses from the 2024 Mars 2020 team post, and a new
    cited gap ("How the margin rocks formed", 2023).
  - Added 2 AI-drafted priority statements (pending), 8 task–gap links with
    rationale (pending), and 1 discrimination assessment (pending).
  - Added margin-unit locator quotes for the PDS and Comet Geyser records.
  - Added an evidence-hierarchy assumption.
  - 37 citations in total.
- **UI:**
  - Separate sections for "Observations (margin unit)", "Hypotheses &
    interpretations", "Evidence gaps" and "Regional geological context".
  - Badges for observed vs measured in situ, hypothesis vs interpreted, and
    curated vs deterministic, with review status.
  - Date labels: observed / public / published / identified / revealed N days
    after the snapshot.
  - Per-task gap links with rationale.
  - Assessment display.
  - Mission constraints panel.
  - NE cells, basis status and Not Evaluated reasons in "Why".
- **Tooling:**
  - `verify:citations` now also checks priority, link and assessment
    citations.
  - The smoke test gains M3 checks.
- **Docs:**
  - New: `docs/DECISION_MODEL.md`, `docs/SCIENTIFIC_REVIEW_M3.md`.
  - Updated: PRD, plan, curation doc, CLAUDE.md, README.

### Tests executed (all passed)

- **`npx vitest run`:** 85/85 across 7 files. The new
  `scientific-integrity.test.ts` covers the six required properties:
  1. future evidence, including future approved assessments and future-cited
     links, cannot change an earlier recommendation;
  2. regional context cannot be used as local evidence;
  3. unsupported hypothesis relationships produce no discrimination score;
  4. constraints give deterministic, explained outcomes;
  5. missing data is handled explicitly;
  6. citations resolve.

  A hand-computed regression on the real Jezero data is also included.
- **Static checks:** `npx tsc --noEmit` and `npx eslint` are clean;
  `npm run build` passes.
- **`SMOKE_LIVE=1 npm run smoke`:** 29/29 against `next start`, and again
  against `next dev` (one OpenLayers viewport). It checks:
  - Nue appears as regional context;
  - NE cells and basis exclusion;
  - pending-review links;
  - budget 30 excludes abrasion with a stated reason, and the stand-off
    survey ranks first.
- **`npm run verify:citations`:** 37/37 quotes matched against the live
  sources, run twice.

### Bugs and rework

- **Engine design fix.** The first draft returned Not Evaluated for tasks that
  address no open gap. That would have removed whole criteria from the basis
  because of one irrelevant task. Changed to a rule-derived 0. This was found
  while hand-computing the fixture totals, before running the tests.
- **Coverage gap in `verify:citations`.** The script did not yet check the
  new citation locations (priority, links, assessments). Found in self-review
  and extended; it went from 23 to 37 quotes.
- **Wrong build on port 3000 (my error).** After rebuilding for M3, port 3000
  was serving M3 instead of the M2 build the user asked to review. Fixed by
  serving `main` from a git worktree (`/home/user/mdi-m2-review`) on port
  3000, with M3 on port 3002.
- **Regression values.** The M2 values (0.92 / 0.87 / 0.69 / 0.58) were
  replaced by new hand-computed values (0.8857 / 0.8143 / 0.5571 / 0.4).
- **Minor:** one ESLint warning fixed; `useMemo` dependencies cleaned up.

### Blockers

- **Zastrow & Glotch (2021):** `pmc.ncbi.nlm.nih.gov` is denied by the proxy;
  it is not in the allowed list.
- **Moreland et al. (2025):** `doi.org` resolves to `agupubs`, which returns a
  Cloudflare challenge. `api.crossref.org` is also proxy-denied.
- **Neither paper was added. M3 is not merged until this is resolved, or
  until the user waives the item.**
- `www.jpl.nasa.gov` is proxy-denied: `jpl.nasa.gov` redirects to it.

### Human intervention required

- Allow `pmc.ncbi.nlm.nih.gov` (and optionally `www.jpl.nasa.gov`), or upload
  the PDFs.
- Review the AI-drafted curated judgements (`docs/SCIENTIFIC_REVIEW_M3.md`
  §4).
- Approve merging M3 into `main`.

### Remaining risks

- **Scientific:**
  - Gap coverage still relies on AI-drafted task–gap links, which are shown
    as pending.
  - Discrimination and priority stay unscored until a human reviews them.
  - The evidence-quality ordering is an MDI methodological assumption.
  - The default snapshot has only one margin-unit observation, because the
    journal literature is missing.
- **Engineering:**
  - The ranking-basis rule can exclude a curated criterion as soon as one
    task cannot be evaluated. This is intentional, but it means partial
    reviews have no effect on the ranking until coverage is complete.
  - The PDS coordinate convention is unconfirmed, so there are no sample
    markers.

---

## Planning task: M3 acceptance review & UX redesign proposal

This task is tracked separately from M2 and M3. The recorded M3 duration
above is unchanged.

- **Started:** 2026-11-05T01:29:05Z.
- **Completed:** 2026-11-05T01:34:57Z, when commit `2b1e621` was pushed on
  branch `ux-proposal`.
- **Elapsed:** 5 min 52 s of wall-clock time.
  - No subagents were used.
  - The owner's local setup and manual review time are not included.
- **Not timed:** the earlier review-support turn (workflow walkthrough and
  first translation-crash diagnosis) recorded no timestamps, so it is not
  timed.
- **Scope:** analysis and documentation only. No application code changed.
  `m3-scientific-integrity` is unchanged at `64506ea`. Nothing merged.

### Work performed

- **UX measured on the M3 build** at 1440×900:
  - the right panel is 5,431 px tall in a 665 px viewport;
  - the recommendation starts at 4,387 px;
  - 2,079 words, 49 badges, 26 controls;
  - jargon frequencies counted.
- **Translation crash mapped and confirmed:**
  - 12 interaction scenarios were run under a simulated page translation;
    2 crash (all platforms off; budget 0).
  - Root cause confirmed in a throwaway worktree, since removed: wrapping
    one conditional text node fixes both.
  - 6 similar conditional-text sites were listed.
- **Influence analysis** (scratchpad script, not in the repo): removing any
  one of three unreviewed task–gap links flips the current top
  recommendation.
- **Geometry check:**
  - The USGS Gazetteer crater WKT polygon exists (361 vertices).
  - The Trek "Perseverance (Mars 2020) Path" Feature product exists (catalog
    date 2024-07-03).
  - The PDS label states no coordinate convention.
- **Deliverables:** `docs/UX_REDESIGN_PROPOSAL.md` and
  `docs/M3_CURATION_REVIEW.md`.

### Problems / rework

- Two inconsistent counts in the first draft of the proposal were corrected
  before committing (pending-review count; number of conditional-text
  sites).
- The `vitest` config for the scratch analysis first failed: it was outside
  the project, so `vitest` could not be resolved. It was rewritten without
  imports.

### Human decisions required

D1–D5, listed in `docs/UX_REDESIGN_PROPOSAL.md` §7.

---

## UX-0: Translation-crash fix and acceptance stability

- **Started:** 2026-11-05T02:54:05Z, after the owner's acceptance decisions
  (recorded in the PRD decisions log).
- **Completed:** the merge commit on `main` (see git log), at about
  2026-11-05T03:05Z.
- **Wall-clock elapsed:** about 11 min.
  - No subagents were used.
  - No human intervention during the work.
- **Baseline:** branch `ux0-stability` from `ux-proposal` @ `c2c4480`. Its
  code is identical to M3 `64506ea`; it only adds the proposal docs.

### Fixed

- **The crash.**
  - The comparison-table header rendered `{inBasis ? "" : "*"}` as a bare text
    node. When every task becomes infeasible (all platforms off, or budget 0),
    React removes that node.
  - Under browser page translation the node had already been replaced, so
    React threw `NotFoundError: removeChild`.
  - Fix: render it as a single template string inside the `<th>`.
- **The same problem elsewhere** (translation safety). All other dynamic or
  conditional text was audited in `DecisionSection`, `EvidenceSection`,
  `RevealSection`, `InvestigationWorkspace`, `Citations` and
  `EpistemicBadge`.
  - Every changeable string is now the **sole child of an element** (one
    template string). Under translation, React then updates whole elements
    instead of orphaned text nodes.
  - This prevents both crashes and **stale values**: without it, scores,
    weights and reasons would stop updating on screen after translation.
- **The misleading label.** With no feasible task, the basis labels read
  "Ranking basis: not applicable — no task is feasible…" instead of "In
  ranking basis", and the table shows no `*` markers.
  - This is a UI-level change; the engine output is unchanged (see below).

### Verification (all passed)

- **Engine unchanged.**
  - The full `recommend()` output for 36 states (3 dates × 6 constraint
    sets × 2 weight sets) is **byte-identical** before and after the change.
  - `git diff` shows no changes under `src/lib` or `src/data`, apart from
    one added test.
- **`npx vitest run`:** 86/86. The new real-data test covers both no-feasible
  states: all four tasks are excluded with explicit reasons, and the status
  is not-ranked.
- **Static checks and build:** `tsc`, `eslint`, `npm run build` and
  `npm run check` are clean (03:03:08Z).
- **Smoke test:** 47/47 against `next start` (with `SMOKE_LIVE=1`) and 47/47
  against `next dev`. It includes **22 new UX-0 checks**, run twice: once
  clean and once under a simulated page translation.
  - Disabling all platforms or setting the budget to 0 raises no page error,
    shows the explanation and the "not applicable" basis label.
  - Reset restores the default top task.
  - With the budget at 30 the top task changes to the stand-off survey, and
    the weight label refreshes to `w5` (the stale-value check).
- **The regression check catches the bug.** The same smoke script, run
  against the pre-fix M3 build, failed. Under translation it reproduced the
  `removeChild` crash, and the "not applicable" checks failed.
- **`npm run verify:citations`:** 37/37 quotes matched live (03:03:58Z).

### Rework

- A smoke-test locator first matched the "Deterministic" badge instead of
  the weight value. The bug was in the test, not the app; it was fixed in
  about 1 min.

### Also delivered

- `docs/RANKING_INTEGRITY_PROPOSAL.md`: a follow-up design for owner
  decision 4. Not implemented.
- Outstanding research tasks R1–R3 recorded in `docs/EVIDENCE_CURATION.md`.
- PRD decisions log and plan milestone table updated.

### Known open items (unchanged scientific behavior)

- **The exploratory ranking is still shown as "Top-ranked".** Unreviewed
  links still drive it. They are flagged in the explanations, but the
  validated/provisional split (decision 4) waits for RI-1.
- **All 11 curation items are pending.** D1 stays unapproved.

---

## RI-1: Ranking integrity (review registry; reviewed vs provisional rankings)

- **Started:** 2026-11-05T03:53:15Z. Branch `ri1-ranking-integrity` was
  created from `main` @ `09821a9`.
- **Implementation and verification complete:** about 2026-11-05T04:10Z. The
  exact time is the branch commit (see git log).
- **Wall-clock elapsed:** about 17 min.
  - No subagents were used, so there was no parallel-agent time.
  - No human intervention during the work.
- **Not merged.** The owner reviews acceptance first.

### Implemented

- **Review registry**
  - `src/lib/evidence/review-registry.ts` holds the Zod schema
    (entries, status `pending`/`approved`/`rejected`/`needs_revision`),
    deterministic relationship ids, and relationship enumeration.
  - Registry integrity checks reject missing, duplicate, unknown or
    mismatched entries, unknown evidence sources, and evidence newer than
    the relationship it supports.
  - The reviewer fields are required for any non-pending status and
    forbidden on pending entries.
- **Data**
  - `jezero-margin-unit.reviews.json` has **50 entries, all pending,
    drafted by `ai-agent`, with no reviewer**.
  - Inline `review` fields were removed from the scenario JSON. The diff
    shows only those removals and the resulting trailing-comma changes; no
    scientific content changed.
- **Schema**
  - `*Input` schemas cover the stored JSON.
  - The enriched schemas carry `review`, which the loader attaches from the
    registry.
  - Added the `needs_revision` status.
- **`src/lib/decision/review-modes.ts`**
  - `withoutRelationships`, `taskDependencies`, `rankReviewed` (eligibility;
    available, partial or unavailable) and `rankProvisional` (unreviewed
    inputs; pivotal inputs found by leave-one-out).
  - **The engine is unchanged.**
- **UI**
  - "Reviewed scenario ranking" is the primary panel, showing the explicit
    unavailable state with its reason.
  - "Provisional exploratory ranking" is collapsed and labelled *not
    validated*. It lists the pivotal and all unreviewed inputs, and holds the
    previous comparison and top-task card.
  - A "Scientific review registry" section lists the relationships visible
    on the chosen date, with status, reasoning, limitations and evidence.
  - Each task–gap link shows its review id.
  - The reveal labels the top task as provisional.
- **Tooling and docs**
  - `verify:citations` now also checks registry evidence.
  - New: `docs/RANKING_INTEGRITY.md`.
  - Updated: the decision model, curation, the M3 curation review (L/P/D →
    registry ids), CLAUDE.md, the PRD and the plan.

### Tests executed (all passed)

- **`npx vitest run`: 107/107 across 8 files.**
  - New `review-modes.test.ts` (16 tests). It covers:
    - registry integrity: missing, unknown, mismatched and leaking evidence;
    - no invented approvals;
    - provisional mode equals the engine and drops rejected relationships;
    - pivotal inputs;
    - reviewed mode: unavailable, available (equal to provisional when all
      relationships are approved), partial (hand-computed 0.9 / 0.158333),
      `needs_revision` blocking, rejected = decided, no non-zero scientific
      criterion → unavailable;
    - **metamorphic checks:** changing pending relationships does not change
      reviewed scores; future approved relationships do not change an
      earlier reviewed result; constraints are deterministic.
  - 5 new real-data tests:
    - 50 entries, all pending, no reviewer;
    - reviewed ranking unavailable at 2023-09-08 (28 relationships awaiting)
      and 2025-05-06 (50 awaiting);
    - provisional equals the M3 engine output;
    - exact pivotal inputs.
  - The existing snapshot-leakage tests pass unchanged.
- **Engine output vs the M3 baseline (36 states):** **byte-identical**, both
  for direct engine output and for `rankProvisional`.
- **Static checks and build:** `tsc`, `eslint`, `npm run build` and
  `npm run check` are clean (04:08:36Z).
- **Smoke test:** **56/56** against `next start` with `SMOKE_LIVE=1`, and
  56/56 against `next dev`. There are 9 new RI-1 checks:
  - the reviewed ranking is unavailable;
  - the provisional section is collapsed by default;
  - the 4 pivotal ids are listed;
  - the provisional top-task label is shown;
  - the registry shows 28 pending entries, and 50 with all evidence;
  - the reviewed status is still correct with all platforms off, both clean
    and under simulated translation.

  The UX-0 translation checks still pass.
- **`npm run verify:citations`:** 85/85 quotes matched live: 37 scenario
  quotes plus 48 registry evidence quotes.

### Bugs and rework

- **Real bug, found by the "future approvals" metamorphic test.**
  - The engine's "N later records withheld" limitation was computed on the
    review-filtered scenario. The review status of *future* records
    therefore changed a displayed number, which showed 0 instead of 2.
  - Fixed: both modes now take the count from the unfiltered snapshot.
  - Scores were never affected.
- **Test bugs:**
  - A metamorphic test added a relationship without a registry entry, and
    the loader correctly refused it.
  - The smoke test waited for the provisional card to become visible, but
    the card is now collapsed by design.
- **Fix during data generation:** the generator first picked the wrong quote
  as evidence for one observation–gap link (location instead of
  composition). It was corrected before any test was run on the data.
- **Minor:** 5 lint warnings (unused variables after the split of
  `DecisionSection`) were fixed.

### Human intervention required

- Accept or reject RI-1, and decide on the merge.
- Review the 50 registry entries. Until then the reviewed ranking stays
  unavailable by design.

### Remaining limitations

- **Methodology is not in the registry.** The evidence-quality ordering
  (`asm-evidence-hierarchy`) and the derived-gap rule text are scoring
  methodology. They are labelled ASSUMED and are not gated by the registry.
- **Partial reviews.** A partially reviewed scenario can produce a *partial*
  ranking among fully reviewed tasks only. The coverage denominator then
  counts only approved local gaps.
- **Reviewer identity is self-declared.** The registry records the
  reviewer's name; there is no authentication.

---

## RI-1 merge into `main`

- **Started:** 2026-11-05T04:42:51Z. **Completed:** 2026-11-05T04:43:58Z,
  when the push finished. **Elapsed:** 1 min 7 s.
- **Pre-merge checks (all passed):**
  - Working tree clean.
  - `ri1-ranking-integrity` is exactly 1 commit (`78b15b2`) on top of `main`
    `09821a9`.
  - `npm run check`: 107 tests, typecheck, lint and build.
  - 36-state engine baseline byte-identical.
  - Smoke test 56/56 against `next start` with `SMOKE_LIVE=1`.
- **Merge:** `--no-ff`, giving merge commit **`80e54d0`** on `main`. The
  merged tree is identical to `78b15b2`. All branches are kept.

---

## UX-1: Guided five-step workflow

- **Started:** 2026-11-05T04:45:04Z, when branch `ux1-guided-workflow` was
  created from `main` `80e54d0`.
- **Implementation and verification complete:** about 2026-11-05T04:55Z.
  The exact time is the branch commit (see git log).
- **Wall-clock elapsed:** about 10 min.
  - No subagents were used.
  - No human intervention.
- **Not merged** to `main`; it awaits the owner's acceptance.

### Interface changes (UI layer only)

- **`components/flow/`:**
  - `Stepper` is the five-step indicator. Each step is a button, and the
    current one has `aria-current="step"`.
  - `IntegrityBar` appears on every step and shows the mission date, hidden
    record count, "simulated · not a NASA plan or endorsement", the reviewed
    ranking status (a link to Result), the number of feasible tasks excluded
    pending review, and the number of relationships awaiting review.
  - `steps.ts` defines the five steps.
- **`InvestigationWorkspace` is now the step controller.**
  - Mission date, weights, constraints and the current step live in one
    component.
  - All five panels stay mounted and only the current one is shown
    (`hidden`). Every selection therefore survives navigation, including the
    open/closed state of sections and the reveal.
  - Back and Next buttons sit at the bottom of the panel. On navigation the
    panel scrolls to the top and focus moves to the step heading; focus is
    not moved on first load.
  - The map stays visible on desktop. On mobile it is above the panel.
- **Content of each step:**
  - **Mission:** the mission question, a plain explanation, a 5-step
    "how it works" list, the scenario card, mission-date controls with the
    valid range, and caveats (simulation, not NASA, simulated costs, scores
    are not probabilities, AI-drafted relationships pending review).
  - **Evidence:** observations, hypotheses and interpretations, regional
    context.
  - **Unknowns:** evidence gaps.
  - **Decision:** a ranking status box with a "See the result" button,
    tasks, constraints, weights, and a collapsed provisional comparison.
  - **Result:** the reviewed ranking, the provisional ranking (collapsed),
    "What happened later", and the review registry.
- **Reviewed ranking wording:**
  - A partial result reads "**Top among reviewed tasks: …**".
  - A full result reads "Top-ranked task (all feasible tasks reviewed): …".
  - "Feasible tasks excluded because their scientific review is incomplete:
    N" is always shown.
  - "Not a NASA recommendation or endorsement" was added.
- **Reuse.** `EvidenceSection` gained a `show` prop.
  `DecisionSection.part` is now `inputs`, `comparison` or `recommendation`,
  and the existing card components are reused.
- **Unchanged:** no changes under `src/lib` or `src/data`, and no new
  dependencies.

### Tests executed (all passed)

- **`npm run check`:** 107/107 unit tests, typecheck, lint and production
  build (04:53Z).
- **36-state regression set:** direct engine output and `rankProvisional`
  output are both byte-identical to the M3 baseline. Reviewed ranking logic
  is unchanged; `git diff main -- src/lib src/data` is empty and the
  `review-modes` tests pass.
- **Smoke test: 75/75** against `next start` with `SMOKE_LIVE=1`, and 75/75
  against `next dev`. 19 checks are new for UX-1:
  - 5 steps, with Mission current on load and only one panel shown;
  - Next and Back by mouse, with the focus check;
  - Enter on a stepper button and on Next by keyboard, with the focus check;
  - the integrity bar and the map are visible on all five steps;
  - the bar content (reviewed status, NASA disclaimer, 4 excluded tasks);
  - Result is one click from Mission, and the excluded count of 4 is shown;
  - budget and weight selections persist across steps;
  - no NASA-endorsement wording appears anywhere;
  - all five steps can be navigated cleanly **and** under simulated
    translation.

  All earlier checks (map, M3, RI-1, UX-0 translation) pass after adding
  step navigation.
- **`npm run verify:citations`:** 85/85.
- **Mobile at 390 px:** 0 px horizontal overflow; screenshot reviewed.

### Bugs and rework

- **Environment problem, about 3 min.** A `next-server` child process from
  the previous smoke run kept port 3000. The new server failed to start, and
  the first screenshot script reached the stale server. `pkill -f "next
  start"` does not kill the `next-server` child. Fixed by killing
  `next-server` explicitly.
- **Test bug.** The smoke test referenced a top-level `const` before it was
  initialised. It was moved into the function.
- **Expected adaptation.** Existing smoke checks now navigate to the right
  step before they interact.

### Remaining UX problems (for UX-2 and later)

1. **The Decision step is still long** (about 3.4 screens at 1440×900).
   Tasks with link rationales and the weights should move behind
   "Advanced / scientific details".
2. **Internal terminology remains in the main UI:** "Evidence gap", "NE",
   "Curated", "Deterministic", "Regional context" (UX-2 vocabulary).
3. **Mobile:** the header, stepper, a four-line integrity bar and the map
   take about 70% of the screen, leaving little room for step content. The
   map and the bar need collapsing on small screens.
4. **The map is not yet linked to steps or selections** (UX-4).
5. **The Result step has no outcome summary.** When the reviewed ranking is
   unavailable, the screen is mostly warnings, and the provisional ranking
   needs a click (UX-3).
6. **The no-feasible-task state has no one-click recovery actions** (UX-3).
7. **Navigation is not tied to the URL.** Browser Back does not move between
   steps, and steps have no shareable deep links.
8. **The integrity bar is a polite live region** that also contains
   buttons. Its behaviour with real screen readers is untested.
9. **The reasons for NE values in the comparison table are still shown only
   on hover.**

---

## Assessment task: map-first interaction & 3D feasibility

This task is tracked separately. Earlier recorded durations are unchanged.

- **Started:** 2026-11-05T05:48:32Z (first command after the request).
- **Completed:** 2026-11-05T05:58:55Z, when commit `f369591` was pushed on
  branch `map-first-assessment` (from `main` `80e54d0`).
- **Wall-clock elapsed:** 10 min 23 s.
  - No subagents were used.
  - No human intervention.
  - The owner's review time is not included.
- **Scope:** read-only research and documentation. No application code,
  data or dependencies changed. UX-1 (`ux1-guided-workflow`, `09e8fa4`) is
  untouched and not merged. Output: `docs/MAP_FIRST_ASSESSMENT.md`.

### Findings recorded (details in the assessment)

- **Jezero DTMs.**
  - Trek serves the CTX (20 m) and HiRISE (1 m) Jezero DTMs as GeoTIFF
    downloads only, not as WMTS.
  - The CTX DTM was downloaded and inspected: float32, Mars 2000 sphere,
    heights relative to the areoid. It agrees with the PDS coring-site
    elevations to within 3 m.
  - The HiRISE DTM is 1.84 GB, and its endpoint ignores Range requests.
- **Perseverance traverse.**
  - It is available as queryable vector polylines with a `sol` field: 332
    segments, sols 14–1176.
  - The dataset's catalog date is 2024-07-03, after the snapshot. This is
    an open temporal-policy decision.
- **PDS coring coordinates** lie within 2.5 m of the traverse. This
  corroborates a planetocentric, east-positive convention and partly
  resolves R3. All three sites are after the snapshot.
- **Blocked by the proxy (403), not bypassed:** www.usgs.gov,
  hirise.lpl.arizona.edu and registry.opendata.aws.

### Rework

- A Python parser assumed every traverse feature was a `LineString`. Four
  are `MultiLineString`; this was fixed in the scratch script.
- A Range-request probe streamed 480 MB before timing out. It showed that
  the server does not support Range, and the partial file was deleted.

---

## Requirement change: present-day mission simulation (design update)

This task is tracked separately. Earlier recorded durations are unchanged,
including the map-first assessment's 10 min 23 s.

- **Started:** 2026-11-05T06:12:43Z (first command after the owner's decision).
- **Completed:** 2026-11-05T06:17:18Z, when the documents were committed on branch
  `map-first-assessment`.
- **Wall-clock elapsed:** 4 min 35 s.
  - No subagents were used.
  - No human intervention.
- **Scope:** design and documentation only. No application code, data,
  dependencies or engine changes. MF-0 had not started, so there was no
  completed work to preserve. UX-1 is untouched and not merged.

### Work performed

- **Engine check (read-only, scratch test outside the repo).**
  - In present-day mode (all records) the existing engine gives the same
    result as the `2025-05-06` baseline state:
    - reviewed ranking unavailable (50 awaiting review);
    - provisional top task abrasion (0.743), ahead of coring (0.700);
    - margin 0.043; 3 pivotal inputs;
    - `gap-no-in-situ-data` addressed.
  - No engine change is needed.
- **Data probes.**
  - The Trek traverse ends at sol 1176. The rover's last position in the
    dataset is 18.49568° N, 77.30381° E.
  - mars.nasa.gov (MMGIS) is blocked by the proxy (403).
  - Trek has no sample-location layer.
  - PDS sample-dossier initial reports exist as volumes 1–5 (volume 5
    label dated 2026-02-10).
  - Volume 4 states the coordinates for Pelican Point, Lefroy Bay and Comet
    Geyser. Lefroy Bay is now confirmed from the source text.
- **Documents.**
  - New `docs/MAP_FIRST_DESIGN.md`: MF-0 design, revised MF-1 to MF-4 and
    decisions D1–D6.
  - Updated `docs/PRODUCT_REQUIREMENTS.md` (v0.4, decisions log),
    `docs/DEVELOPMENT_PLAN.md` (MF rows; stale RI-1 row corrected) and the
    superseded note in `docs/MAP_FIRST_ASSESSMENT.md`.

---

## MF-0: present-day geographic data foundation

- **Started:** 2026-11-05T06:20:06Z. Branch `mf0-geo-data` was created from
  `ux1-guided-workflow` (`09e8fa4`), and the design branch
  `map-first-assessment` was merged in at 06:20:29Z.
- **Completed:** 2026-11-05T06:35:05Z, implementation and verification complete, at commit.
- **Wall-clock elapsed:** 14 min 59 s. This includes data
  processing and debugging.
  - No subagents were used.
  - No human intervention.
- **Not merged.** UX-1 is not merged separately.

### Timeline (UTC)

- **06:20–06:21:** branch, docs merge (two conflicts resolved), source
  probes.
- **06:22–06:24:** traverse fetch script; first data run at 06:23
  (332 segments, 20,720 → 2,947 vertices).
- **06:24–06:27:** curation of geographic records and sources; quick live
  quote check of the Trek and Gazetteer quotes (9/9).
- **06:27–06:30:** `lib/geo` and `lib/mission`, then tests.
- **06:30–06:31:** `verify:geo` (live), then the full `verify:citations`
  (100/100).
- **06:31–06:34:** `npm run check`, engine baseline, smoke test.
- **06:34 to the end:** documentation.

### Implemented (data and pure logic; no UI change, no new dependency)

- **`src/data/geo/jezero-geo.json`:**
  - four coordinate conventions, two "stated" and two
    "inferred-cross-validation";
  - the documented cross-validation checks;
  - 8 records: the crater centre, three PDS vol. 4 sample sites, and the CTX
    and HiRISE ortho and DTM extents.
- **`src/data/geo/perseverance-traverse.json`:** generated by
  `scripts/fetch-traverse.mjs`. Trek traverse, 332 segments, sols 14–1176,
  simplified within 0.5 m, with provenance, CRS interpretation and
  length-check metadata.
- **`src/data/missions/jezero-2026.json`:** the simulated astronaut mission
  2026, with disclaimer, evidence notes, action framing and the R4 caveat.
- **`src/data/sources.json`:** +5 Mars Trek catalog sources (four products
  and the traverse).
- **`src/lib/geo/`:**
  - `schema.ts`: Zod schemas;
  - `integrity.ts`: quotes equal the values, availableFrom equals the source
    date, bboxes equal the quoted catalog bbox and the map-layer extent, a
    related observation must name the sample, traverse ordering and the
    final-sol rule;
  - `repository.ts`: validated loader;
  - `geometry.ts`: Mars-sphere distances;
  - `features.ts`: render-neutral `MapFeature` adapters, the last-position
    feature and `toGeoJson`.
- **`src/lib/mission/`:**
  - `schema.ts` and `mode.ts`: present-day vs historical-replay context (one
    evidence date for the existing `selectEvidenceAsOf`);
  - `selectGeoFeatures`, which withholds post-date features and, in replay,
    the whole traverse until MF-2.
- **`scripts/verify-geo.mjs`** (`npm run verify:geo`): live traverse
  comparison, catalog bbox check, and CTX DTM elevation at the sample sites
  (minimal TIFF reader, no dependency).
- **`scripts/verify-citations.mjs`** now also checks the geographic quotes.
- **Docs:**
  - new `docs/GEO_DATA.md`;
  - CLAUDE.md layout and rules;
  - `EVIDENCE_CURATION.md`: R3 partly resolved, R4 added;
  - status and decisions updates in the design, requirements and plan docs.

### Tests executed (all passed)

- **`npm run check`:** lint, typecheck, production build, and **147/147**
  unit tests (107 existing + 40 new geo and mission tests).
- **Engine regression:** the 36-state engine output and the provisional
  ranking output are **byte-identical** to the M3 and UX-1 baselines. `git
  diff ux1-guided-workflow -- src/lib/decision src/lib/evidence
  src/components src/app src/data/scenarios` shows only the orphan-source
  test extension.
- **`npm run verify:citations`:** **100/100**, live (85 existing + 15 new
  geographic).
- **`npm run verify:geo`:** **9/9** checks.
  - The traverse matches live per segment.
  - All vertices are inside the catalog bbox.
  - The CTX DTM georeference matches the catalog.
  - PDS − DTM elevation: +1.8, +3.6 and +3.0 m.
- **Smoke** (`next start`, `SMOKE_LIVE=1`): all checks passed, 0 failures.
  - The script is unchanged from UX-1.
  - This run printed 77 PASS lines (64 clean + 13 translated). The UX-1
    entry above records 75. The reason for the difference was not
    investigated; the UI is unchanged.

### Rework and debugging

1. **Merge conflicts** in `DEVELOPMENT_LOG.md` and `docs/DEVELOPMENT_PLAN.md`
   when merging the design branch. Resolved by keeping both log entries in
   chronological order and writing a combined plan table.
2. **Trek ignores `orderByFields` for `f=geojson`.** Segments are now sorted
   locally by sol and FID.
3. **Wrong metadata URL.** The layer's `?f=json` has no spatial reference,
   which produced "wkid unknown". Fixed by reading the MapServer root
   (wkid 104905).
4. **Wrong first-draft comment.** It said the traverse z values were
   placeholders. Checking showed 12,360 distinct values from −3989 to
   +2559 m. They are now documented as undocumented and not elevations,
   and they are dropped.
5. **Over-strict length test.** It expected the simplified geometry to match
   the length attribute within 0.5%; it is 1.1% shorter, as simplification
   is expected to make it. The simplified length is now recorded, with a
   note to use the attribute for distances.
6. **Test bug:** the key regex `/lat/` matched `platform`. Anchored.
7. **Existing orphan-source test failed,** because the new Trek sources are
   cited only by geographic data. The test now includes geographic
   citations (a test-only import), and the separation test checks
   production files only.

### Blockers

None for MF-0. As before, `mars.nasa.gov`, `www.usgs.gov`,
`hirise.lpl.arizona.edu` and `registry.opendata.aws` are blocked by the
proxy. Newer traverse data was deliberately not pursued (owner decision 4).

---

## MF-1: map-first mission explorer UI

- **Started:** 2026-11-05T06:54:28Z. Branch `mf1-map-first-ui` was created from
  `mf0-geo-data` (`495ed84`).
- **Completed:** 2026-11-05T07:18:22Z, implementation and verification complete, at commit.
- **Wall-clock elapsed:** 23 min 54 s. This includes
  debugging and screenshots.
  - No subagents were used.
  - No human intervention.
- **Not merged.** `main` and `ux1-guided-workflow` are untouched.

### Timeline (UTC)

- **06:54–06:58:** read the UI code; 77-vs-75 investigation; limitation text
  change and its regression test.
- **06:58–07:06:** map layers and selection; feature-details and action
  view models; workspace shell (objective strip, cards, action strip,
  drawers); stepper removed.
- **07:06–07:09:** first screenshots and layout fixes.
- **07:09–07:12:** smoke-test rewrite and view-model unit tests.
- **07:12–07:18:** full verification, zoom fix, final screenshots.
- **07:18 to the end:** docs and log.

### Main UI changes

- **The five-step wizard is removed** (`Stepper`, `steps.ts`,
  `InvestigationWorkspace`). It is replaced by `MissionWorkspace`, a single
  screen with:
  - **Objective strip:** mission badge, objective, the evidence label
    "latest verified in this dataset, through 2025-05-06 (not all NASA
    data)", the reused UX-1 `IntegrityBar`, the disclaimer, and the
    simulated choice.
  - **The NASA map** as the dominant area.
  - **A feature context card** (`FeatureCard`).
  - **An action strip** (`ActionStrip`, with the constraint controls) and
    action details (`ActionDetail`).
  - **An evidence drawer** and an **advanced scientific workspace drawer**
    (`Drawer`, non-modal: Escape closes it, and focus moves to the heading
    and back to the opener).
- **Reused, not duplicated:**
  - `DecisionSection` parts (`tasks`, `weights`, `comparison`,
    `recommendation`) and the new shared `ConstraintsControls`;
  - `ReviewedRankingSection`, `ProvisionalSection`,
    `ReviewRegistrySection`, `RevealSection` and `EvidenceSection`;
  - the MF-0 libraries.
- **Historical replay** (date picker, reveal, retrospective) moved into the
  advanced drawer as an optional mode.
- **New pure modules:**
  - `src/lib/geo/details.ts` (card content from geographic records);
  - `src/lib/mission/actions.ts` (action view model built from engine output
    only);
  - `src/lib/map/geo-layers.ts` (layer configuration and click priority).
- **Layout:** a CSS grid. On phones the order is map, feature card, action
  strip, action details. On desktop the cards float over the map cell.
  Everything stays mounted, so state survives drawers.

### Map interaction

- **Vector layers** (OpenLayers, no new dependency):
  - the traverse (332 drives, light blue);
  - the PDS sample sites (dot plus dashed ring = inferred convention);
  - the last position in the dataset (diamond plus dashed ring);
  - the Jezero centre (white cross; stated convention);
  - the optional imagery/DTM extents (dashed outlines, off by default).
- **Legend:** independent toggles with counts, a legend entry explaining the
  dashed ring, and an explicit note that simulated actions are not drawn.
- **Selection:**
  - by click: points first, then lines, then outlines;
  - or by keyboard, from a "Select a feature" list (it centres the map,
    re-enables a hidden layer, and caps zoom at 15 near the CTX native
    resolution).
  - Hiding a layer clears its selected feature. The map container is
    focusable (arrow keys pan, + and − zoom).
- **No Margin Unit polygon, astronaut position or task coordinates** are
  drawn. Labels show only when zoomed in or selected.

### Limitation text change (owner-authorised; output text only)

Scenario `limitations[2]`, which also appears in the engine's
`Recommendation.limitations`:

- **Before:** "No Margin Unit outline or sample markers are drawn: no published footprint was found, and the PDS sample coordinates' convention is not stated in the source."
- **After:** "Verified historical sample locations are displayed on the map (in historical replay, only once their source is public); their coordinate convention is inferred by cross-validation. No verified Margin Unit boundary is available, and simulated observation tasks have not been assigned precise geographic locations."

The wording keeps the owner's meaning and adds two facts already
documented: replay hides sample sites until their source is public, and the
convention is inferred.

**Engine outputs are NOT byte-identical** after this change: every one of the
36 states contains the new sentence. With the new sentence mapped back to
the old one, the engine grid and the provisional grid are byte-identical to
the UX-1 baseline (scratch harness, 07:15Z). In addition,
`src/lib/decision/limitation-text.test.ts` runs a metamorphic comparison over
the same 36 states. It checks that, apart from this string, the following
are unchanged for `recommend`, `rankProvisional` and `rankReviewed`:
- ranking, totals and outcomes;
- feasibility (`infeasible`, `unranked`);
- stability and basis;
- review statuses.

It also checks replay: 11 records withheld on 2023-09-08, the same top tasks
at budgets 100 and 30, and 28 relationships awaiting review.

### Ranking and science integrity

- **RI-1 semantics are unchanged.** The reviewed ranking stays unavailable
  (50 pending; 4 feasible actions excluded).
- **The provisional rank is never on the action cards.** It sits in a
  collapsed "Inspect provisional ranking (not scientifically validated)"
  section and in the collapsed provisional ranking in the advanced drawer.
- **Essential limitations sit next to each selected action:**
  - provisional review status;
  - reviewed ranking unavailable;
  - simulated future action, not a NASA operation;
  - the R4 2026-reassessment caveat;
  - "Location: none assigned".
- **Choosing an action** records a simulated decision in session state only.
  Nothing is executed. An infeasible choice is flagged.
- **No changes** to `src/lib/decision` or `src/lib/evidence` production code,
  the registry, or evidence records (apart from the limitation sentence). No
  relationship was approved.

### Tests executed (all passed)

- **`npm run check`:** lint, typecheck, production build, **164/164** unit
  tests (147 earlier + 6 limitation-change + 11 view-model).
- **`npm run verify:citations`:** **100/100** live.
- **`npm run verify:geo`:** 0 problems.
- **Engine grids:** identical to the UX-1 baseline except for the authorised
  sentence (see above).
- **Smoke** (`next start`): **120 checks with `SMOKE_LIVE=1`**, **118
  without**, 0 failures. The smoke test was rewritten for MF-1, and its
  summary now prints the number of checks. New checks cover:
  - geographic selection (by list and by map click);
  - card content and the inferred-convention mark;
  - evidence on demand with highlight and focus return;
  - the traverse drive card;
  - layer toggles (traverse, extents, HiRISE tiles);
  - the last-position warning;
  - action selection, simulated choice and the infeasible-choice flag;
  - budget-dependent feasibility;
  - drawers and state persistence;
  - historical replay (withheld map features, 28 registry entries, reveal);
  - keyboard (action card, map zoom, drawer Escape and focus);
  - no live or current-position wording;
  - translation regression (clean vs simulated translation, including
    infeasible states);
  - mobile (no overflow, map in the first screen, collapsed layer panel,
    order, drawer width).

  The M3 and RI-1 checks (NE values, basis exclusion, pivotal inputs, 50 and
  28 registry entries, Nue as regional context) were kept and adapted to the
  drawers.

### The 77 vs 75 PASS lines

Each PASS line is one executed `check()` assertion; INFO lines are logs.
Two checks run only with `SMOKE_LIVE=1` ("real NASA tiles loaded" and "no
tile errors").

The UX-1 entry's "75" came from a second run **without** `SMOKE_LIVE=1`
(`npm run smoke | grep -c "^PASS"`). The live run was only grepped for
failures. MF-0 counted the live run, giving 77 = 75 + 2.

So both counts are real tests, and both runs passed. The UX-1 entry's
wording "75/75 with SMOKE_LIVE=1" was inaccurate. The MF-1 runs confirm the
pattern: 120 live vs 118 plain.

### Rework and debugging

1. **Sample markers invisible.** OpenLayers decluttering hid each sample's
   dot and label behind its own dashed-ring style. Decluttering was
   removed; labels now show only when zoomed in (≤ 0.00012°/px) or
   selected.
2. **Mobile horizontal overflow of 14 px,** from the budget control's minimum
   widths. It now wraps.
3. **Mobile order:** action details appeared above the strip. Fixed with
   grid areas.
4. **The layer panel overlapped the tile-status badge.** Its maximum height
   was reduced.
5. **Feature-list zoom of 17 was far past the CTX native zoom (13) and looked
   blurry.** Capped at 15.
6. **Smoke:** the advanced drawer covers the strip's "Reset constraints"
   button, so the test closes the drawer first. This is also a known UX
   limitation, below. A malformed check line was fixed.
7. **Lint:** an unused variable after splitting `DecisionSection`.

### Known UX limitations

1. **Drawers cover part of the map and action strip on desktop.** Constraints
   cannot be changed while the advanced drawer is open.
2. **The objective strip is about 4 lines on desktop and about 9 on phones.**
   On phones the map starts about 390 px down.
3. **Canvas features are not individually focusable.** The keyboard path is
   the feature list, and its 332 traverse drives make it long.
4. **Sample sites lie within about 700 m of each other** and overlap at crater
   scale. The CTX and HiRISE ortho and DTM extents nearly coincide, so a
   click picks one; use the list.
5. **Vocabulary is mixed:** the integrity bar still says "task(s)" while the
   strip says "actions".
6. **Replay hides post-date geographic features, but not the base imagery
   layers.** The 2020 mosaics also appear for earlier replay dates.
7. **The simulated choice is session-only:** it is lost on reload, and there
   are no URL deep links.
8. **The advanced workspace is still long.** It is the former dashboard
   content, now opt-in.
9. **Not tested with real screen readers.**

---

## Product value spike: location-specific science briefing (Lefroy Bay)

This task is tracked separately. Earlier durations are unchanged.

- **Started:** 2026-11-05T07:36:58Z (first command after the owner's request).
- **Completed:** 2026-11-05T07:40:18Z, at commit, on the docs-only branch
  `product-value-spike` (from `mf1-map-first-ui` `e2b910f`).
- **Wall-clock elapsed:** 3 min 20 s.
  - No subagents were used.
  - No human intervention.
- **Scope:**
  - Read-only evidence audit and documentation.
  - No UI, engine, evidence or review-registry change; nothing merged.
- **Output:** `docs/PRODUCT_VALUE_SPIKE.md`.

### Work performed

- **Read the Lefroy Bay initial report** (PDS vol. 4, report 26). Read
  sections: summary, lithology header, SHERLOC, SuperCam, preliminary
  assessment, returned-sample science considerations.
- **Verified 21 candidate briefing quotes verbatim** against the source text
  (21/21 found).
  - Seven of them occur twice in the volume: text shared with the Pelican
    Point report (a curation risk; section-scoped verification is needed).
  - Found two source editorial errors: the copied "make Pelican Point …"
    sentence, and "Lake Newell" vs "Lake Newall".
- **Cross-checked the source against our coordinates:** Pelican Point is
  370 m from Lefroy Bay at a bearing of 147° (south-east). The source says
  "about 380 meters to the southeast".
- **Mapped the existing scenario records that bear on Lefroy Bay.** Only
  `obs-lefroy-bay-hydrated-silica` is site-specific; the hypotheses and
  `gap-sedimentary-or-igneous` are margin-unit level.

---

## BR-1: curated Lefroy Bay science briefing data

- **Started:** 2026-11-05T08:11:34Z. Branch `br-lefroy-briefing` was created from
  `product-value-spike` (`5b6ab13`), which is MF-1 plus the spike docs.
- **Completed:** 2026-11-05T08:21:27Z, at the BR-1 commit.
- **Wall-clock elapsed:** 9 min 53 s. This includes the
  190 MB PDF download for section-scoped verification.
  - No subagents were used.
  - No human intervention.
- **Scope:**
  - Data, schema, integrity, verification and tests.
  - No UI change, no engine change, no review approvals, no new sources.

### Implemented

- **`src/data/briefings/lefroy-bay.json`:** 24 items, 1 quarantined
  statement, 4 source notes, and the report-section map (11 headings).
  Items by classification:
  - measured: 15;
  - interpreted: 2;
  - open question: 3;
  - proposed by source: 2;
  - simulated idea: 2.
- **`src/lib/briefing/`:**
  - `schema.ts` (Zod);
  - `integrity.ts` (offline rules: topic and classification, shared-wording
    scope, conditions on future investigations, pending simulated ideas
    with no repeated operations, all operations stated, quarantine);
  - `repository.ts` (validated loader; it fails the build on bad data).
- **`scripts/verify-briefing.mjs`** (`npm run verify:briefing`): live,
  section-scoped verification by page label.
- **`scripts/lib/source-text.mjs`:** shared fetch and text helpers.
  `verify-citations.mjs` now imports them and also checks the briefing
  quotes.
- **Docs:** `docs/BRIEFINGS.md`; CLAUDE.md rules and layout.

### Checkpoint results (all passed)

- **`npm run check`:** lint, typecheck, build, **179/179** unit tests (+15
  briefing tests).
- **`npm run verify:briefing`:** **35 location checks, 0 problems.**
  - Shared with Pelican Point, as declared: 3 item quotes and the
    quarantined sentence.
  - Mutation test: 4 out of 4 injected errors detected (wrong section,
    wrong page, undeclared sharing, a quote only in the Pelican Point
    report).
- **`npm run verify:citations`:** **129/129** (100 earlier + 29 briefing
  citations).
- **`npm run verify:geo`:** 0 problems.
- **Engine and provisional grids:** byte-identical to MF-1. No diff in
  `src/lib/decision`, `src/lib/evidence`, `src/data/scenarios`,
  `src/data/geo` or `sources.json`.

### Rework

- **Test-harness path:** the scratch probe test was outside the scratch
  vitest root. The real test file was written instead. No product impact.
