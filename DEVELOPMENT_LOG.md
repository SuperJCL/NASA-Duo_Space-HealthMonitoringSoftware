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
