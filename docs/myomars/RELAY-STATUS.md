# MyoMars relay (F2): status — UNFINISHED, paused 2026-11-14

This is **work in progress**, kept only on branch `feat/myomars-foundation`. It is not part of the
shared contracts (`feat/myomars-contracts`) and must not be merged into a main line yet. The
Mars Station keeps using its local mock adapter.

Paused on the project owner's instruction: hand over the shared contracts first, then concentrate
on the Station pages and interaction.

## What exists (code written; not yet covered by automated tests)

| Area | File | Written | Verified |
|---|---|---|---|
| Configuration from env (codes, origins, limits, retention); demo codes only with `MYOMARS_DEV=1` | `relay/config.ts` | yes | manually, by starting the relay |
| Login: access code exchanged for an HttpOnly, SameSite=Lax session cookie; token hashes persisted | `relay/auth.ts` | yes | manually (login, `Set-Cookie`) |
| CSRF guard (`x-myomars-client` header required on side-effect requests), origin allow-list, CORS for dev origins | `relay/app.ts` | yes | manually (missing header → 403) |
| Publish: envelope and payload validation, role ↔ type and role ↔ `source` checks, session check | `relay/app.ts` | yes | no |
| Idempotency: same eventId and same content → original result; same eventId with other content → 409 | `relay/app.ts`, `relay/store.ts` | yes | no |
| Run isolation (start / reset / stale / unknown run) | `relay/app.ts` | yes | no |
| Single station handler: lease (TTL, renew, release); only the holder publishes `station.*` and saves snapshots | `relay/app.ts` | yes | no |
| Station snapshot (authoritative station state, `rev` only increases) | `relay/app.ts`, `relay/store.ts` | yes | no |
| SSE stream with resumable cursor (`Last-Event-ID` / `?after=`), `hello` / `resync` / `lease` / `snapshot` control events, heartbeats | `relay/app.ts` | yes | no |
| History and state endpoints | `relay/app.ts` | yes | no |
| Persistence: JSONL event log per session and day, session metadata, snapshot; dedup and seq rebuilt on restart | `relay/store.ts` | yes | no |
| Retention: 7 days (configurable) plus a total size cap | `relay/store.ts` | yes | no |
| Limits: body size, snapshot size, SSE connections (total and per session), sessions, publish and login rate | `relay/app.ts`, `relay/config.ts` | yes | no |
| Static fallback for a single machine (`/station/`, `/hud/`, `/trigger/`) | `relay/static.ts` | yes | no |
| Relay HTTP API contract (login, publish response, lease, snapshot, state, errors, SSE control) | `src/contracts/api.ts` | yes, draft | no; not generated into `contracts/schema` yet |
| Node reference client (login, publish, SSE parser with reconnect) | `tools/myomars/client.ts` | yes | no |

## Remaining (in order, when F2 resumes)

1. Automated relay tests:
   - login and cookies;
   - roles and source spoofing;
   - origin and the client header;
   - deduplication and conflicts;
   - run isolation;
   - lease and snapshot (including stale `rev`);
   - SSE resume and `resync`;
   - persistence across a restart (dedup and seq);
   - retention;
   - every limit (413 / 429).
2. Add the relay API schemas to the generated contract files, after the team reviews `api.ts`.
3. Test clients: Trigger and HUD simulators (CLI, Windows-friendly), based on `client.ts`.
4. Station HTTP+SSE adapter:
   - login screen;
   - lease and read-only mode with takeover;
   - persist-before-send snapshots;
   - connection, offline and "waiting for station" indicators.

   Mock mode is kept.
5. Static export switch (`MYOMARS_EXPORT`), `/station/` base path, single-machine start
   (Windows `.cmd` plus npm scripts), packaging, nginx/systemd templates, rollback notes.
6. End-to-end acceptance:
   - the main flow;
   - duplicates;
   - refresh;
   - reconnect;
   - relay restart;
   - reset;
   - two station pages;
   - unauthorised publishing;
   - limits.

## Known open points

- The REST paths in the requirements document (`POST /telemetry`, `/alerts/{id}/ack`, …) are
  mapped onto one typed publish endpoint (`POST /api/v1/sessions/{sid}/events`). The team needs
  to confirm this.
- Cookies across `localhost:3000` → `localhost:8787` (dev with CORS) have not been tested in a
  browser yet. Same-origin (relay serving the static build, or nginx) is the primary path.
- Memory on the 2 GB server is not guaranteed until it is measured under load.
