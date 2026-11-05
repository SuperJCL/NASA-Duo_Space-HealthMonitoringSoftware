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
- `src/data/` — curated JSON evidence records (validated at build time).

## Conventions

- TypeScript strict mode; no `any` without a comment explaining why.
- OpenLayers is client-only: load map components through `next/dynamic` with
  `ssr: false` from a Client Component.
- Secrets live in `.env.local` (git-ignored) and are only read server-side.
- Before committing: `npm run check` (lint, typecheck, unit tests, build).
- Record each milestone in `DEVELOPMENT_LOG.md` with real timestamps.
