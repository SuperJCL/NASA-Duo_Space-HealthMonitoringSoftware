# Mars Discovery Intelligence (MDI)

> Given incomplete scientific evidence and limited mission resources, what
> should a Mars explorer investigate next, and why?

MDI is an independent practice prototype, not an official NASA product. It is
a retrospective scientific investigation simulator built on real NASA Mars
Trek data. The initial scope is **Jezero Crater, Margin Unit**.

**Status: Milestone 2 (MVP vertical slice).** The full workflow works for a
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
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Unit tests (Vitest) |
| `npm run check` | Lint, typecheck, tests and build |
| `npm run smoke` | Browser smoke test against a running server (`BASE_URL`, default `http://localhost:3000`). See below |
| `npm run verify:citations` | Re-fetch every source and check that each quote in the data is verbatim. Needs `curl` and `pdftotext` |

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
