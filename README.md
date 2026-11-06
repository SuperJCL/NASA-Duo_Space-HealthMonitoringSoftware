# Mars Discovery Intelligence (MDI)

> Given incomplete scientific evidence and limited mission resources, what
> should a Mars explorer investigate next, and why?

MDI is an independent practice prototype, not an official NASA product. It is
a retrospective scientific investigation simulator built on real NASA Mars
Trek data. The initial scope is **Jezero Crater, Margin Unit**.

**Status (MAP-0, 2026-11-05):** `main` holds everything up to and including
MDI 2.0 Mission Glass (MG-1 to MG-3, accepted in manual review).

| Route | What it is |
|---|---|
| `/` | **Mission Glass,** the default entry point: simulated mission planning, EVA HUD and replanning over verified NASA/PDS context. A training prototype, not flight software. See [`docs/MISSION_GLASS_PROTOTYPE.md`](docs/MISSION_GLASS_PROTOTYPE.md) |
| `/research` | **Research workspace:** Lefroy Bay sample-site science briefings (BR-2), plus the full evidence and ranking workspace in its advanced drawer |
| `/mission-glass` | Old prototype URL; redirects (307) to `/` |

Earlier status note: `main` held M3 + UX-0 + RI-1 (ranking integrity), with
UX-1 (guided five-step workflow) in review on `ux1-guided-workflow`.

Earlier status note, kept for history:
M3 adds:
- local vs regional-context evidence;
- a five-dimension decision model in which curated judgements need human
  approval and anything unjustified is shown as "Not Evaluated";
- mission constraints;
- scientific integrity tests.

See [`docs/DECISION_MODEL.md`](docs/DECISION_MODEL.md) and
[`docs/SCIENTIFIC_REVIEW_M3.md`](docs/SCIENTIFIC_REVIEW_M3.md).

**M2 (MVP vertical slice).** The full workflow works for a
single scenario, the Jezero Margin Unit:

1. Real NASA Trek map.
2. Sourced observations and interpretations, each with a verbatim quote.
3. Evidence gaps.
4. Simulated candidate tasks with adjustable weights.
5. A deterministic, explainable recommendation.
6. A "what happened later" reveal.

## Quick start

Requires Node.js 22 or later.

```bash
npm install
npm run dev            # http://localhost:3000
```

The browser loads map tiles directly from `https://trek.nasa.gov`, so the
machine running the browser needs internet access to that host.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` / `npm run typecheck` | ESLint / `next typegen` then `tsc --noEmit` |
| `npm test` | Unit tests (Vitest) |
| `npm run check` | Lint, typecheck, tests and build |
| `npm run smoke` | Browser smoke test of the research workspace (`/research`) against a running server (`BASE_URL`, default `http://localhost:3000`). See below |
| `npm run smoke:mission-glass` | Browser smoke test of Mission Glass (`/`), including routing, against a running server (`BASE_URL`) |
| `npm run verify:citations` | Re-fetch every source and check that each quote in the data is verbatim. Needs `curl` and `pdftotext` |
| `npm run verify:geo` / `npm run verify:briefing` | Live checks of the geographic records and of the briefing quotes |
| `npm run build:terrain` / `npm run verify:terrain` | Build the local 3D terrain crop from the Mars Trek CTX DTM and orthomosaic, or rebuild it and compare with the committed assets. See [`docs/TERRAIN_3D.md`](docs/TERRAIN_3D.md) |

The smoke test options:

- `SMOKE_LIVE=1` additionally requires real NASA tiles to load.
- `SMOKE_SCREENSHOT=out.png` saves screenshots.

On a fresh machine, install the browser once with
`npx playwright install chromium`.

## Documentation

- [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md): product
  goal, epistemic categories, temporal model, MVP scope.
- [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md): architecture, data
  model, milestones, risks.
- [`docs/NASA_MAP_RESEARCH.md`](docs/NASA_MAP_RESEARCH.md): Mars Trek WMTS
  facts, verified live, and OpenLayers notes.
- [`docs/EVIDENCE_CURATION.md`](docs/EVIDENCE_CURATION.md): curation rules,
  sources, how quotes were verified, and what was left out.
- [`DEVELOPMENT_LOG.md`](DEVELOPMENT_LOG.md): per-milestone engineering log
  with real timestamps.
- [`CLAUDE.md`](CLAUDE.md): rules for coding agents (scientific integrity,
  code layout).

## Data credits

Map imagery comes from [NASA Mars Trek](https://trek.nasa.gov/mars/) (NASA
Solar System Treks Project). Layer credits are shown in the map's attribution
control.

Evidence records quote public NASA, USGS and PDS sources. Each is listed with
its link in the app and in `src/data/sources.json`.
