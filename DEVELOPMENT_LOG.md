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
