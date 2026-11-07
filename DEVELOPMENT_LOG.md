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

---

## BR-2: minimal Lefroy Bay science-briefing UI

- **Started:** 2026-11-05T08:22:17Z, after the BR-1 checkpoint passed (BR-1 commit
  `b9701e1`).
- **Completed:** 2026-11-05T08:41:00Z, at the BR-2 commit.
- **Wall-clock elapsed:** 18 min 43 s.
  - No subagents were used.
  - No human intervention.
- **Same branch** `br-lefroy-briefing`; BR-2 is a separate commit.
- **Not merged.**

### Interface changes

- **Default view:** the Mars map (left) plus a location panel (right; below
  the map on phones). The panel shows:
  - a **site chooser** (what the app does, and the 3 real sample sites, with
    Lefroy Bay marked "Science briefing");
  - the **Lefroy Bay briefing**;
  - or the existing **feature card** for other features (sites without a
    briefing say so).
- **Briefing (`BriefingPanel`),** in this order:
  - why the location matters;
  - a prominent **"Still unknown"** box (the sample-level open question, with
    the two Margin-unit-wide questions below it);
  - what was measured;
  - what the team thinks (preliminary);
  - already done here (sols 920, 935, 936–939, 942, 949, with "does not
    suggest repeating them");
  - what the source proposes next (conditions shown as chips: return not
    guaranteed; not an approved NASA activity), the NASA sample-status
    statement, and a separate "Simulated ideas (MDI): not NASA plans, not
    reviewed" box;
  - "Is the rover at Lefroy Bay now?" (computed from the historical
    traverse).

  Each line has a **Source** toggle (collapsed by default) with the exact
  quotation, report section and page, and a link to the source. The footer
  has links to the original report, **Methods & audit** and the **Advanced
  ranking workspace**.
- **Methods & audit drawer (`BriefingMethods`):** how the briefing was built,
  counts per classification, section-scoped verification, the 3 statements
  shared with Pelican Point, the quarantined sentence, and the 4 source
  notes.
- **Advanced ranking workspace:** the MF-1 functionality is preserved and
  moved here:
  - integrity bar;
  - the four simulated actions, now stated as "not tied to any location",
    with constraints, action details and the simulated choice;
  - mission mode and historical replay;
  - reviewed and provisional rankings;
  - comparison, weights, tasks and registry.

  The four actions are **no longer shown in the default view** and never as
  location recommendations.
- **Map:**
  - sample-site and last-position labels are always on;
  - the first view frames the three sites and the last position;
  - the layer panel starts collapsed so the sites stay visible;
  - a site selected from the panel is brought into view (no animation).

  There are no new map features and no task geometry.
- **Wording fix:** the last-position warning no longer says "The rover has
  continued since". That claim has no source in the app; it now reads "This
  app has no rover data after this sol." This is a `lib/geo/details.ts`
  text change, not an engine change.

### Tests (all passed)

- **`npm run check`:** lint, typecheck, build, **185/185** unit tests (+6
  briefing view-model tests).
- **Smoke** (`next start`): **116 checks with `SMOKE_LIVE=1`**, **114
  without**, 0 failures. Rewritten for BR-2, it covers:
  - the site chooser; actions not in the default view;
  - the briefing sections;
  - the open question visible without scrolling at 1280 × 800;
  - the answer to Q1 in the first screen;
  - classification separation per section;
  - already done with sols; conditional future work (Q3); the rover note
    (Q4);
  - Source toggles with quote, page and report link;
  - map-click selection; a non-briefing site; Methods & audit;
  - traverse, extent, HiRISE and last-position checks;
  - the full advanced-workspace regression (actions, simulated choice,
    budget feasibility, RI-1 unavailable/provisional/pivotal, NE values,
    registry 50/28, replay, reveal, persistence across drawers);
  - keyboard (Enter on a site, Enter on Source, map zoom, Escape focus
    return);
  - endorsement and live-position wording;
  - translation regression (clean vs simulated);
  - mobile (no overflow, order, drawer width).
- **`npm run verify:briefing`:** 35 location checks, 0 problems.
- **`npm run verify:geo`:** 0 problems.
- **Engine and provisional grids:** byte-identical to MF-1. No diff in
  `src/lib/decision`, `src/lib/evidence` or `src/data` since BR-1.

### Rework

1. **The layer panel open by default covered the sample sites.** It now
   starts collapsed in this view, and the map brings a selected site into
   view.
2. **A per-line "MEASURED" badge on every line was visual noise.** Single-
   classification sections now state the label in their heading; per-line
   badges remain only in mixed sections.
3. **Smoke:**
   - a helper replacement accidentally made the layer-panel helper call
     itself, and the run hung; it was stopped and fixed;
   - one regex expected text at the start of a block with a heading;
   - one check still looked for the removed MF-1 heading.
4. **Unsourced wording** "The rover has continued since" was removed (see
   above).

### Known limitations

- **No usability result yet.** The protocol is
  `docs/BR2_USABILITY_TEST.md` (BR-2 vs the MF-1 baseline). No improvement
  is claimed.
- **Only Lefroy Bay has a briefing.** Pelican Point and Comet Geyser show
  location cards (BR-3).
- **The briefing rests mainly on one preliminary report** (2023-12-18). Newer
  literature is not in the dataset.
- **The panel is long when fully scrolled**, though the key answers sit in
  the first screen on desktop. On phones the briefing starts below a 42%
  map.
- **"Source" links open the whole 190 MB PDS PDF;** there is no page anchor.

---

## MDI 2.0 Mission Glass interaction prototype

- **Started:** 2026-11-05T18:33:25Z. Branch `mdi2-mission-glass-prototype` was created
  from `br-lefroy-briefing` (`b92e027`).
- **Completed:** 2026-11-05T18:46:50Z, at commit.
- **Wall-clock elapsed:** 13 min 25 s.
  - No subagents were used.
  - No human intervention.
- **Not merged.** The full MDI 2.0 implementation has not been started.
  Stopped for manual usability review.

### Built

- **Route `/mission-glass`**, with Planning and EVA HUD modes sharing one
  mission state. Details: `docs/MISSION_GLASS_PROTOTYPE.md`, which covers:
  - design tokens;
  - the state contract;
  - actual vs scenario data;
  - implemented vs mocked interactions.
- **Pure state module** `src/lib/prototype/mission-glass.ts` (9 tests) and
  scenario file `src/data/prototype/mission-glass.json`:
  - the 3 surface tasks;
  - targets defined as offsets from the verified Lefroy Bay site;
  - steps, events and warnings.
- **Components** in `src/components/prototype/`: `MissionGlass`,
  `TaskCard` (Levels 1 and 2), `EvidenceSheet` (Level 3), `EvaHud`.
- **`MarsMap`** gained optional props, with no change to existing behaviour:
  - a simulated-target layer;
  - minimal chrome;
  - initial overlays;
  - a view-extent attribute.
- **Engine use:** `rankProvisional` / `rankReviewed` with the scenario's
  excluded platform (orbital). The ranks at 100 points are abrasion 1,
  coring 2, survey 3. At 50 points, coring is infeasible and survey moves
  to 1.

### Tests (all passed)

- **`npm run check`:** 194/194 unit tests (+9), typecheck, lint and build
  (the new route is static).
- **Main app smoke (BR-2):** 116 checks with `SMOKE_LIVE=1`, 0 failures.
- **Prototype smoke** (`npm run smoke:mission-glass`): 41 checks, 0
  failures, against `next start`.
- **Engine and provisional grids:** byte-identical to MF-1 and BR-2. No diff
  in `lib/decision`, `lib/evidence`, `lib/geo`, `lib/briefing`, scenario,
  geo or briefing data, or `sources.json`.

### Rework

1. **The planning panel hid the map's legacy controls.** The planning map now
   uses minimal chrome.
2. **"SIM · Sim target A" was redundant.** Targets are renamed "Target A–C".
3. **Cards were too tall.** Status and buttons were merged into one row.
4. **Level 3 had no source quotation,** because the task–gap links carry
   none. Each question's own source quotation is now shown (or its rule, for
   rule-defined questions), and the sheet background is more opaque.
5. **A plan timeline was added to the HUD** so task states are visible at a
   glance.

---

## MG-1: Mission Glass planning flow (compare → add → review → create)

- **Started:** 2026-11-05T22:50:06Z. Branch `mg-refinement` was created from
  `mdi2-mission-glass-prototype` (`323622c`).
- **Completed:** 2026-11-05T22:56:10Z, at commit.
- **Wall-clock elapsed:** 6 min 4 s.
  - No subagents were used.
  - No human intervention.

### Files changed

- `src/lib/prototype/mission-glass.ts`: added `planFit` and `addability`
  (plain-language feasibility; simulated effort arithmetic only).
- `src/components/prototype/TaskCard.tsx`, redesigned:
  - one add/remove toggle;
  - a selectable title (keyboard);
  - cost and an effort bar;
  - a feasibility line;
  - "Details" demoted to a text link.
- `src/components/prototype/PlanReview.tsx` (new): a review dialog with
  order, running totals, remove, caveats, and "Create plan".
- `src/components/prototype/MissionGlass.tsx`, planning panel:
  - flow indicator (1 Compare · 2 Add · 3 Review & create);
  - a single provisional-priority note;
  - a plan bar with a per-action effort meter and a plain-language hint;
  - the single primary action "Review plan (N)";
  - the budget is locked once a plan exists.
- `src/lib/prototype/mission-glass.test.ts` (+2 tests) and
  `scripts/smoke-mission-glass.mjs` (planning section rewritten).

### Interaction changes

- **One primary button per state:** "Review plan" before the plan exists,
  "Create plan" in review, "Open EVA HUD" after creation. "Fill with
  suggested order" is a secondary text link.
- **Each card says why it can or cannot be added:**
  - fits, with what remains;
  - "Doesn't fit your plan: needs 15 pts, only 5 pts left…";
  - "Not possible: needs 55 pts, but the whole budget is 50 pts."
- **Selecting a card title highlights its target on the map.** Clicking a
  target selects its card and scrolls it into view.

### Tests

- **Unit:** 196/196 (+2 plan-fit and feasibility tests).
- **Prototype smoke** (dev): 52/52. New checks cover:
  - one primary button;
  - empty-plan state;
  - feasibility texts, including budget 50 infeasible and no-room;
  - keyboard Enter to add;
  - the flow indicator;
  - the review dialog (focus, totals, caveats, reorder, Escape keeps the
    draft);
  - create;
  - the budget locked after creation.
- **`npm run check`:** passes.

### Bugs and rework

1. **Escape did not close the review.** After a reorder, the moved row lost
   focus (React moves the DOM node), so the dialog's own key handler never
   ran. The dialog now listens on `window` while open.
2. **The budget value wrapped onto two lines** at the fixed width; it is now
   `nowrap`.
3. **Two smoke checks referred to removed elements** (the Level-2 resources
   row; card-body click selection). Updated.

---

## MG-2: Mission Glass EVA glance HUD

- **Started:** 2026-11-05T22:57:15Z.
- **Completed:** 2026-11-05T23:01:20Z, at commit, on `mg-refinement`.
- **Wall-clock elapsed:** 4 min 5 s.
  - No subagents were used.
  - No human intervention.

### Files changed

- `src/components/prototype/EvaHud.tsx`: rewritten around the glance order.
- `src/components/prototype/MissionGlass.tsx`: the HUD wiring, plus an
  interim replan overlay at the top of the HUD (replaced in MG-3).
- `scripts/smoke-mission-glass.mjs`: EVA section rewritten.

### Interaction changes

- **Primary view, in order:**
  1. the current action, with an always-visible "Priority #N · provisional,
     not validated" chip;
  2. the current step in 34 px type, with a step progress bar and a "Then:
     …" preview;
  3. **one** primary button, at least 64 px tall, that names the step
     ("Start action", "Complete step 2", "Finish action"). It receives focus
     on entry and after each step, so Enter advances;
  4. essential constraints: Available / This action / Plan left, with
     "Committed so far … costs ahead are estimates";
  5. a brief segmented mission progress bar.
- **Secondary information is behind controls:** "More" (skip, why this
  action), plus toggles for Map, Caveats (3), Scenario controls and Log.
  Only one optional panel is open at a time.
- **Always visible:** "← Planning", and the label "SIMULATED EVA · training
  prototype, not flight software or real telemetry".

### Tests

- **Prototype smoke** (dev): 61/61. New MG-2 checks cover:
  - the label;
  - the current action and the uncertainty chip;
  - a single primary button, focused on entry;
  - secondary panels hidden by default and opened on demand;
  - constraints, with committed vs estimated effort;
  - keyboard Enter to start and to complete steps;
  - completed and pending step states;
  - the named primary button and next-step preview;
  - step font ≥ 32 px and primary control ≥ 56 px;
  - step, primary and constraints visible without scrolling at 1440×900 and
    1280×800;
  - progress and the route back;
  - map, caveats and More on demand.
- **Unit:** 196/196. **`npm run check`:** passes.

### Bugs and rework

1. **The primary button sat at the bottom of a tall card, far from its
   step.** It now sits directly under the step, and the card no longer
   stretches.
2. **The old EVA smoke checks expected an always-visible map, warnings and
   events.** They were rewritten to open the optional panels first.

## MG-3: Mission Glass replanning (constraint changed → impact → compare → confirm or retain)

- **Started:** 2026-11-05T23:01:54Z.
- **Completed:** 2026-11-05T23:13:44Z, at commit, on `mg-refinement`.
- **Wall-clock elapsed:** 11 min 50 s.
  - No subagents were used.
  - No human intervention.

### Files changed

- `src/lib/prototype/mission-glass.ts`:
  - `ReplanProposal` and `buildProposal`;
  - new state fields `retained`, `previous` and `notice`;
  - rewritten `constraint-event`, `accept-replan` and `keep-plan`;
  - new `undo-replan` and `dismiss-notice`;
  - progress actions clear the undo snapshot.
- `src/components/prototype/ReplanDialog.tsx` (new): the replanning alert
  dialog.
- `src/components/prototype/EvaHud.tsx`: the retained-infeasible warning,
  the notice with Undo, and focus returning to the primary action after a
  decision.
- `src/components/prototype/MissionGlass.tsx`: `checkConstraints` (the
  engine at the newly available effort) replaces the interim MG-2 overlay.
- `src/lib/prototype/mission-glass.test.ts`: the replanning tests rewritten
  and extended.
- `scripts/smoke-mission-glass.mjs`:
  - the replanning section rewritten;
  - repeated translation passes;
  - a reduced-motion check;
  - the no-feasible sequence on a phone viewport.
- `docs/MISSION_GLASS_PROTOTYPE.md`: updated for MG-1 to MG-3.
- `docs/MG_USABILITY_TEST.md` (new): the manual protocol.

### Interaction changes

- **Constraint changed.** A scenario event opens a modal alert dialog fixed
  in the viewport. Its decision footer is always visible, also on a phone,
  where the body scrolls. It shows:
  - the trigger, "Constraint changed · Available effort drops to 50 points
    (scenario event)";
  - a heading for the situation ("Your plan no longer fits", "No remaining
    action fits" or "The suggested order changed").
- **Explain impact.**
  - Committed (spent), Available now (budget − committed) and Remaining plan
    (estimated) are shown separately.
  - Each action in the plan gets a verdict (Done · kept / Still fits / No
    longer fits / Too large now) and a sentence, e.g. "Needs 55 pts, more
    than the 50 pts now available." An in-progress action says "In
    progress, 1 of 4 steps done; those steps are kept."
- **Compare options.**
  - **Suggested:** the remaining actions only, in the engine's provisional
    order, with the total and the actions that would be marked skipped.
    Labelled "provisional, not scientifically validated".
  - **Keep current plan,** labelled "Infeasible: needs 95 pts, 45 more than
    available" when it does not fit.
- **Confirm or retain.**
  - "Use suggested plan" (or "End remaining work" when nothing fits) and
    "Keep current plan (anyway)".
  - Escape does not dismiss the dialog without a decision, and Tab stays
    inside it.
- **After the decision:**
  - **Accept:** completed actions and in-progress steps are kept, and dropped
    actions are marked skipped, not deleted. A notice offers Undo until the
    mission moves on.
  - **Keep, when the plan is infeasible:** a persistent warning ("You kept a
    plan that exceeds the available effort by 45 pts…") with "Review
    replanning".
  - **Constraint change that still fits:** a notice instead of a dialog.
  - Focus returns to the primary action.

### Tests

- **Unit:** 201/201 (+5).
  - There are 16 prototype tests.
  - The MG-3 tests cover:
    - the proposal contents (committed vs estimated);
    - verdicts and plain-language explanations;
    - preserving done actions and in-progress steps;
    - keep → retained;
    - accept → undo, including restoring an infeasible plan;
    - undo cleared after progress;
    - a later fitting check that clears the warning;
    - "no longer fits because of the actions before it";
    - no-feasible → end remaining work.
- **Prototype smoke:** 79/79 against `next start` (+18 since MG-2). The new
  checks cover:
  - the dialog and both decisions in the viewport;
  - focus and `alertdialog`;
  - the trigger;
  - committed vs estimated;
  - named affected actions;
  - the options;
  - Escape and Tab containment;
  - keep → warning, with focus back on the primary;
  - Review replanning;
  - accept, with steps kept;
  - the Undo notice;
  - undo → warning again;
  - the "still fits" notice and its dismissal;
  - repeated translation passes through keep, review, accept and undo;
  - reduced motion (no `mg-rise` animation, 0 ms transitions);
  - the phone EVA fitting the viewport;
  - on the phone: the no-feasible state (committed 40, available 10), the
    decision on screen without overflow, and ending the remaining work.
- **Main app smoke (BR-2):** 116/116 with `SMOKE_LIVE=1`.
- **`npm run check`:** passes.
- **Engine, evidence, geo, briefing and mission code and data:** 0 lines of
  diff against the prototype base `323622c`.

### Bugs and rework

1. **On a phone, the two decision buttons wrapped unevenly.** They now stack
   full-width, with the primary on top.
2. **In the no-feasible state, the reason repeated the heading.** It now
   gives the numbers ("Only 10 pts are left after 40 pts committed; the
   remaining plan needs 55 pts.").
3. **"Core no longer fit"** is now singular or plural, as needed.

### Remaining UX risks (not tested with users)

- **The dialog is information-dense.** It has five sections, and the 30 s
  replanning target may still be missed on a first encounter.
- **On a phone,** the "Keep current plan" details are below the first
  screen of the dialog body.
- **The retained warning, the notice and the timeline push the EVA card
  down.** At 1440×900 the primary stays visible, but on short screens with
  both banners it may not.
- **"Skipped" is used both for user skips and for actions dropped by a
  replan.** Users may not tell them apart.
- **Escape does nothing in the dialog.** This is deliberate, but some
  keyboard users may expect it to close.

## MAP-0: integration (Mission Glass as the default entry point; merge into main)

- **Context:** the user accepted MG-1 to MG-3 in manual review (Planning,
  EVA HUD, Replanning and Recovery: PASS).
- **Started:** 2026-11-05T23:35:41Z.
- **Integration commit:** 2026-11-05T23:41:29Z, on `mg-refinement`, then merged into
  `main` with `--no-ff`. The merge commit's time is in git.
- **Wall-clock elapsed to the integration commit:** 5 min 48 s.
  - No subagents were used.
  - No human intervention.

### Upstream check

Every local branch is an ancestor of `mg-refinement`, so all upstream
features are included:
- `main` (`80e54d0`);
- M3, UX-0, RI-1, UX-1;
- map-first assessment, MF-0, MF-1;
- product value spike, BR-1, BR-2;
- the Mission Glass prototype and MG-1 to MG-3.

The one exception is `m2-vertical-slice` (2 commits). Its tree is identical
to `main`'s squashed M2 commit `05cafae`, so no content is missing.

### Changes

- **`/`** is now Mission Glass (`src/app/page.tsx`).
- **The research workspace** (BR-2 briefings, plus the advanced ranking
  workspace) moved unchanged to **`/research`** (`src/app/research/page.tsx`).
  Each app links to the other: "Research" in the Mission Glass header,
  "← Mission Glass" in the research header. Nothing is duplicated.
- **`/mission-glass`** redirects (307) to `/`, via `next.config.ts`.
- **`npm run typecheck`** is now `next typegen && tsc --noEmit`. See issue 2.
- **Smoke tests:**
  - the research smoke now targets `/research`, and its header check
    includes the link back;
  - the Mission Glass smoke targets `/`, with 3 new routing checks.
- **Docs:** README (routes table, scripts), `CLAUDE.md`,
  `docs/MISSION_GLASS_PROTOTYPE.md` and `docs/MG_USABILITY_TEST.md`.

### Verification (production build, `next start`)

- **`npm run check`:** passes. 201/201 unit tests; the routes are `/`,
  `/research` and `/_not-found`, all static.
- **Smoke tests:**
  - Mission Glass: 82/82;
  - research workspace: 116/116 with `SMOKE_LIVE=1` (tiles loaded 4,
    failed 0).
- **Data verifiers:**
  - `verify:citations`: 129 quotes, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:briefing`: 35 location checks, 0 problems.
- **Engine, evidence, geo, briefing and mission code and data:** unchanged.

### Integration issues

1. **After the route move, stale generated route types in `.next` broke
   `tsc` locally.** Regenerating them fixed it. This affects only an
   existing local build directory.
2. **On a fresh clone, `npm run check` failed at typecheck (pre-existing,
   not caused by MAP-0).** `tsc` needs Next's generated `LayoutProps` type,
   which only `next build` produced, and the build runs after typecheck.
   This was verified on a clean worktree of `88b9f75`. `typecheck` now
   runs `next typegen` first; the clean worktree then passes.
3. **Old links to `/mission-glass` still work** through the redirect.

## MAP-1: interactive spatial decision map

- **Branch:** `map1-spatial-decision-map`, created from `main` at
  `f4724c7`. Not merged.
- **Started:** 2026-11-05T23:41:53Z.
- **Completed:** 2026-11-06T00:05:53Z, at commit.
- **Wall-clock elapsed:** 24 min 0 s.
  - No subagents were used.
  - No human intervention.

### Files changed

- `src/lib/prototype/target-markers.ts` (new, pure): `targetMarkers`, the
  per-target rank, feasibility, plan tone, badge, status and plain-language
  text. It is derived only from the engine's task views and the shared
  mission state.
- `src/lib/prototype/target-markers.test.ts` (new, 5 tests).
- `src/lib/prototype/mission-glass.ts`:
  - the draft is frozen once a plan exists (`toggle-draft`, `move-draft`
    and `use-suggested` become no-ops);
  - `addability` no longer says "only -45 pts left".
- `src/components/map/MarsMap.tsx`:
  - `SimTarget` decision props (badge, status, tone) drawn on the
    simulated layer;
  - a selection outline with a 180 ms grow-in;
  - `focusRequest` and `focusPadding` (a 280 ms centring transition with
    the zoom clamped);
  - `simLabels`, `ariaLabel`;
  - reduced-motion handling;
  - `data-sim-markers`, `data-selected-id` and `data-motion` test hooks.
- `src/components/prototype/TargetMapOverlay.tsx` (new): `TargetList`
  (target buttons over the map) and `TargetSummary`.
- `src/components/prototype/MissionGlass.tsx`:
  - markers;
  - focus on card or button selection;
  - the summary and the verified popover placement;
  - one decision context once a plan exists;
  - read-only cards once a plan exists;
  - legend lines.
- `src/components/prototype/TaskCard.tsx`:
  - a `locked` state;
  - auto-scroll only inside a list that scrolls on its own.
- `scripts/smoke-mission-glass.mjs`: the MAP-1 section, reduced-motion and
  narrow-screen map checks, and translation through the target buttons and
  summary.
- `docs/MISSION_GLASS_PROTOTYPE.md`: a "Spatial decision map" section.
- `docs/MAP1_USABILITY_TEST.md` (new).

### Tests

- **Unit:** 207/207 (+6).
  - The 5 marker tests cover:
    - rank and feasibility equal the engine's at budgets 100, 50, 30 and 0;
    - order and provisional wording;
    - the budget change;
    - added, planned, active and done states;
    - done kept and dropped work skipped after replanning.
  - The other new test checks that the draft is frozen once a plan exists.
  - The negative-left wording is now asserted in an existing test.
- **Prototype smoke:** 101/101 against `next start`, in two consecutive
  runs; +19 checks. They cover:
  - markers matching the card ranks;
  - ranks only on simulated targets, labelled provisional;
  - accessible names;
  - card → select and focus, centred in the visible area within 30 px;
  - the summary contents;
  - single selection;
  - zoom clamp after zooming out and in;
  - Enter, Space and Tab on the target buttons;
  - map click → task;
  - summary → Level 2 and Level 3, and closing the summary;
  - budget 50 updating markers consistently;
  - added → planned, with cards read-only;
  - the EVA map showing active, then done;
  - after replanning: done kept, skipped and not feasible, with cards agreeing;
  - no page errors;
  - reduced-motion focus without a transition;
  - phone: target buttons on the map, summary below it, no page scroll.

  The translation run now also exercises the target buttons and the summary.
- **Main app smoke (`/research`):** 116/116 with `SMOKE_LIVE=1`.
- **`npm run check`:** passes.
- **Engine, evidence, geo, briefing and mission code and data:** 0 lines of
  diff against `main`.

### Bugs and rework

1. **Planning cards showed stale draft arithmetic once a plan existed.**
   After a replan they read "only -45 pts left" and "now 45 pts over budget"
   for actions that were done or skipped. This dates from MG-1/MG-3 and was
   found with the new map. Once a plan exists, the cards and the map now use
   one decision context (budget − committed) and show plan state.
2. **The target summary covered the OpenLayers zoom-out button.** It moved
   right of the zoom controls, and the focus padding follows.
3. **On phones, selecting a target scrolled the page away from the map.**
   This came from the MG-1 card auto-scroll. The summary now sits below the
   map, and the card scrolls only inside its own list.
4. **Labels overlapped in the small EVA map,** a known gap that the status
   lines made worse. Only the current target is labelled there.
5. **The selected target button's ring was hidden** by the glass
   `box-shadow`. It is now an outline.
6. **Smoke timing:**
   - the map's extent attribute changes only at the end of a move, so the
     wait helper now outlasts the focus transition;
   - an older Lefroy Bay click check now waits for the map to settle after a
     card selection;
   - the zoom-clamp check was corrected after the view hit the map's own
     maximum zoom.
7. **An `npx prettier` call reformatted `TaskCard.tsx`.** The project does
   not use Prettier, so the file was restored and only the intended edits
   were reapplied.

### Limitations

- **No routes, travel times, terrain or 3D** (out of scope). The distance
  shown is straight-line scenario geometry.
- **Map labels sit close together:** the three targets are 100–250 m apart,
  so labels can sit close together at the default zoom.
- **Canvas markers are not themselves accessible.** The target buttons and
  the summary are the accessible path.
- **Not tested with users or screen readers.** See
  `docs/MAP1_USABILITY_TEST.md`.

## Phase A: MAP-1 integration into main

- **Context:** the user approved MAP-1 for integration. Manual acceptance:
  - Task location: PARTIAL PASS.
  - Dynamic priorities, Execution states and Map decision value: PASS.
- **Started:** 2026-11-06T04:18:51Z.
- **Merged:** 2026-11-06T04:25:44Z (merge commit `d163d4a`, `--no-ff`, pushed).
- **Wall-clock elapsed:** 6 min 53 s.
  - No subagents were used.
  - No human intervention.

### Verification

- **History:** `map1-spatial-decision-map` was `main` (`f4724c7`) plus two
  commits, and the local branch equalled `origin`.
- **Unchanged against `main`** (0 lines of diff):
  - engine, evidence, geo, briefing and mission code and data;
  - the review registry: 50 pending, 0 approved.
- **`npm run check`:** passes, 207/207 unit tests, production build.
- **Data verifiers:**
  - `verify:citations`: 129 quotes, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:briefing`: 35 location checks, 0 problems.
- **Research smoke** (`next start`, `SMOKE_LIVE=1`): 116/116.
- **Prototype smoke:** 101/101 in three consecutive runs, after the fix
  below.
- **The merged tree** is identical to the verified branch tree.

### Issue found and fixed before merging

- **"MG-2: map opens on demand" was flaky,** failing 2 of 3 runs. It read
  the HUD map's canvas immediately after opening the Map panel, but the map
  is loaded client-side only and mounts 12–28 ms later. The check now waits
  for the canvas, up to 10 s, and reports the time. The change is test-only:
  commit `f87759d`, on the MAP-1 branch before the merge.

## EVA-1: individual step management

- **Branch:** `eva1-step-management`, created from `main` at `d163d4a`.
  Not merged.
- **Started:** 2026-11-06T04:27:13Z.
- **Completed:** 2026-11-06T04:39:51Z, at commit.
- **Wall-clock elapsed:** 12 min 38 s.
  - No subagents were used.
  - No human intervention.
- **Scope:** a simulated training workflow, not a certified EVA procedure
  system. The HUD changes step **states** only; it never edits the
  procedure.

### Files changed

- `src/lib/prototype/mission-glass.ts`:
  - `StepRecord`; `PlanItem.steps`, `paused` and `dropped`;
  - `stepRecords` and `stepCounts`;
  - the `complete-step` (with index), `skip-step`, `pause-step`,
    `resume-step`, `set-step-note` and `undo-step` actions;
  - `skip-task` with a reason;
  - one-level `stepUndo`;
  - replan-dropped actions marked `{by: "replan"}`;
  - impact texts with step counts, paused state, and skipped-by-you vs
    dropped-by-replan.
- `src/lib/prototype/target-markers.ts`: "skipped" vs "dropped by replan",
  "paused", and step counts in marker text.
- `src/components/prototype/StepControls.tsx` (new): `StepForm` (reason or
  note; Enter submits, Escape cancels) and `StepsPanel`.
- `src/components/prototype/EvaHud.tsx`:
  - Pause, and Resume as the primary while paused;
  - More (skip step, note, all steps, skip action);
  - the inline form and the Steps panel;
  - step counts, and a step bar with done, skipped, current and paused;
  - a step Undo in the notice;
  - timeline and plan-summary labels for skipped vs dropped.
- `src/components/prototype/MissionGlass.tsx`: wiring.
- `src/components/prototype/ReplanDialog.tsx` and the accept notice:
  "dropped by this replan" wording.
- **Tests:**
  - `src/lib/prototype/eva-steps.test.ts` (new, 12 tests);
  - `mission-glass.test.ts` and `target-markers.test.ts` updated and
    extended;
  - `scripts/smoke-mission-glass.mjs`.
- **Docs:** `docs/MISSION_GLASS_PROTOTYPE.md` and the new
  `docs/EVA1_MANUAL_TEST.md`.

### Tests

- **Unit:** 220/220 (+13). The 12 EVA-1 state-transition tests cover:
  - completing the current step and any single step out of order;
  - a skip reason being required, trimmed and capped;
  - no change to a resolved, paused or out-of-range step;
  - pause and resume;
  - notes (trimmed, capped, cleared, no effect on state or effort);
  - completion with skipped steps committing effort;
  - every step skipped meaning the action was skipped by the user, with no
    effort;
  - Undo, including an un-committed completion, and Undo being one level
    only;
  - Undo cleared by the next action or a constraint change;
  - the procedure never extended.

  Replan regressions:
  - step records, pause and notes kept through accept and undo;
  - manual skip vs replan drop in later impacts;
  - step and replan Undo never mixing.

  There is also one new marker test (manual skip with a reason, and
  paused).
- **Prototype smoke:** 115/115 against `next start`, in two consecutive
  runs (+14). The checks cover:
  - Enter completing the focused primary;
  - keyboard-only skip (More → Skip step → reason), with an empty reason
    refused;
  - recorded reason, focus back on the primary, and the procedure-lock
    text;
  - pause blocking step changes, and keyboard Resume;
  - notes;
  - an out-of-order step and Undo;
  - the replan impact and kept steps and notes;
  - the dropped-by-replan label, with step Undo giving way to replan Undo;
  - committed vs estimated effort before, after and on Undo of a
    completion (50/40 → 10/0 → 50/40);
  - a manual skip vs a replan drop in the HUD and on the map;
  - no page errors;
  - on a phone, primary and Pause on screen and the form and panel without
    overflow.

  Translation now covers pause, note and undo. Three earlier checks were
  updated for the new "dropped by replan" wording.
- **Research smoke:** 116/116 with `SMOKE_LIVE=1`.
- **`npm run check`:** passes.
- **Engine, evidence, geo, briefing, mission, data and review registry:** 0
  lines of diff against `main`.

### Bugs and rework

1. **After the new distinction, the replan notice and dialog still said
   "skipped" for dropped actions.** They now say "dropped by replan" /
   "Dropped by this replan", and the unit and smoke expectations were
   updated.

### Limitations

- **Procedure changes are not implemented:** the HUD states that they need
  a separate planning confirmation.
- **Per-step effort is not modelled** (no source for it). An action's whole
  simulated cost is committed when it completes, even with skipped steps.
- **Undo is one level, and only for the latest step change.**
- **Notes live in memory only,** like the rest of the mission state, and
  are reset on reload.
- **Not tested with users or screen readers.** See
  `docs/EVA1_MANUAL_TEST.md`.

## EVA-1.1: two P0 interaction fixes (details collapse, step correction)

- **Branch:** `eva1.1-p0-fixes`, created from `eva1-step-management`
  (`3d88a87`). Not merged.
- **Started:** 2026-11-06T04:50:32Z.
- **Completed:** 2026-11-06T05:09:12Z, at commit.
- **Wall-clock elapsed:** 18 min 40 s.
  - No subagents were used.
  - No human intervention.

### Bug 1: details could not be collapsed. Root causes, found by reproduction

The card's own Details/Hide details toggle and the EVA panel chips toggled
correctly in every reproduction:
- 1440, 1366, 1280, 1024 and 390 px;
- mouse and keyboard;
- simulated browser translation.

The defects were in the other paths:
1. **Open-only handlers.** Each set "open" instead of toggling, so the
   control the user had just used could not close what it opened. Its label
   and `aria-expanded` never changed.
   - The map summary's Details (`setExpanded(taskId)`).
   - EVA More → "All steps…" (`setPanel("steps")`).
   - The header Evidence button and More → "Why this action?"
     (`setEvidenceFor(id)`).
2. **The evidence sheet covered its own opener.** It was fixed at
   `top: 12px` over the header. Playwright confirmed that clicks on the
   Evidence button were intercepted by the sheet.
3. **The sheet's Escape handler was on the sheet element.** After any click
   outside, Escape did nothing; this was reproduced at 1366 and 1024 px.
4. **Expanded content had no collapse control of its own.** The only close
   was the toggle above it, which scrolls away in the right column.

**Fixes:**
- All open-only handlers now toggle, with `aria-expanded` and a changing
  label.
- The sheet starts below the header on wide screens; Escape is handled on
  `window` while it is open; focus returns to the opener.
- Every expanded EVA panel has Collapse, which returns focus to its toggle;
  the card's details end with "Hide details ▴".
- Closing changes no mission state; a smoke check compares the step,
  counts, effort and timeline before and after.

### Bug 2: completed steps could not be corrected

- **Cause:** there was no state transition from done back to not done. Only
  the one-level Undo could revert the latest change, and steps of a
  completed action were not reachable in the HUD.
- **New `reopen-step` action:**
  - It covers a done or skipped step of the action in progress or of a
    completed action.
  - The note is kept, and a skip reason becomes `previousReason`.
  - The current step becomes the first unresolved one.
  - A completed action returns to in progress and its committed effort is
    released, because committed effort is derived from done actions. This
    rules out double-charging or a wrong refund: completing again commits
    it once.
  - An action in progress at that moment is set aside (planned again, steps
    kept).
  - Replan decisions are unchanged, and Undo reverts a reopen.
- **`reopenEffects`** explains all of this for a confirmation, and flags
  plan or effort changes.
- **Navigation vs reopening:**
  - ‹ › browse steps read-only, clearly labelled, with "Back to current step"
    as the primary action.
  - Reopening is a separate, confirmed action: from the viewed step, or
    "Reopen…" in the Steps panel. The panel can show a completed action's
    steps.

### Tests

- **Unit:** 228/228 (+8 in `eva-reopen.test.ts`):
  - reopen step 2;
  - reopen step 2 after steps 2 and 3;
  - reopen the final step of a completed action (effort 40 → 0 → 40, no
    double charge);
  - notes and skip reasons kept;
  - the effects text;
  - the set-aside action continuing where it was;
  - no-ops (todo step, planned or skipped action);
  - Undo and replanning interplay.
- **Prototype smoke:** 128/128 against `next start`, in two consecutive
  runs (+13). The checks cover:
  - card Details ×3 cycles, the bottom collapse and the keyboard;
  - the summary's Details toggle;
  - every EVA panel collapsing ×3 from inside, with focus back on its
    toggle;
  - More → All steps toggling;
  - the evidence header toggle, and Escape with focus outside, with focus
    returning;
  - state unchanged after closing;
  - tests 2–7 as listed in the task (reopen step 2; steps 2+3 then reopen 2
    by keyboard via read-only navigation; reopening the final step after
    completion; progress, remaining work, committed vs estimated; Undo and
    replanning).
  - phone: confirmation fits, reopen works, panel collapse;
  - translation: reopen, view, collapse and the evidence toggle under
    simulated translation.
- **Research smoke:** 116/116 with `SMOKE_LIVE=1`.
- **`npm run check`:** passes.
- **Engine, evidence, scenario task definitions, geo and review registry:**
  0 lines of diff against `main`.

### Rework

- **The Steps panel's action picker shows only when more than one action
  has steps.** The smoke test now clicks it only when present.
- **The Collapse button wrapped next to long panel titles.** It no longer
  wraps.

### Limitations

- **I could not reproduce a toggle that fails by itself.** The fixes target
  the open-only paths, the covered opener, Escape scope and the missing
  in-panel control. If the user's case differs, exact steps (screen size,
  browser, translation on or off) are needed.
- **Reopening a completed action does not re-check feasibility or trigger a
  replan.** Committed effort is released and shown, and replan decisions
  stand.
- **Notes can be edited only on the action in progress.**
- **Not tested with users or screen readers.**

## EVA-1.2 (Track A): explicit step skipping, completed-action correction

- **Context:** manual acceptance of EVA-1.1 gave Details open/close PASS,
  Step correction PASS, and Completed action correction PARTIAL PASS. The
  user asked why a specific step cannot be skipped.
- **Branch:** `eva1.2-step-skip-correction`, created from `eva1.1-p0-fixes`
  (`31c83ef`). Not merged; EVA-1.1 is not merged either.
- **Started:** 2026-11-06T05:53:06Z.
- **Completed:** 2026-11-06T06:09:53Z, at commit.
- **Wall-clock elapsed:** 16 min 47 s.
  - No subagents were used.
  - No human intervention.

### Why the user could not find "skip a step"

EVA-1 put "Skip step N…" under the **More ▾** menu, next to "Skip this
action". The visible controls were only Complete and Pause.

### Implemented

- **Skip step:**
  - a visible "Skip step N…" beside the primary action, reached by keyboard
    with one Tab;
  - the form states "recorded as skipped, not done: its measurement is not
    made" and requires a reason;
  - a neutral caution when later steps are unfinished ("may rely on…; this
    scenario has no step-dependency data"), kept on the following step;
  - the reason can be corrected ("Edit reason…") or the step reopened.
- **Execution vs accounting:**
  - An ended action is **complete** or **partial** (skipped steps, so those
    measurements were not made). This is shown in the notice, timeline, map
    (½, "done · partial"), cards and Steps panel.
  - The accounting assumption (whole simulated cost committed when the
    action ends; no per-step costs) is stated separately in the HUD.
- **Completed-action correction:**
  - The reopen confirmation separates Execution, Simulated effort
    accounting and Feasibility after reopening.
  - Steps keep a `history` of earlier states and reasons; notes are kept.
  - After confirmation, a new `recheck` runs the existing engine at the
    available effort. If the plan still fits, a notice says so and Undo is
    kept. If not, or if the order changed, the replanning dialog opens.
  - Committed effort stays derived from ended actions: no double counting,
    no per-step refunds.

### Tests

- **Unit:** 236/236 (+8 in `eva-skip-correction.test.ts`):
  - skip and continue, with the caution text;
  - the caution only when later steps are unfinished;
  - partial vs complete outcome, effort committed once, and the map badge
    and status;
  - correcting a reason (non-empty), with Undo;
  - reopening a skipped step (history keeps the reason);
  - separate execution and accounting explanations for a partial action;
  - recheck that still fits (notice, Undo kept);
  - recheck that no longer fits (replan proposal).

  Updated for the new wording and structure: `eva-steps` (partial notice)
  and `eva-reopen` (sections, history).
- **Prototype smoke:** 139/139 against `next start` (+11). The checks
  cover:
  - visible Skip, reachable by keyboard, with the "skipped ≠ done" text and
    the caution;
  - continuing to the next step, with the caution kept;
  - correcting a reason;
  - a partial ending with the accounting note (60 left);
  - the three-section reopen confirmation, on screen and not covered;
  - re-check notice, history and released effort;
  - complete after re-completion, with effort counted once;
  - a reopen that makes the plan infeasible opening the replanning dialog;
  - accept → dropped, then Undo restores;
  - no page errors.

  Translation now also covers the visible skip, correcting a reason and
  reopening; the phone check uses the visible Skip button. Earlier
  keyboard and phone checks were updated to the new path.
- **Research smoke:** 116/116 with `SMOKE_LIVE=1`.
- **`npm run check`:** passes.
- **Scoring engine, evidence, scenario tasks, geo and review registry:** 0
  lines of diff against `main`.

### Rework

1. **The long reopen confirmation ran below the fold at 1440×900.** The wide
   layout does not scroll the page, so its button was unreachable by mouse
   (the smoke had passed only because Playwright scrolls programmatically).
   The current-action card now scrolls on wide screens, forms and
   confirmations scroll themselves into view, and a new check verifies the
   button is on screen and not covered.
2. **The partial badge "◐" rendered as an unreadable glyph** on the map and
   the target button. It is now "½", which is also in the legend.

### Known limitations

- **No step-dependency data exists,** so the caution is generic.
- **Per-step effort is not modelled:** a partial action commits its whole
  simulated cost. This is stated as an assumption.
- **Notes and reasons can be edited only on the action in progress.**
- **Not tested with users or screen readers.**

## EVA-1.3 (Track A): direct, discoverable past-step correction

- **Context:** manual acceptance of EVA-1.2 gave Skip and partial
  completion PARTIAL PASS, Reopen and replanning PASS. The user said: "I can
  skip steps now, but I still cannot easily go back and edit an earlier
  completed subtask."
- **Branch:** `eva1.3-direct-step-correction`, created from
  `eva1.2-step-skip-correction` (`b481fa9`). Not merged.
- **Started:** 2026-11-06T17:12:08Z.
- **Completed:** 2026-11-06T17:24:47Z, at commit.
- **Wall-clock elapsed:** 12 min 39 s.
  - No subagents were used.
  - No human intervention.

### Why it was hard

- Completed steps and their Reopen controls lived in an optional
  right-column "Steps" panel. It started collapsed, among Map, Caveats and
  Log, and on a phone it sat far below the action.
- Reopening inside the current action always needed a confirmation, even
  though it changed no effort.

### Changes

- **An always-visible step checklist** in the current-action card, with a
  visible **Reopen** beside every done or skipped step. It also offers
  Mark done, Skip…, Note… and Edit reason…, plus the action picker for
  completed actions.
- **Clicking a step only views it** (read-only, "Back to current step").
  Reopen is the only control that changes completion status.
- **Reopen inside the action in progress is immediate,** with an explanatory
  notice and Undo. Reopening a completed action keeps the EVA-1.2
  confirmation and feasibility re-check.
- **The duplicate Steps panel toggle and More → "All steps…" are removed.**
  On phones, row buttons sit on their own line.
- **Unchanged:** the procedure, the engine, effort accounting and
  replanning.

### Tests

- **Unit:** 238/238 (+2). The exact journey: complete step 2 → on step 3 →
  reopen step 2 (note and history kept, effort unchanged) → complete it
  again → back on step 3 → the action ends with effort committed once. Plus
  the "later done steps stay done" notice.
- **Prototype smoke:** 142/142 against `next start`, in two consecutive
  runs.
  - **New:** the browser journey, including the visible Reopen on step 3,
    viewing that changes nothing, then reopen, continue and complete again
    with effort unchanged and history kept.
  - **Updated:** the EVA-1 and EVA-1.1 checks, for the always-visible
    checklist, immediate reopen with Undo, and phone and translation.
- **Research smoke:** 116/116.
- **Data verifiers:**
  - `verify:citations`: 129 quotes, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:briefing`: 35 location checks, 0 problems.
- **`npm run check`:** passes.
- **Engine and data:** 0 lines of diff against `main`.

### Rework

- **On phones, the row buttons squeezed the step labels** into four-line
  wraps and overlapped "To do". They now wrap below the label.

### Limitations

- **The checklist lengthens the action card.** At 1440×900 the primary
  action stays in place and the card scrolls.
- **Undo is still one level.**
- **Not tested with users.**

## MAP-3A (Track B): real CTX local 3D terrain

- **Branch:** `map3a-ctx-3d-terrain`, created from `main` at `d163d4a`
  (includes MAP-1). Not merged.
- **Started:** 2026-11-06T06:10:06Z.
- **Completed:** 2026-11-06T06:36:42Z, at commit.
- **Wall-clock elapsed:** 26 min 36 s.
  - No subagents were used.
  - No human intervention.
- **Dependency:** `three` 0.186.1, pinned exactly (published 2026-09-24),
  with `@types/three` 0.186.0.

### Implemented

- **Data pipeline** `scripts/build-ctx-terrain.mjs` (`build:terrain`,
  `verify:terrain`):
  - the Trek CTX DTM is downloaded and checked against its recorded
    SHA-256, and its GeoTIFF tags are checked;
  - the corners must reproduce the catalog bbox (error 4 × 10⁻⁸°);
  - a 160 × 160-post crop (≈ 3.0 × 3.2 km) around the Margin sample sites
    and targets, copied unchanged with no no-data;
  - PDS agreement at three sites: −1.7, −3.2 and −2.6 m;
  - the CTX orthomosaic, from 12 Trek z13 tiles, cut to the exact bounds;
  - a shading-based alignment check, with checksums and full metadata.

  `verify:terrain` reproduced the committed assets byte for byte from the
  live sources.
- **`src/lib/terrain`** (pure, Zod): the metadata schema; lon/lat ↔ grid ↔
  local tangent-plane metres; bilinear sampling at post centres; imagery
  UV; 1× default.
- **`src/components/terrain/TerrainViewer`** (three.js, client-only; see
  `docs/TERRAIN_3D.md`):
  - **terrain:** a DTM mesh draped with the ortho;
  - **markers:** cyan verified sites and traverse, coral simulated targets
    with rank and tone; HTML marker labels that select;
  - **camera:** orbit, tilt and zoom, plus buttons and reset;
  - **displays:** source and resolution, the exaggeration (1×, 2×, 3×
    labelled), the elevation under the pointer, and the selected marker's
    DTM elevation with an honest difference from Lefroy Bay;
  - **quality and motion:** a Standard/Low setting (Low by default on narrow
    or low-memory devices); collapsible phone controls; reduced-motion
    handling;
  - **fallback** to 2D, with a reason, when WebGL, the download or the
    checksum fails, or the context is lost; an imagery failure leaves slope
    shading.
- **Mission Glass:** a "2D map | 3D terrain" switch in the map toolbar.
  - The selection is shared both ways.
  - The 2D map stays mounted, so its view is kept.
  - The 3D view fills only the visible map area.
  - The legend shows in 2D only. EVA keeps its 2D minimap.

### Tests

- **Unit:** 217/217 (+10 in `terrain.test.ts`):
  - asset checksums and PNG header;
  - registered sources, resolution, datum and caveats;
  - no no-data, and the min/max;
  - PDS agreement within 5 m, recomputed;
  - catalog georeferencing, and alignment within 2 posts;
  - every site and target inside the crop;
  - grid round trips and crop corners;
  - local distances against great-circle distances (within 0.2 %), and the
    scenario's target distances;
  - UV against the grid (< 1 cm);
  - the 1× default.
- **Prototype smoke:** 113/113 against `next start`, in two consecutive
  runs (+12). The checks cover:
  - WebGL rendering (a canvas pixel-spread check), ready in about 1.9 s;
  - source, resolution and 1×, and the "not a route or traversability
    model" text;
  - distinct verified and simulated markers, with DTM elevations equal to the
    metadata;
  - the 2D selection kept in 3D;
  - a 3D label selecting the task (card and summary);
  - rotate (keyboard), tilt and zoom;
  - exaggeration labelling;
  - the pointer elevation within the DTM range;
  - back to 2D with the 2D view unchanged and the 3D selection shown;
  - no page errors;
  - fallback with a reason when the data is missing or altered (checksum);
  - phone: Low quality, reduced motion, collapsed controls that work, no
    overflow;
  - translation with 3D label selection and an exaggeration change.

  The MAP-1 narrow-screen check now measures the visible toolbar row.
- **Research smoke:** 116/116 with `SMOKE_LIVE=1`.
- **`npm run check`:** passes.
- **Data verifiers:**
  - `verify:citations`: 129 quotes, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:briefing`: 35 location checks, 0 problems.
- **Engine, evidence, geo, briefing, mission, scenario and review registry:**
  0 lines of diff against `main`.

### Rework

1. **The first alignment test** (slope magnitude against image-gradient
   magnitude) peaked weakly at 3 posts. It was replaced by a
   physically-based shading correlation, which peaks within 1 post. Its
   limits are stated in the metadata and docs.
2. **Marker labels of nearby targets overlapped.** Labels are now stacked,
   and the camera comes closer, bounded at 1.4 km, on selection.
3. **"2 m above the Lefroy Bay site"** was shown for a difference smaller
   than the DTM's agreement with PDS. Differences under 5 m are now called
   not meaningful.
4. **Phone:**
   - labels caused a 103 px horizontal overflow; the viewer now clips;
   - the controls and caveats covered the terrain; the controls are now
     collapsible and the notes behind "About this 3D view";
   - the option labels were shortened.
5. **The network-failure reason showed the browser's "Failed to fetch".** It
   now reads in plain language.
6. **A UV test tolerance was tighter than the 1 × 10⁻⁷° rounding of the
   stored bbox** (≈ 6 mm). The tolerance is now 1 cm on the ground.

### Known limitations

- **Resolution:** 20 m posts, roughly 60–100 m effective. No rocks and no
  traversability.
- **Area:** one 3 km crop; HiRISE is not used.
- **Registration:** the shading check does not demonstrate sub-post
  (< 20 m) registration.
- **Lighting:** the light is a depth cue, not the imaging illumination.
- **Test environment:** tested in headless Chromium with software WebGL
  (SwiftShader), not on real mobile GPUs.
- **No user testing yet.**
- **Not yet integrated with EVA-1.x.** A trial merge is reported separately.

### MAP-3A × EVA-1.2 trial integration (local only, not pushed or merged)

- **Started:** 2026-11-06T06:36:53Z.
- **Completed:** 2026-11-06T06:41:34Z.
- **Elapsed:** 4 min 41 s.
- **Method:** `eva1.2-step-skip-correction` (which contains EVA-1 and
  EVA-1.1) was merged into a detached copy of `map3a-ctx-3d-terrain`, as a
  local commit only.
- **Conflicts:** only append-only regions.
  - `DEVELOPMENT_LOG.md`: both sides kept.
  - `scripts/smoke-mission-glass.mjs`: both new sections kept, and one
    translated-check label combined.
- **Merged automatically:** `MissionGlass.tsx` and `TargetMapOverlay.tsx`.
- **Results on the merged tree:**
  - `npm run check` passes, 246/246 unit tests;
  - prototype smoke 151/151 against `next start`, in two consecutive runs;
  - research smoke 116/116 with `SMOKE_LIVE=1`.
- **Conclusion:** the two branches can be integrated without code changes,
  once each is accepted. The final integration still needs its own
  approval.

## MAP-3A.1 (Track B): readable relief from the unchanged CTX DTM

- **Branch:** `map3a1-terrain-readability`, from `map3a-ctx-3d-terrain`
  (`499ac59`). Not merged.
- **Started:** 2026-11-06T17:25:14Z.
- **Completed:** 2026-11-06T17:59:24Z.
- **Elapsed:** 34 min 10 s of wall-clock time, one agent, no parallel work.

### Finding: the relief is real but modest

Measured from the 160 × 160 posts (`reliefSummary`, unit-tested):

- 244 m between the highest and lowest posts, at opposite corners;
- the ground falls about 72 m from the western to the eastern third;
- the median slope is 3.5° over 100 m, with 90 % below 6.5°;
- around Lefroy Bay it varies by about 10 m within 150 m, 22 m within 300 m
  and 74 m within 1 km;
- Comet Geyser → Pelican Point: 1,409 m long, net −40 m.

So the area near the targets is nearly flat at 1×. The viewer now says so
in plain words, instead of adding relief. No elevations were changed,
smoothed or invented: the terrain assets and the build script are
unchanged, and `verify:terrain` still matches a fresh build.

### What changed

- **`src/lib/terrain/terrain.ts`** (pure, unit-tested):
  - `EXAGGERATIONS` is now 1 (default), 3 and 5;
  - `CAMERA_PRESETS`, including two low-angle views (polar 80°);
  - `profileAlong`: bilinear samples every 10 m along a straight line, and
    `null` outside the crop;
  - `reliefSummary`, `localRange`, `reliefStatement` and `reliefHeadline`;
  - `CONTOUR_INTERVAL_M = 10`.
- **`TerrainViewer`:**
  - **Camera presets:** Overview, Oblique, Low from E and Low from S. They
    apply instantly, and any manual move leaves the preset.
  - **Vertical scale:** 1× true scale, 3× and 5×. Both stretched scales are
    labelled "not true scale" in the caution colour.
  - **Shader material**, colours only: relief shading (fixed low sun,
    contrast-enhanced, labelled), elevation colours with a legend, and
    10 m contours drawn from the true elevation attribute.
  - **Local elevation range** within 300 m of the selected marker or Lefroy
    Bay, and the relief statement.
  - **Elevation profile panel:**
    - From/To over all markers, picking two points on the terrain (Esc
      cancels), and swap ends;
    - an amber 3D line, and an SVG chart whose read-out (pointer or keys)
      is marked on the terrain;
    - stats, and the chart's own stretch factor;
    - a chart height of at least 10 m, with sub-5 m changes flagged as not
      meaningful;
    - the label "Straight sampling line: not a route, not a safe path, no
      travel time or traversability."
  - **Phones:**
    - the profile starts collapsed;
    - when open, it replaces the info panel and repeats the 3D scale;
    - the source line is shortened and a short relief headline is shown;
      the full text is under "About this 3D view".
- **Tests:**
  - 5 new terrain unit tests (222 in total);
  - 13 new browser checks for MAP-3A.1, and the MAP-3A exaggeration check
    moved from 2× to 3×;
  - the translation run now covers presets, surface, profile ends, the
    chart keys and the notes.
- **Docs:** `docs/TERRAIN_3D.md` has a new MAP-3A.1 section. `CLAUDE.md`
  terrain rule: 3× and 5× must stay labelled; profiles must say they are
  straight sampling lines.

### Verification (production build, `next start`)

- `npm run check`: lint, typecheck and build pass, with 222/222 unit tests.
- Prototype smoke: 126/126 in two consecutive runs.
- Research smoke: 116/116 with `SMOKE_LIVE=1`.
- Data validators:
  - `verify:citations`: 129 quotes, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:briefing`: 35 checks, 0 problems;
  - `verify:terrain`: the committed assets match a fresh build.
- 0 lines of diff against `map3a-ctx-3d-terrain` in:
  - the engine, evidence, geo, briefing and mission code;
  - `src/data` (including the review registry);
  - `public/terrain` and the build script.

### Rework

1. **Relief statement test:** I had expected a fall of 73 m between the
   thirds; the library computes 72 m. The test now uses the computed value.
2. **`localRange` test:** it compared against the 1 mm-rounded metadata
   range; it now uses a tolerance.
3. **React lint:**
   - refs were declared after the effect that read them;
   - the default profile was set in an effect; it is now derived state;
   - uniforms were assigned inside an effect; this moved to a helper.
4. **First desktop layout:** the controls overlapped the profile and the
   panels covered most of the terrain. There is now one compact controls
   card, a narrower info panel, and notes collapsed by default.
5. **Phone:** the panels covered the map, and the open profile extended
   above the map. Fixed with the phone layout above, bounded below the
   view-controls button.
6. **Read-out dot:** the dot was drawn, but the 48 × 48 downsampled check
   could not see it. The check now counts full-resolution pixels, and the
   dot is drawn on top.
7. **Short profiles:** Target A → Lefroy Bay (163 m, about 3 m of
   variation) filled the auto-scaled chart and looked like a hill. The
   chart now has a minimum 10 m span, and sub-5 m ranges are flagged.
8. **Smoke ordering:** short-profile stats were read after the same-point
   guard had removed the chart.
9. **Stale server:** an older `next-server` from the first production run
   still held port 3000 after the rebuild. It was stopped, and both smoke
   runs were repeated on the final build.

### Known limitations

- **Contrast-enhanced shading:** relief shading makes gentle slopes look
  stronger than plain lighting would. It is labelled, and changes colours
  only.
- **Nearly flat near the targets:** at 1× the terrain around the targets
  still looks nearly flat, correctly. 3D is most informative at 3× or 5×,
  with low angles, contours and the profile.
- **Profile picking** needs a pointer. Keyboard users choose ends from the
  markers.
- **Phone:** when the profile is open, it covers much of the terrain.
- **Same constraints as MAP-3A:** 20 m posts (about 60–100 m effective), one
  3 km crop, software WebGL in tests, and no user testing yet.
- **Not integrated with EVA-1.3**; each branch awaits acceptance.

## Phase A: EVA-1.3 and MAP-3A.1 integration into main

- **Context:** manual acceptance:
  - EVA-1.3 historical step correction: PASS;
  - MAP-3A.1 terrain understanding, elevation profile and 3D usability: PASS.
- **Started:** 2026-11-06T20:41:44Z.
- **Completed:** 2026-11-06T20:50:06Z, at this log commit (pushed right after).
- **Wall-clock elapsed:** 8 min 22 s. One agent, no parallel work, no human
  intervention.

### History

- `main`, `eva1.3-direct-step-correction` and `map3a1-terrain-readability`
  each matched `origin`.
- Both branches fork from `main` at `d163d4a`.
  - The EVA line adds `a7c2c4e` (log), then EVA-1, EVA-1.1, EVA-1.2 and
    EVA-1.3.
  - The terrain line adds MAP-3A, its trial-integration log, and MAP-3A.1.
- **Merges** (`--no-ff`):
  1. `dbab366`: EVA-1 to EVA-1.3 into `main`, with no conflicts.
  2. `551bab1`: MAP-3A and MAP-3A.1 into the result.

### Conflicts

- **`DEVELOPMENT_LOG.md`:** both sides only appended after the common base,
  so all entries of both were kept: five EVA entries, then two MAP-3A
  entries.
- **`scripts/smoke-mission-glass.mjs`:**
  - the EVA-1, 1.1, 1.2 and 1.3 sections and the MAP-3A and MAP-3A.1
    sections were all kept;
  - the translated-run check label was combined.
- **Merged automatically:** `MissionGlass.tsx` and `TargetMapOverlay.tsx`
  (as in the earlier trial integration).

### Verification of the merged tree (production build, `next start`)

- `npm run check`: lint, typecheck and build pass, with 253/253 unit tests
  (EVA 238, plus 15 terrain tests).
- Prototype smoke: 167/167 in two consecutive runs. That is the base's 101
  checks, plus 41 from EVA-1.x and 25 from MAP-3A/3A.1, so no coverage was
  lost.
- Research smoke: 116/116 with `SMOKE_LIVE=1`.
- Data validators:
  - `verify:citations`: 129 quotes, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:briefing`: 35 checks, 0 problems;
  - `verify:terrain`: the committed assets match a fresh build from the
    live sources.
- **Integrity:** 0 lines of diff against `d163d4a` in the engine, evidence,
  geo, briefing and mission code and data. The review registry is 50
  pending, 0 approved. Terrain code and assets are identical to the
  accepted MAP-3A.1 branch; EVA code and data are identical to the accepted
  EVA-1.3 branch.
- **Rework:** none.

## MAP-2: conceptual mission sequence in 2D and 3D

- **Branch:** `map2-spatial-mission-sequence`, created from the integrated
  `main` (`321e4ee`). Not merged; awaiting manual usability acceptance.
- **Started:** 2026-11-06T20:50:13Z.
- **Completed:** 2026-11-06T21:31:47Z, at this commit.
- **Wall-clock elapsed:** 41 min 34 s. One agent, no parallel work, no human
  intervention.

### What it does

- **Sequence model** (`src/lib/prototype/mission-sequence.ts`, pure): derives
  the sequence from the shared mission state, with no new state.
  - Phases: none, draft preview, confirmed.
  - Plan-order numbers, never the engine's rank.
  - Target states: planned, active, done, done-partial, skipped by the user,
    dropped by replan.
  - Connection states, from where each leads: history, current, remaining,
    infeasible.
  - Missing positions become reported gaps, never inferred or bridged.
  - Great-circle straight-line separations on the Mars 2000 sphere.
  - `replanSequences` previews both replan options. It uses
    `itemsAfterReplan`, a pure function extracted unchanged from the
    reducer, so the preview equals the accepted result.
- **2D (OpenLayers):**
  - a sequence layer under the targets: solid or dashed lines, a static
    arrowhead, and "Seq n" / "Draft n" chips;
  - clicking a line selects it, and its ends are ringed;
  - `data-sequence` mirrors what is drawn.
- **3D (three.js):**
  - the same connections as thin tubes on the DTM samples (true elevations,
    shown at the current exaggeration), with direction cones and chips;
  - clicking a tube selects it, and the camera orbits the selected
    connection;
  - the existing profile tool shows that connection;
  - connections outside the crop are neither drawn nor profiled
    (`segmentCoverage`).
- **Planning panel:**
  - "Mission sequence on the map", the keyboard-accessible list of targets
    and connections;
  - a connection summary with plan order, a short explanation, the
    straight-line separation ("not a travel distance") and, in 2D, the
    real-DTM profile (the verified heights are loaded lazily);
  - task cards of the selected connection marked with a dashed outline;
  - the legend and an on-map label, "Conceptual mission sequence — not a
    navigable route".
- **EVA:** the Map panel shows the sequence, with the connection to the
  current action in bold.
- **Replan dialog:** a plan-order diagram for each option.
- **Unchanged:** the ranking formula, evidence, reviews, verified geo
  features and terrain elevations: 0 lines of diff against `main` in the
  engine, evidence, geo, briefing, mission and `src/data`, and in
  `public/terrain` and the terrain build script. The review registry is 50
  pending, 0 approved.

### Verification (production build, `next start`)

- `npm run check`: lint, typecheck and build pass, with 268/268 unit tests
  (+15: 13 sequence tests, 2 terrain-coverage tests).
- Prototype smoke: 186/186 in two consecutive runs (+19 MAP-2 checks, plus
  translation coverage for the list and the connection summary).
- Research smoke: 116/116 with `SMOKE_LIVE=1`.
- Data validators:
  - `verify:citations`: 129 quotes, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:briefing`: 35 checks, 0 problems;
  - `verify:terrain`: the committed assets match a fresh build.

### Rework

1. **Two unit-test expectations were wrong; the code was right.**
   - One plan was over budget (110 of 100 pts).
   - "Keep current" follows the dialog's running fit, so Survey also does not
     fit after Coring.
2. **The 2D connection summary overlapped the legend.** The legend now gives
   way while a connection is open.
3. **In 3D the selected connection was tiny at the default distance.** The
   camera now orbits it, at most 1.1 km away.
4. **On phones, selecting a connection opened the 3D profile over the
   terrain.** The panel now opens automatically only at ≥ 640 px.
5. **3D tubes looked heavy close up.** They were made thinner and the
   selection halo lighter.
6. **On phones, a neighbour's label hid a "Seq" chip in 2D.** Chips now sit
   to the right of the marker.
7. **Replan diagram labels collided with lines.** Labels now sit above the
   nodes.
8. **The test attribute lacked target states.** `data-sequence` nodes now
   carry them.

### Known limitations

- **Untested coverage and gap states:** all three scenario targets are inside
  the DTM crop and have positions. The "outside the crop" and "missing
  position" states are covered by unit tests and code paths, not by a
  browser scenario.
- **Two numbers per target:** the rank in the diamond (MAP-1, unchanged) and
  Seq n (plan order). The legend and list explain both; chips and labels can
  still overlap on the small EVA minimap.
- **"Discard plan" keeps the draft** (existing reducer behaviour), so the
  draft preview returns after the confirmed connections are removed.
- **Mode coverage:** 3D is in planning mode only (as in MAP-3A). The EVA HUD
  shows the 2D sequence, and connection selection is a planning
  interaction.
- **Replanning preview:** the "Keep current" diagram follows the dialog's
  running fit; after keeping, the map marks per-action engine feasibility
  (MAP-1).
- **Test environment:** headless Chromium with software WebGL; no user
  testing yet.

## Phase A: MAP-2 integration into main

- **Context:** manual acceptance: mission plan synchronization, 2D/3D
  synchronization, EVA execution states, replanning synchronization and
  spatial analysis all PASS.
- **Started:** 2026-11-07T00:30:49Z.
- **Completed:** 2026-11-07T00:40:26Z, at this log commit (pushed right after).
- **Wall-clock elapsed:** 9 min 37 s. One agent, no parallel work, no human
  intervention.
- **History:**
  - `map2-spatial-mission-sequence` (`3a161ef`) was `main` (`321e4ee`)
    plus one commit, and both matched `origin`;
  - EVA-1 to EVA-1.3, MAP-3A, MAP-3A.1 and MAP-2 are all ancestors;
  - merge commit `5e5a99d` (`--no-ff`), with no conflicts. The merged tree
    is identical to the accepted branch tree.
- **Verification of the merged tree** (production build, `next start`):
  - `npm run check`: passes, 268/268 unit tests;
  - prototype smoke: 186/186 in two consecutive runs;
  - research smoke: 116/116 with `SMOKE_LIVE=1`;
  - `verify:citations`: 129 quotes, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:briefing`: 35 checks, 0 problems;
  - `verify:terrain`: the assets match a fresh build.
- **Integrity:** 0 lines of diff against `321e4ee` in the engine, evidence,
  geo, briefing and mission code, `src/data` (the review registry is 50
  pending, 0 approved), `public/terrain` and the terrain build script.
  The only non-UI logic change is MAP-2's behaviour-preserving extraction of
  `itemsAfterReplan` in `src/lib/prototype/mission-glass.ts`; all
  replanning tests are unchanged and pass.
- **Rework:** none.

## SCI-0: scenario evidence audit (docs only)

- **Branch:** `sci0-scenario-evidence-audit`, created from `main`
  (`6fd4222`). Docs only; not merged.
- **Started:** 2026-11-07T00:40:42Z.
- **Completed:** 2026-11-07T00:47:14Z, at this commit.
- **Wall-clock elapsed:** 6 min 32 s. One agent, no parallel work, no human
  intervention.
- **Deliverable:** `docs/SCI0_SCENARIO_EVIDENCE_CONTRACT.md` (Scenario
  Evidence Contract, plus a display-safety summary). The R4 row in
  `docs/EVIDENCE_CURATION.md` now points to it.
- **Method:**
  - read the evidence scenario, the review registry, the sources, the
    Lefroy Bay briefing, the geo records, the mission framing, the Mission
    Glass scenario and the rank wording in the UI;
  - ran a read-only probe of the existing engine at 2025-05-06 and
    2023-09-08, at 100 and 50 pts, from a temporary test file deleted
    before commit. `git diff main -- src scripts public` is empty.
- **Main findings:**
  - **The provisional order rests on two inputs only:** AI-drafted, pending
    task–gap links and simulated costs (2025-05-06, 100 pts: Abrade 0.743,
    Core 0.700, Survey 0.671).
  - **The science criteria carry no information:** discrimination and
    priority are Not Evaluated, and evidence quality is identical for all
    three actions.
  - **The lead is fragile:** three unreviewed inputs are each pivotal, and
    at 50 pts Survey and Abrade tie.
  - **The reviewed ranking is unavailable:** 50 relationships are pending.
  - **All three action types repeat operations already performed in the
    unit** (three Margin cores, several abrasions, stand-off analyses).
  - **The targets are scenario-defined points** 118–163 m from the verified
    Lefroy Bay site.
  - **Evidence quality's "best existing support: orbital"** misrepresents
    the present-day dataset.
- **Verification:**
  - `npm run check` passes (268/268 unit tests);
  - no application code, data, review status or formula changed; the
    review registry is 50 pending, 0 approved.
- **Rework:** one wording correction. The draft said the UI states the
  inferred coordinate convention for sample sites; only the 2D map's dashed
  ring and `docs/GEO_DATA.md` were confirmed, so the text now says that.
- **Limitations of the audit:**
  - It used only the dataset's verified sources; no new sources were
    fetched, and R1 and R2 remain blocked.
  - The proposed objective and the SCI-1/SCI-2 recommendations are the
    agent's drafts and await scientific review.

## SCI-0 supplement: review package (docs only)

- **Context:** the SCI-0 direction was accepted, but document acceptance is
  pending. The review asked for:
  - an integration record;
  - review materials and reproducible numbers;
  - the distinction between evidence and value;
  - the data cutoff;
  - follow-up proposals A, B and C, without implementing them.
- **Branch:** `sci0-scenario-evidence-audit`. Not merged; SCI-1 not started.
- **Started:** 2026-11-07T01:32:59Z.
- **Completed:** 2026-11-07T01:41:12Z, at this commit.
- **Wall-clock elapsed:** 8 min 13 s. One agent, no parallel work.
- **Added:** `docs/sci0/`:
  - `README.md`: index, MAP-2 integration record with recorded times and
    unknowns marked, branch and diff, docs-only check, data cutoff, unread
    sources, unverified status;
  - `EVIDENCE_MATRIX.md`: generated verbatim from the committed data;
  - `RANKING_CLAIMS.md`;
  - `ISSUES.md`;
  - `REPRODUCTION.md`: probe code, data and engine hashes, parameters,
    full-precision outputs;
  - `FOLLOW_UP_PROPOSALS.md`: A, B and C, not implemented.
- **Edited:** the contract now has:
  - a scope section ("evidence sufficiency is not scientific value");
  - the exact IDs of the three pivotal relationships (one relevance
    classification and two task–gap links);
  - the exact tie values;
  - "not assessed as low".
- **Probe:** re-run against `6fd4222`, from a temporary test file deleted
  before commit, with results identical to SCI-0:
  - margin 0.04285714285714293;
  - an exact tie at 50 pts (0.6285714285714286), broken by the
    cheaper-first rule;
  - weight stability 6/6 at 100 pts and 4/6 at 50 pts.
- **Verification:**
  - `npm run check` passes (268/268 unit tests);
  - `git diff --stat main -- src scripts public package.json
    package-lock.json` is empty.
- **Rework:**
  - "re-run at 01:3x" was replaced by the recorded bound "after
    01:32:59Z";
  - the Initial Reports dates were narrowed to the one verified example
    (Lefroy Bay, December 18, 2023);
  - "Correction to wording" was reframed as "Precision", since the
    original wording was accurate.

## SCI-0 merge into main

- **Context:** SCI-0 was approved after manual review of the seven Markdown
  files at `6dd7fef`. A read-only verification
  (2026-11-07T18:01:32Z–18:03:03Z) confirmed the branch head, the nine
  documentation paths and a clean working tree.
- **Started:** 2026-11-07T18:07:58Z.
- **Completed:** 2026-11-07T18:09:07Z, at this log commit (pushed right after).
- **Wall-clock elapsed:** 1 min 09 s.
- **Merge:** `a9407a7e1bd0464a6967c907097ee61ddb1415dd` (`--no-ff`).
  - `origin/main` was `6fd4222` and `origin/sci0-scenario-evidence-audit`
    was `6dd7fef`, unchanged since review.
  - The merged tree is identical to `6dd7fef`'s tree.
  - It is documentation only: `docs/` and `DEVELOPMENT_LOG.md`.
- **Verification:** `npm run check` passes (268/268 unit tests).
  - The smoke tests and data validators were not re-run, because no code or
    data changed. The last full run on identical code and data was the
    MAP-2 integration (2026-11-07T00:31–00:40Z).

## A1–A4: scientific wording corrections (SCI-0 track A)

- **Branch:** `a1-a4-scientific-wording`, created from `main` `ffb9f4c`
  (after the SCI-0 merge). Not merged.
- **Started:** 2026-11-07T18:09:10Z.
- **Completed:** 2026-11-07T18:21:13Z, at this commit.
- **Wall-clock elapsed:** 12 min 03 s. Including the SCI-0
  merge before it, from 18:07:58Z: 13 min 15 s. One agent, no
  parallel work.
- **Scope:** wording only, through one pure module
  (`src/lib/decision/explain.ts`) shared by Mission Glass and the research
  workspace.
  - **A1:** the card's "Covers N of 3 open questions" now reads "Linked to N
    of 3 open questions (AI-drafted links, not yet reviewed)". The status
    and author come from the review registry.
  - **A2:** "Stays #1 in X of Y runs …" now reads "Weights only: stays #1 …
    Not covered by this check: N unreviewed inputs; removing any one of K of
    them alone changes #1". It uses `rankProvisional`'s existing
    `unreviewedInputs` and `pivotalInputs`. Applied in Mission Glass
    Level 2 and on the research stability line.
  - **A3:** the evidence-quality explanation in `engine.ts` now says the
    comparison covers the "closest evidence currently linked to these
    hypotheses in this dataset", and that other observations may not be
    linked yet. Its value is unchanged. `docs/DECISION_MODEL.md` describes
    the rule the same way.
  - **A4:** "(already addressed)", "(addressed)", "Addressed by" and
    "Addressed" now read "no longer counted as open". A note says the
    question was closed by an MDI rule (awaiting expert review), that this
    closes only this question, and that the other open questions are not
    affected. Applied in the Mission Glass evidence sheet, the research
    task links and the research evidence list.
- **Unchanged:** formulas, weights, review statuses, gap states and data.
  `git diff main -- src/data` is empty.
- **Acceptance:**
  1. **Scores, order and review state.** A before/after probe (the same
     code, run on `main` and on this branch) covered 2 dates × 2 platform
     sets × 4 budgets plus the Mission Glass task views. Compared exactly
     (27 groups; 0 differences):
     - totals in full precision, ranks, criterion values and statuses;
     - basis, margins, feasibility and infeasibility;
     - stability, unreviewed and pivotal inputs;
     - reviewed-ranking status and all 50 registry entries (all pending).

     The only differences are the 15 distinct expected texts: A1 rationale,
     A2 conditions and A3 explanations.
  2. **Key pages.**
     - `npm run check` passes: 272/272 unit tests, 4 new in
       `explain.test.ts`. Three existing tests changed their expected text
       only.
     - Prototype smoke: 188/188 in two consecutive runs. New: A3 and A4
       checks; A1 and A2 checks updated.
     - Research smoke: 120/120 with `SMOKE_LIVE=1`, with 4 new A2–A4 checks.
     - The translation runs pass.
     - Screenshots of the card, the evidence sheet, the research
       recommendation and the gap card were reviewed.
- **Rework:** none.

## A1–A4 merge into main

- **Started:** 2026-11-07T18:31:42Z.
- **Completed:** 2026-11-07T18:38:59Z, at this log commit (pushed right after).
- **Wall-clock elapsed:** 7 min 17 s.
- **Merge:** `d19ede86815234863ff5b7f47f77b2822910bc20` (`--no-ff`).
  - `origin/a1-a4-scientific-wording` was `1475952` and `origin/main` was
    `ffb9f4c`, both unchanged since acceptance.
  - The merged tree is identical to `1475952`.
  - `src/data` and `criteria.ts` are unchanged.
- **Verification of the merged production build:**
  - `npm run check` passes, 272/272 unit tests;
  - prototype smoke: 188/188 in two consecutive runs;
  - research smoke: 120/120 with `SMOKE_LIVE=1`;
  - `verify:citations`: 129 quotes, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:briefing`: 35 checks, 0 problems;
  - `verify:terrain`: the assets match a fresh build.

## SCI-1 v1: evidence for the three candidate actions (pending, for review)

- **Branch:** `sci1-evidence-v1`, from `main` `556ece2`. Not merged.
- **Started:** 2026-11-07T18:39:01Z. This is the recorded time at which the
  A1–A4 push was confirmed; the branch was created by the next command, which
  has no timestamp of its own.
- **Completed:** 2026-11-07T18:57:12Z, at this commit (pushed right after).
- **Wall-clock elapsed:** 18 min 11 s.
- **What was added:**
  - `src/data/scenarios/jezero-margin-unit.sci1-proposals.json`:
    - 27 verbatim quotes:
      - 20 from the Pelican Point and Comet Geyser initial reports;
      - 5 from NASA's Mars 2020 instruments page;
      - 1 from NASA's Mars Sample Return page;
    - 11 proposals, all `pending` and `draftedBy: "ai-agent"`.
    - It is not read by the engine or the app.
  - Schema and integrity rules: `src/lib/evidence/sci1-proposals.ts`, with
    5 tests. The tests assert that the provisional ranking is unchanged.
  - Two sources in `sources.json`.
  - `npm run verify:sci1`: checks each quote by report and section.
  - `verify:citations` now also covers the SCI-1 quotes.
  - The PDS report helpers were moved to `scripts/lib/pds-reports.mjs`.
  - Report: `docs/sci1/SCI1_EVIDENCE_V1.md`.
  - A project rule in `CLAUDE.md`.
- **Unchanged:**
  - the scored scenario data;
  - the review registry: 50 pending, 0 approved;
  - the engine, weights, criteria and UI.
  - Check: `git diff main` on those paths is empty.
- **Finding needing a reviewer:** two quotes cited as "Pelican Point initial
  report" are in the Comet Geyser report (4 citations). A correction is
  proposed, not applied.
- **Verification:**
  - `npm run check` passes: 277/277 unit tests;
  - prototype smoke: 188/188;
  - research smoke: 120/120 with `SMOKE_LIVE=1`;
  - `verify:sci1`: 27 quotes, 0 problems;
  - `verify:citations`: 154 quotes, 0 problems;
  - `verify:briefing`: 35 checks, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:terrain`: the assets match a fresh build.

## SCI-1 v1: review fixes and merge into main

- **Started:** 2026-11-07T19:04:26Z.
- **Completed:** 2026-11-07T19:15:36Z, at this log commit (pushed right after).
- **Wall-clock elapsed:** 11 min 10 s. This covers the fixes,
  the checks and the merge.
- **Review fixes on `sci1-evidence-v1`:**
  - `61e4740` changes the wording only:
    - **Core:** how the carbonate formed (detrital or in situ) is kept
      separate from the host rock's origin. In-situ carbonate alone favours
      neither host rock (27-30). The sample-return condition is kept.
    - **Survey:** "2 of 3 open questions" is marked as a hypothetical result.
      It applies only if the link is approved and later adopted into scored
      data; today the count is 1 of 3.
  - `78edb2a` corrects a count in the report: `verify:citations` covers 156
    quotes, not 154.
- **Correction to the SCI-1 v1 entry above:**
  - It says "20 from the Pelican Point and Comet Geyser initial reports". The
    correct number is 21: 16 from Comet Geyser and 5 from Pelican Point. The
    27 total is correct.
  - It says "`verify:citations`: 154 quotes". That run came before the two
    Bunsen Peak quotes were added. On the committed data the count is
    156 = 129 + 27, with 0 problems.
- **Scope:** `git diff main...` lists only:
  - the evidence package: the proposals JSON, the schema and tests, two
    added sources, the report;
  - its checks: `verify:sci1`, the `verify:citations` collection, the shared
    PDS helper;
  - `CLAUDE.md` (one rule) and this log.

  The following are unchanged (the diff is empty): the scored scenario, the
  review registry (50 pending, 0 approved), `src/lib/decision`, the UI and
  the other data.
- **Merge:** `d4b43da2341db19a1e1dba52d0f4eb22cde0d264` (`--no-ff`), from `origin/sci1-evidence-v1` at
  `78edb2a` into `main` at `556ece2`. The merged tree is identical to
  `78edb2a`.
- **Verification:**
  - **On the final merged tree:**
    - `npm run check` passes: 277/277;
    - `verify:sci1`: 27 quotes, 0 problems;
    - `verify:citations`: 156 quotes, 0 problems.
  - **On the merged tree of `61e4740`,** which differs from the final tree
    only in the two count lines of `docs/sci1/SCI1_EVIDENCE_V1.md`:
    - `npm run check` passes: 277/277;
    - prototype smoke: 188/188 in two consecutive runs;
    - research smoke: 120/120 with `SMOKE_LIVE=1`;
    - `verify:sci1`: 27 quotes, 0 problems;
    - `verify:citations`: 156 quotes, 0 problems;
    - `verify:geo`: 0 problems;
    - `verify:briefing`: 35 checks, 0 problems;
    - `verify:terrain`: the assets match a fresh build.

## PDS locator correction (SCI-1 finding F1), for review

- **Branch:** `pds-locator-correction`, from `main` `1521fcd`. Not merged.
- **Started:** 2026-11-07T19:15:53Z (recorded when the branch was created).
- **Completed:** 2026-11-07T19:22:26Z, at this commit (pushed right after).
- **Wall-clock elapsed:** 6 min 33 s.
- **Change:** provenance metadata only.
  - Four `locator` values changed from "Pelican Point initial report" to
    "Comet Geyser initial report (M2020-1088-27), Returned Sample Science
    Considerations". This is the text of the reviewed proposal
    `sci1:locator:pds-quote-in-comet-geyser-report`.
  - In `jezero-margin-unit.json`:
    - the `task-core-for-earth → gap-sedimentary-or-igneous` citation;
    - `da-core-detrital-carbonate`, citation 1.
  - In `jezero-margin-unit.reviews.json`:
    - the evidence of `task-gap:task-core-for-earth->gap-sedimentary-or-igneous`;
    - `discrimination:da-core-detrital-carbonate`, evidence 1.
  - The quotes themselves are unchanged.
- **What stayed the same:**
  - Both data files are identical to `main` apart from these four values
    (structural JSON comparison).
  - Registry: 50 entries, all `pending` and all `draftedBy: "ai-agent"`.
    Every entry is identical outside its evidence list.
  - The A1–A4 engine probe gives byte-identical output before and after:
    - 2 dates × 2 platform sets × 4 budgets;
    - totals, ranks, margins, feasibility, stability, unreviewed and pivotal
      inputs, reviewed-ranking status;
    - registry states, and all explanation and display texts.
- **Locator audit:** all 21 PDS Vol. 4 citations in the scenario and the
  registry were checked with a scratch script, not committed. Each now names
  a report whose text contains its quote; before the change, these four were
  the only mismatches.
- **Visible effect:** the research workspace citation lines show the new
  locator text. Mission Glass does not show locators.
- **Known follow-up, not changed here:** the SCI-1 proposal record keeps
  the locator as it was when the proposal was written.
  - Its `currentLocator` field still reads "Pelican Point initial report".
  - The evidence summary of `ev-cg-lab-detrital-or-insitu` still refers to
    the old locator.
  - So `verify:sci1` still prints that text in its NOTE lines.
- **Verification:**
  - `npm run check` passes: 277/277;
  - prototype smoke: 188/188;
  - research smoke: 120/120 with `SMOKE_LIVE=1`;
  - `verify:citations`: 156 quotes, 0 problems;
  - `verify:sci1`: 27 quotes, 0 problems;
  - `verify:briefing`: 35 checks, 0 problems;
  - `verify:geo`: 0 problems;
  - `verify:terrain`: the assets match a fresh build.

## PDS locator correction: finishing touches and merge into main

- **Started:** 2026-11-07T19:33:24Z.
- **Completed:** 2026-11-07T19:43:27Z, at this log commit (pushed right after).
- **Wall-clock elapsed:** 10 min 03 s. This covers both
  finishing touches, the checks and the merge.
- **Finishing touches on `pds-locator-correction` (`5fc4905`):**
  - The SCI-1 proposal `sci1:locator:pds-quote-in-comet-geyser-report` is
    kept as the historical record:
    - each citation keeps its old locator in `locatorWhenProposed`;
    - `currentLocator` now holds the corrected locator, which matches the
      live scenario and registry (scratch check);
    - `correctionApplied` records the date and commit.
    - Its `status` stays `pending`, the only value the SCI-1 schema allows.
  - The summary of `ev-cg-lab-detrital-or-insitu` names the Comet Geyser
    report.
  - `verify:sci1` now prints the Comet Geyser locator for all four
    citations.
  - The report records the applied correction (F1, table row 8) and the
    SCI-1 merge.
- **Scope:** `git diff main...` lists only:
  - the two scored data files, where only the 4 `locator` lines changed;
  - the SCI-1 proposals file: the locator record and one evidence summary;
  - `docs/sci1/SCI1_EVIDENCE_V1.md`;
  - this log.

  No code, scripts or schema changed.
- **Unchanged:**
  - quotes;
  - registry: 50 entries, all `pending` and all `draftedBy: "ai-agent"`;
  - the 11 SCI-1 proposals: all `pending`.
- **Merge:** `2e080603edff320050c8aebb8fa97e0e763ce824` (`--no-ff`), from `origin/pds-locator-correction` at
  `5fc4905` into `main` at `1521fcd`. The merged tree is identical to
  `5fc4905`.
- **Verification on the merged tree:**
  - The A1–A4 engine probe output is byte-identical to `main` `1521fcd`:
    values, rankings, review states and all texts.
  - `npm run check` passes: 277/277.
  - Prototype smoke: 188/188 in two consecutive runs.
  - Research smoke: 120/120 with `SMOKE_LIVE=1`.
  - `verify:sci1`: 27 quotes, 0 problems.
  - `verify:citations`: 156 quotes, 0 problems.
  - `verify:geo`: 0 problems.
  - `verify:briefing`: 35 checks, 0 problems.
  - `verify:terrain`: the assets match a fresh build.
