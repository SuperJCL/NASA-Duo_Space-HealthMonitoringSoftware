# Mars Discovery Intelligence (MDI)

**▶ Live demos.** Two websites, deployed and run independently. No data or messages pass between them
during the demos. Both open without a sign-in and passed the project owner's manual acceptance on the
live addresses (2026-11-16).
- **Mars Base + Astronaut HUD:** [myomars-demo.vercel.app/demo](https://myomars-demo.vercel.app/demo).
  The health-monitoring loop in one page, running in your browser (simulated data, simulated
  analysis; nothing to install). Details: [LIVE-DEMO.md](docs/myomars/LIVE-DEMO.md).
- **FlexArray patch, 45-second guided demo:**
  [nasa-duospace-healthmonitoringsoftw.vercel.app/#flexarray](https://nasa-duospace-healthmonitoringsoftw.vercel.app/#flexarray).
  The teammate's patch demo, published unchanged from `myomars-flexarray-demo/` (synthetic data, not
  a diagnosis). Details: [DEPLOY.md](myomars-flexarray-demo/DEPLOY.md).

**▶ Project Demonstration:** [MyoMars_Project_Demo.pdf](docs/presentation/MyoMars_Project_Demo.pdf)
(7 slides, PDF).

**▶ Supplementary Videos:** supplementary material only; the official Project Demonstration is the PDF
above. Published in the release [`submission-v1`](https://github.com/SuperJCL/NASA-Duo_Space-HealthMonitoringSoftware/releases/tag/submission-v1), full length and unedited:
- [Presentation.Introduction.mp4](https://github.com/SuperJCL/NASA-Duo_Space-HealthMonitoringSoftware/releases/download/submission-v1/Presentation.Introduction.mp4) (1:17):
  project introduction, with audio.
- [flexarray-45s-demo.mp4](https://github.com/SuperJCL/NASA-Duo_Space-HealthMonitoringSoftware/releases/download/submission-v1/flexarray-45s-demo.mp4) (0:56): screen
  recording of the FlexArray 45-second guided demo.
- [myomars-base-hud-loop.mp4](https://github.com/SuperJCL/NASA-Duo_Space-HealthMonitoringSoftware/releases/download/submission-v1/myomars-base-hud-loop.mp4) (1:57): screen
  recording of the Mars Base and Astronaut HUD loop.

> Given incomplete scientific evidence and limited mission resources, what
> should a Mars explorer investigate next, and why?

## MyoMars: live demo (one page, one web app)

**`/demo`** is the online, browser-based demo: the **Mars Base** and the **Astronaut HUD** are two
tabs of one page. Their messages are exchanged *inside the browser* through an in-page bus that
applies the same message rules as the local relay:
- contract validation;
- eventId de-duplication;
- run isolation;
- case and retest links.

There is no relay process, no server session and no database. Each visitor (and each Reset)
gets its own session. All data and analysis are simulated, and every message to the crew needs a
human approval.

```bash
npm install
npm run dev                      # http://localhost:3000/demo
npm run build && npm start       # production: one build, one server
```

| | Online demo (`/demo`) | Two-end relay mode (`/?relay=auto`) |
|---|---|---|
| Processes | The web app only | The web app, plus `node relay/server.ts --static myomars-hud` (port 8787) |
| HUD | Same page, second tab (same-origin iframe of `/hud/hud.html`) | A separate page, any browser or device on the network |
| Transport | In-browser bus (`src/lib/demo/`), MessageChannel to the HUD frame | HTTP + Server-Sent Events through the local relay |
| Session | Per browser tab; refresh or Reset demo starts a new, empty one | Relay session `demo`; restart the relay for a clean one |
| Deployment | Vercel / any Next.js host (static pages) | Local machine or LAN |

Details, Vercel settings and the walkthrough: [`docs/myomars/LIVE-DEMO.md`](docs/myomars/LIVE-DEMO.md).

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

## License

**The team's original code is licensed under the [MIT License](LICENSE), Copyright (c) 2026 MyoMars
contributors.** The project owner decided this licence for the team on 2026-11-19. The Git history and
NOTICE credit contributions; they do not determine copyright ownership.

**Covered by the MIT License:** the team's original code and original documentation text:
- **Mars Base web app:** `src/`, `scripts/`, `relay/`, `replay/`, `tools/`, `contracts/`, `design/`
  (except the fonts), tests and configuration.
- **Astronaut HUD:** `myomars-hud/`.
- **ASTRA patch demo:** only the files created in this repository, not the ported or vendored files
  listed under "Not covered" below:
  - `astra-patch/README.md`, `astra-patch/INTEGRATION.md`, `astra-patch/SOURCE.json`,
    `astra-patch/requirements.txt`, `astra-patch/.gitignore`;
  - `astra-patch/astra_patch/showcase.py` and `astra-patch/showcase/` (except the fonts);
  - `astra-patch/tests/test_showcase.py` and `astra-patch/tests/test_standalone.py`.
- **FlexArray demo:**
  - the build tools in `myomars-flexarray-demo/`;
  - the team's original code inside `myomars-flexarray-45s-demo.zip`: the frontend source, including
    the code that generates the 3D scene, the patch geometry and the textures
    (`frontend/src/flexarray/`) and the GLB export and validation scripts (`frontend/scripts/`); the
    backend source; the tests; the launcher `start-demo.mjs`;
  - the team's code in the prebuilt `frontend/dist/`, but not the third-party packages bundled there.
- **Original documentation text:** such as `README.md`, `docs/` and `DEVELOPMENT_LOG.md`. Quotations,
  images, PDF, video and data in them are not covered (see below).

This includes code written with an AI coding assistant under the team's direction (see NOTICE).

**Not covered by the MIT License.** Each of these keeps its own terms; details are in [NOTICE](NOTICE),
[LICENSES/](LICENSES) and each website's `/third-party-notices.txt`:
- **Third-party code:**
  - `src/lib/eva-route/sol-atlas-eva.ts` and `src/lib/eva-route/pathfind.ts`: derived from Sol Atlas,
    Apache License 2.0;
  - the three.js parts of `myomars-hud/scene/mars-scene.js`: MIT, © three.js authors;
  - the third-party packages bundled in the FlexArray package's prebuilt frontend:
    `myomars-flexarray-demo/THIRD-PARTY-NOTICES.txt`;
  - npm and Python dependencies installed at build or run time: their own licences.
- **ASTRA files ported from the upstream repository or vendored, whose rights are not confirmed.** All
  are under `astra-patch/astra_patch/`:
  - ported from `leonardoTT-debug/ASTRA-MyoMars` at `91a464b`, as listed in `astra-patch/SOURCE.json`:
    `__init__.py`, `acquisition.py`, `schema.py`, `processing.py`, `fatigue.py`, `triggers.py`,
    `scenario_fixture.py`, `console.py` and `store.py`;
  - vendored, as listed in `trigger_console_vendor/SOURCE.json`: the folder `trigger_console_vendor/`;
  - added by the same port commit (`045a1b8`) without a per-file origin record, so excluded until
    confirmed:
    - `api.py`, `service.py`, `handoff.py`, `delivery.py`, `__main__.py`;
    - `replay.py` (split out of `__main__.py`);
    - the folder `scenario_fixtures/`;
    - in `astra-patch/tests/`: `test_automatic_triggers.py`, `test_myomars_acquisition.py`,
      `test_myomars_processing.py`, `test_scenario_fixture.py`, `test_target_handoff.py` and
      `test_trigger_console.py`.
- **Licence texts:** the files in `LICENSES/` and `myomars-flexarray-demo/third-party/`, and the
  licence texts quoted in NOTICE and in the notices files: their authors' texts.
- **Fonts:** Geist and Geist Mono (`design/fonts/`, `myomars-hud/assets/fonts/`,
  `astra-patch/showcase/assets/fonts/`, and the copies served by the website): SIL Open Font License 1.1.
- **Template files:** `src/app/favicon.ico` and `public/{file,globe,next,vercel,window}.svg`, from
  create-next-app 16.4.5 (MIT, Vercel).
- **Data:** NASA, USGS and PDS data, and values taken from them, wherever they appear: notably
  `public/terrain/` and `src/data/geo/`. Also the text quoted from cited sources in `src/data/` and in
  the docs. All of it remains under its sources' terms (`src/data/sources.json`).
- **Images, 3D models, PDF and video:**
  - `myomars-hud/assets/mars-pano-360.webp`;
  - the separate image and model files inside the FlexArray package (39 files):
    - `assets/3d/*.glb` (6 models) and `assets/3d/*.png` (4 previews);
    - `docs/flexarray-bay/*.png`, `docs/flexarray-demo/*.png` and `docs/flexarray-redesign/*.png`;
  - `docs/presentation/MyoMars_Project_Demo.pdf`;
  - the videos of the release `submission-v1`.
- **Names and logos:** no trademark rights are granted, for example to NASA, MyoMars, the Next.js and
  Vercel logos, or the team's name.

**Not resolved by this licence decision** (still to be confirmed; listed in NOTICE):
- the source of the HUD panorama image, and the right to use and distribute it;
- the sources of the images in the presentation PDF and the release videos, and the rights to them;
- the rights to the ASTRA files listed above, and the licence of the upstream repository
  `leonardoTT-debug/ASTRA-MyoMars`;
- the HiRISE map credit wording, to be checked against the specific product's source.
