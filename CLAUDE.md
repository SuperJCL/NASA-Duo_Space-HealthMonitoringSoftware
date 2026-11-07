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
- `src/lib/prototype/`, `src/data/prototype/` — MDI 2.0 Mission Glass, the
  default entry point (`/`; the research workspace is `/research`). Its
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
  rather than implying more (`docs/TERRAIN_3D.md`). Terrain never affects
  scores.
- `src/data/` — curated JSON evidence records (validated at build time);
  `src/data/geo/` (geographic records, traverse) and `src/data/missions/`.

## Conventions

- TypeScript strict mode; no `any` without a comment explaining why.
- OpenLayers is client-only: load map components through `next/dynamic` with
  `ssr: false` from a Client Component.
- Secrets live in `.env.local` (git-ignored) and are only read server-side.
- Before committing: `npm run check` (lint, typecheck, unit tests, build).
- Record each milestone in `DEVELOPMENT_LOG.md` with real timestamps.
