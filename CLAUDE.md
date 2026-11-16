@AGENTS.md

# Mars Discovery Intelligence (MDI) — project rules for coding agents

## Scientific integrity (non-negotiable)

- Never fabricate NASA measurements, coordinates, layer IDs, or sources. Every
  scientific value in code or data must cite a source URL (in a comment or in
  the record's `source` field).
- Keep **observations** (what an instrument measured) separate from
  **interpretations** (what scientists infer). Never present an interpretation
  as a direct observation.
- If a value cannot be verified, leave it out and flag it in
  `DEVELOPMENT_LOG.md` instead of guessing.
- Evidence records must quote their sources verbatim. After any edit to
  `src/data/`, run `npm run verify:citations` (live check) and `npm test`.
  Curation rules: `docs/EVIDENCE_CURATION.md`.
- Geographic records state their coordinate convention and whether it is
  `stated` by the source or `inferred-cross-validation`. Rover positions are
  historical: never label one as live or current. Run `npm run verify:geo`
  after changing `src/data/geo/` (`docs/GEO_DATA.md`).
- Location briefings (`src/data/briefings/`) are not engine inputs. Each
  item has exactly one classification (measured, interpreted, open-question,
  proposed-by-source, simulated-idea). Quotes must be verified within the
  sample's own report section: run `npm run verify:briefing` after any edit.
  Wording shared with another sample's report is Margin-unit scope only.
  Simulated ideas stay `pending` and never propose repeating operations already
  performed. Future investigations always state their conditions.
- SCI-1 candidate evidence (`src/data/scenarios/*.sci1-proposals.json`) is
  never an engine input: every proposal stays `pending` and
  `draftedBy: "ai-agent"`, and moving one into scored data is a reviewed
  SCI-2 change. Run `npm run verify:sci1` after editing it
  (`docs/sci1/SCI1_EVIDENCE_V1.md`). The app may show it only through the
  candidate comparison (`src/lib/prototype/candidate-compare*.ts`, server-side
  loader): every science line cites SCI-1 evidence about that action, is
  labelled "SCI-1 draft · pending expert review" with its scope, and never
  affects scores, ranks or the plan.
- Records must declare `relevance`. Regional context (e.g. SIM 3464 unit Nue)
  must never be used as local evidence or as a competing hypothesis; integrity
  checks enforce this.
- Curated judgements (task–gap links, priority statements, discrimination
  assessments) that the agent drafts must have `review.status: "pending"`.
  Only a human may set "approved". Unapproved judgements are never scored.
- Review state lives only in the review registry
  (`src/data/scenarios/*.reviews.json`). The agent must never set an entry
  to approved, rejected or needs_revision unless a named human reviewer asks
  for it, and must never invent a reviewer. The primary (reviewed) ranking
  uses only approved relationships; the provisional ranking must stay
  labelled as not validated.
- Never let an LLM assign scores, gaps or rankings. The decision engine
  (`src/lib/decision/`) is deterministic and only accepts `SnapshotEvidence`
  from `selectEvidenceAsOf`, which prevents future-data leakage.

## Code layout

- `src/app/` — routes, layouts, Route Handlers (thin; no business logic).
- `src/components/` — React UI only. No data fetching or science logic.
- `src/lib/map/` — map configuration and geodesy. Pure modules (no DOM) must
  stay free of OpenLayers imports so they remain unit-testable.
- `src/lib/evidence/` — Zod schemas, integrity rules, snapshot filter, data loading.
- `src/lib/decision/` — deterministic scoring engine and retrospective review.
- `src/lib/geo/` — geographic records (sample sites, traverse, crater centre,
  product extents): Zod schemas, integrity rules, loader, render-neutral map
  features. Never imported by `lib/evidence` or `lib/decision`; geography never
  affects scores. Tasks have no coordinates.
- `src/lib/mission/` — present-day vs historical-replay selection and mission
  framing (simulated 2026 astronaut mission). It selects one evidence date for
  the existing `selectEvidenceAsOf`, and contains no science logic.
- `src/lib/briefing/` — location science briefings: Zod schema, integrity
  rules, loader. Not imported by `lib/evidence` or `lib/decision`.
- `src/lib/prototype/`, `src/data/prototype/` — MDI 2.0 Mission Glass (on the
  `feat/myomars-station` branch it is kept at `/legacy/mission-glass`; `/` is
  the MyoMars base station; the research workspace is `/research`). Its
  targets, steps and events are
  scenario-defined and must stay labelled simulated; never copy them into
  `src/data/geo/`. Ranks come only from the existing engine. MAP-2
  sequence lines (`mission-sequence.ts`) follow plan order only, are always
  labelled "Conceptual mission sequence — not a navigable route", never infer
  a missing position, and give straight-line separations only (Mars sphere,
  never from exaggerated 3D geometry); see `docs/MAP2_MISSION_SEQUENCE.md`.
- `src/lib/terrain/`, `src/data/terrain/`, `public/terrain/` — MAP-3A local
  3D terrain: a bounded crop of the verified Trek CTX DTM (20 m) and the
  matching CTX orthomosaic, built only by `scripts/build-ctx-terrain.mjs`
  (`npm run build:terrain`; check with `npm run verify:terrain`). Never edit
  the assets by hand, never invent or smooth elevations, keep 1× as the
  default exaggeration (3× and 5× must stay labelled as not true scale),
  and never present the view as a route or traversability model. Elevation
  profiles are straight sampling lines and must say so; state the real relief
  rather than implying more (`docs/TERRAIN_3D.md`). The station's map also has a HiRISE model of
  the same area (`scripts/build-hirise-terrain.mjs`, `npm run build:terrain:hirise`): every 5th
  post of the 1 m DTM copied unchanged (decimation, never averaging or smoothing), validated
  against PDS and the CTX crop; the EVA route grid stays on CTX. Terrain never affects
  scores. The only route layer on this terrain is the EVA route view below;
  the terrain itself is still not a traversability model.
- `src/lib/eva-route/`, `src/components/route/`, `src/data/prototype/eva-scouting.json`
  — EVA route & scouting, a clearly labelled SIMULATED planning layer
  (`docs/EVA_ROUTE_SCOUTING.md`). It plans A* routes on the OBSERVED map of
  the verified CTX crop and budgets crew time/O₂ with the Sol Atlas EVA model
  (Apache-2.0; see `NOTICE`). Rules: unobserved ground is never safe and a
  crew route never crosses it; only the rover `Sensor` reads the hidden truth
  (`truth.ts` is never imported by planner-side modules or `tools.ts`); a
  departure needs a safe outbound AND return crew route on observed ground;
  every simulated item (habitat, surveyed areas, rover, hazards, rules,
  decision weights) stays labelled simulated; DTM slope is derived and is a
  lower bound, never a ground observation; decision values attach to target
  roles, are not science scores, and never feed or read the decision engine.
  Future agents use `tools.ts` only: they choose among computed options with
  the current `stateVersion` and never change numbers. Keep the provenance
  headers of the files derived from Sol Atlas. MAP-2 sequence lines stay
  conceptual and are not replaced by these routes.
- `src/lib/station/`, `src/components/station/` — MyoMars Mars Base (`/`), English-only UI (no
  i18n framework; glossary in `docs/myomars/ENGLISH-DEMO.md`): the Mission Map is always the
  background and Health Monitoring is an overlay on it (`crew/HealthOverlay.tsx`; opens once per
  EVA, then only by the user; Esc / Collapse only collapses; the map is inert while it is open; the
  real crew list only; other people's messages notify, never take focus; device connection, data
  validity and case status are separate statements; no valid data → "Unable to Assess"). The
  overlay shows the case EVENT CHAIN (`event-chain.ts`: Data source → Base analysis → Base review →
  HUD → Crew response → Retest → Reassessment; "Case Closed" and "closing notice delivered" are two
  separate facts), step evidence and messages, the indicator chart, and a fixed decision area
  (conclusion, next step, actual text to send, main actions, inline review form) that stays visible
  when the full flow is open. Collapse, person switch and the full flow keep the selected case, drafts
  and an open review form. The crew map marker is a labelled SIMULATED position (no position source).
  The flow is DERIVED from recorded state (`flow.ts`, `event-chain.ts`, `crew.ts`, `comms.ts`);
  animations (one-off, per recorded event) and replays are presentation only and never drive a
  business step; nothing is inferred from elapsed time. The data-flow canvas (`canvas.ts`,
  `crew/FlowCanvas.tsx`) draws the path the data actually took; a node may
  show its result only once the station revealed it (`businessProgress` ≥
  `needs`), the transfer stops at a human node, and a replay never re-runs
  analysis or sends anything. Summary indicators only, never a fake waveform. The local demo (`demo.ts`, drawer) only reacts
  to messages the station already sent and never decides for base staff.
  Crew roster, device status and HUD reports are LOCAL mock extensions
  (`local-protocol.ts`, schema `myomars/v1-local`, proposals in
  `docs/myomars/STATION-LOCAL-PROPOSALS.md`), never added to the shared
  contracts without the team. The previous three-column workbench is kept at
  `/legacy/workbench`. The Mission Map is the
  existing Mission Glass embedded unchanged (`embedded` prop; lazy, error-bounded, kept mounted
  but hidden), so map, terrain and EVA route code is reused, never reimplemented, and
  `/legacy/mission-glass` stays the full standalone page. Mission context (`mission.ts`): one
  simulated EVA = one run; only the human "Confirm Start EVA" (summary dialog) publishes `scenario.start`
  (station role; selecting a task, opening the map or opening the overlay never does); "End EVA"
  (`station.eva.ended`) changes the phase only and never closes, deletes or judges health events;
  a new EVA waits until the ended one's events are closed. A task gives display context only:
  unstated load / posture / device conditions stay unknown, and terrain or route scores are never
  turned into health risk. A SIMULATED demo (`docs/myomars/CONTRACTS.md`; v0 history in `docs/station-integration.md`).
  Adapter hand-off, HUD receipt and astronaut confirmation are separate
  statuses and are never inferred from one another. Every view keeps the
  "Simulated Data · Simulated Analysis" label. The "LLM analysis" is a deterministic rule
  pipeline (`analysis.ts`, demo thresholds); never call a real model, never
  produce a diagnosis, treatment or automatic task restriction, never infer
  physiology from data that failed quality or comparability checks. The
  analysis only creates a candidate: nothing reaches the HUD without a human
  approval with a reason (`station.ts` enforces it). Only `approve` sends
  ACTION messages (notice, retest task); `close` and `keep-open` publish a
  STATUS notification (`station.reassessment` with `caseStatus`) at any
  evaluation version, never an action and never twice for the same status;
  `reject` sends nothing. Show the case status and the latest evaluation
  result as separate indicators. Outbox lookups by case are scoped to the
  current run (demo case IDs repeat across runs). The demo input is one
  standardised simulated measurement (fixed grip protocol), not continuous
  sEMG monitoring; grip force is an independent grip-meter reading, never
  derived from sEMG. In mock mode a hand-off is never shown as a delivery
  success; event types and IDs belong in the technical details. Alerts are
  cleared only by a human close. Inbound events are deduplicated by `eventId`, scoped by
  `runId`, and a reset cancels pending analysis. Transport lives only in an
  adapter (`adapter.ts`); the message format is a PROPOSAL, not an agreed
  team protocol, and the station is standalone until a real adapter is
  tested. Do not build the Trigger or HUD here (`?dev=1` is a dev-only
  injector).
- MyoMars two-end integration (`integration/myomars` only; `docs/myomars/INTEGRATION.md`):
  two product interfaces (station, HUD), no Trigger / simulator page. `myomars-hud/` is the HUD
  (now maintained by the project owner); integration-mode changes stay behind `hud.html?mode=integration`
  (base-published content only, first layer = text + current action + available buttons, details
  collapsed, finished tasks as history without buttons, no category inferred from noticeId, no
  fatigue / recovery / medical content) and the standalone suites keep passing. `relay/` is the local relay
  (never analyses or approves). Data input is the replay module (`src/lib/replay/`, `replay/cli.ts`,
  the station's relay-mode dev entry): role `trigger` = data producer, SIMULATED samples labelled as
  such, every demo assumption listed by `intakeCheck`; teammate data is checked on their branch first,
  raw signals are never written into feature fields, and a missing value stays null. `std-grip-40` is
  only the current integration sample protocol, never the required protocol for future data (a new
  protocol needs its own baseline, never a relabel). Integration verification = `npm run check`,
  `npm run test:hud` (the HUD's own suites; the HUD folder is outside the station's ESLint),
  `npm run e2e:two-end`, and the standalone smoke tests; HUD changes are listed for the teammate in
  `docs/myomars/HUD-INTEGRATION-MODE.md`.
  The ASTRA patch demo (`astra-patch/`, standalone Python, merged via #4) is an INDEPENDENT
  explanatory program by design (`docs/myomars/DEMOS.md`, `docs/myomars/PATCH-AUDIT.md`): it never
  becomes a runtime dependency of the Base, HUD or relay; do not build patch → relay / Base / HUD
  adapters, protocols, baselines or field mappings; never relabel its walking/quadriceps µV data as
  `std-grip-40` or fill its missing fields; the Base ↔ HUD loop keeps using the simulated data
  replay; no UI or introduction may imply the two programs are connected.
- MyoMars ONLINE DEMO (`/demo`, `docs/myomars/LIVE-DEMO.md`): Base + HUD in one page through the
  in-browser bus (`src/lib/demo/`; relay session rules shared in `relay/core.ts`; HUD in a same-origin
  iframe of `public/hud/`, generated from `myomars-hud/` by `scripts/copy-hud.mjs` — never edit
  `public/hud/`). The HUD frame may publish only as `hud` / `device`; receipts come only from the HUD
  page; approvals and closes stay human actions; no timed or invented receipts; wording says
  "in-browser bus", never a server or a real device. Browser-demo and relay transports never run
  together (`demoLink` ignores `?relay=`). No server-side session or Vercel Function memory.
- `src/contracts/`, `contracts/`, `tools/myomars/` — MyoMars shared message
  contracts v1 (Trigger / HUD / Mars Station), a team PROPOSAL
  (`docs/myomars/CONTRACTS.md`). Zod sources in erasable TypeScript that Node
  22 runs directly (the local `package.json` files only set `"type": "module"`
  for these folders); `contracts/` is GENERATED (`npm run contracts:build`,
  never edit by hand; `contracts:check` must pass). All data is simulated.
  Only additive changes within v1; `proposed-extension` types stay optional
  until the team confirms them. No transport/relay code lives here.
- `src/data/` — curated JSON evidence records (validated at build time);
  `src/data/geo/` (geographic records, traverse) and `src/data/missions/`.

## Conventions

- TypeScript strict mode; no `any` without a comment explaining why.
- OpenLayers is client-only: load map components through `next/dynamic` with
  `ssr: false` from a Client Component.
- Secrets live in `.env.local` (git-ignored) and are only read server-side.
- Before committing: `npm run check` (lint, typecheck, unit tests, build).
- Record each milestone in `DEVELOPMENT_LOG.md` with real timestamps.
