# MyoMars live demo: Mars Base + Astronaut HUD in one page

`/demo` is the submission demo: one URL, two tabs (**Mars Base**, **Astronaut HUD**), the full health
monitoring loop. It runs as a single Next.js app.

**Production address: https://myomars-demo.vercel.app/demo** (Vercel project `myomars-demo`,
production branch `main`).
- This website is separate from the FlexArray patch demo site
  (https://nasa-duospace-healthmonitoringsoftw.vercel.app/#flexarray, see
  `myomars-flexarray-demo/DEPLOY.md`).
- The two websites are deployed and run independently; no data or messages pass between them during
  the demos.

| | |
|---|---|
| Production deployment | **Ready**, from `main` `d9bc89f`: Vercel reported success at 2026-11-16 04:43 UTC |
| Automated checks before deployment | `e2e:browser-demo` 38/38 on a local production build (Linux container, headless Chromium, software WebGL, relay stopped) |
| Third-party notices | **`/third-party-notices.txt`**, linked from the Base's "ⓘ About" panel. It is generated at build time by `scripts/build-third-party-notices.mjs` from the installed packages. It has the copyright notices and full licence texts of the browser-bundled components, Sol Atlas (Apache-2.0: source, files, modifications), three.js in the HUD scene, the Geist fonts (OFL-1.1), the template files and the data credits. Rights still to confirm are listed at its end |
| Manual acceptance on the live address (project owner, reported 2026-11-16) | **Passed**: the full operating loop; the link opens anonymously, without a sign-in. The operating system, browser and graphics hardware were not reported; no other environment is claimed. |

**What runs and what doesn't:**
- No relay process, no port 8787 and no server-side session.
- Nothing is stored on a server.
- All data and analysis are simulated, and every message to the crew needs a human approval.

## How it works

| Part | What it is |
|---|---|
| Page | `src/app/demo/page.tsx` → `src/components/demo/LiveDemo.tsx`. A top bar with the two tabs, the labels "Browser-based demo" and "Simulated data / Simulated analysis", and **Demo controls** (load the sample, walkthrough, **Reset demo**). |
| Mars Base | The existing station (`CrewStation`) with a `demoLink`: its unchanged `RelayStationAdapter` gets a `fetchImpl` that speaks the relay HTTP API to the in-browser bus. URL parameters such as `?relay=` are ignored there, so the relay and browser-demo transports never run together. |
| Astronaut HUD | The existing HUD page, served by the same site at `/hud/hud.html?mode=integration&link=parent&session=…` (copied from `myomars-hud/` by `scripts/copy-hud.mjs` before `dev` and `build`). Its unchanged `base-client.js` gets a `fetchImpl` from `hud/parent-link.js` that carries the same relay calls to the parent page over a **MessageChannel**. |
| In-browser bus | `src/lib/demo/browser-relay.ts`: the relay's session rules (`relay/core.ts`, shared with the Node relay), behind a fetch-compatible function on a non-network scheme (`browser-demo://local`). See the rules below. |
| HUD link security | `src/lib/demo/hud-bridge.ts`. The parent answers only a `myomars-hud-hello` from the same origin, from this iframe's window, for this session, with a per-load nonce. It then transfers one port. Over that port the HUD frame may read and stream its own session, and publish as role `hud` or `device` only: never `station` or `trigger`, never the lease, never another session. |

**Bus rules** (the same as the relay):
- contract validation;
- publisher role per event type;
- eventId de-duplication: same content means a duplicate, different content means a conflict;
- `stale-run` and `unknown-run` checks;
- the station lease.

**Behaviour:**
- **Readiness:**
  - Both ends read the session history before they stream, so nothing published earlier is missed.
  - HUD calls made before the handshake wait for it.
  - A HUD page that never loaded sends no receipt: the Base keeps "awaiting receipt".
- **Receipts:**
  - The HUD page acknowledges receipt (`hud.received`) only of messages it actually received.
  - It loads in the background about 1 s after the Base, like a HUD that is switched on.
  - Acknowledge, View task, Start and Submit are the user's actions in the HUD tab.
  - Base approval and closing are the user's actions in the Base tab.
  - There are no timed or invented receipts.
- **Tabs:**
  - Switching changes visibility only: the same EVA, events, analysis, drafts and HUD task state stay, and nothing is sent again.
  - The tab that is not shown gets a badge for new items. For the HUD: base notices, retest tasks, reassessments. For the Base: observations and HUD replies.
  - Nothing switches by itself.
- **Hidden views:**
  - The hidden Base stays laid out but invisible and inert, so map and terrain keep their size. It renders on demand only.
  - The hidden HUD frame is `display:none`. Its 3D scene pauses, its 2D loop waits for a real viewport, and the canvas refits when shown.
- **Reset demo:**
  - Starts a new session id.
  - Unmounts the old Base (its stream and timers stop) and the old HUD frame.
  - Forgets the old session.
- **Refresh:**
  - Always a clean demo: a new bus and a new session.
  - The HUD uses memory storage in this mode.
  - Nothing is restored after a refresh, so the two views cannot drift apart and nothing is published twice.
- **Wording:**
  - In this mode the Base says "In-browser bus accepted" where the relay mode says "Relay accepted". It never claims a server or a real device received anything.
  - "Received by HUD" only appears after the HUD page's own `hud.received`.

## Walkthrough (about 3 minutes)

1. **Mars Base:** select a task (for example *Abrade and analyse a rock → Target B*), **Review summary,
   start EVA**, **Confirm Start EVA**. Health Monitoring opens once.
2. **Demo controls → Load sample: Comparable change.** One stored simulated measurement arrives. The
   Base runs the simulated analysis and stops at **Awaiting Base Review**.
3. **Approve and send the retest…** → pick a reason → **Confirm and publish**.
4. The **Astronaut HUD** tab shows a "new" badge.
5. Switch to the HUD: **Enter HUD** → **Acknowledge** → **View task** → **Start** → **Submit**.
6. **Mars Base:** the re-evaluation appears (round 1 kept) → **Close case…** → reason → confirm.
7. **Astronaut HUD:** the closing notice, with the task shown as history.
8. **Demo controls → Reset demo** starts over.

## Run locally (one web app)

Requires Node.js 22.18 or newer.

```bash
npm ci
npm run dev                      # development: http://localhost:3000/demo
```

```bash
npm run build                    # production build (runs scripts/copy-hud.mjs first)
npm start                        # http://localhost:3000/demo
```

Nothing else needs to run. The relay is only for the two-end mode (`/?relay=auto`, see
`docs/myomars/WINDOWS-ACCEPTANCE.md`).

## Vercel

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** |
| Root Directory | **`./`** (the repository root) |
| Install Command | `npm ci` (default `npm install` also works) |
| Build Command | `npm run build` (default). `prebuild` copies the HUD into `public/hud/` |
| Output Directory | default (`.next`), do not override |
| Node.js Version | **22.x** |
| Environment variable | `MYOMARS_ENTRY` = `demo`. This is optional: it makes the site root `/` redirect to `/demo`. `/?relay=…` is never redirected |

**What the deployment needs and doesn't need:**
- No other environment variables, secrets, database, KV or background process.
- `/demo` and `/` are static pages.
- Nothing depends on a Vercel Function's memory.

**What is published:**
- The Next.js build.
- `public/` (2.8 MB HiRISE terrain crop, 0.35 MB CTX crop).
- The HUD copy in `public/hud/` (about 0.9 MB: page, scripts, 3D scene bundle, fonts, panorama fallback, one stored simulated retest sample).
- Not published: `relay/`, `astra-patch/` (no Python is built or run), tests, `myomars-hud/server` and `myomars-hud/test`.

**Network and fallbacks:**
- Map tiles come from `trek.nasa.gov` in the visitor's browser.
- If tiles fail, the committed HiRISE crop still shows the mission area.
- If the 3D terrain or the HUD 3D scene fails, the 2D map or the HUD image fallback is used, and the demo still completes.

**Steps:**
1. Import the GitHub repository in Vercel and choose the branch to deploy. Pushes to non-production
   branches create **Preview** deployments.
2. Apply the settings above.
3. Deploy.
4. Open `https://<deployment>/demo`, or `/` if `MYOMARS_ENTRY=demo` was set before the build.

## Checks

| Command | What it covers |
|---|---|
| `npm run e2e:browser-demo` (with only `npm run dev` or `npm start` running; `DEMO=http://127.0.0.1:3000/demo`) | Full loop; tab switches send nothing and keep state; no duplicate eventId; two resets with no leftovers; two visitors isolated; HUD not loaded → no receipt; map, terrain and HUD 3D assets blocked → the loop still completes; hidden HUD renders no 3D frames and refits on show; no request to port 8787/8788; main actions visible at 1440×900 and 1920×1080 |
| `npx vitest run src/lib/demo` | The bus: de-duplication, conflicts, roles, run isolation, session isolation, stream and abort, no non-demo URL, the unchanged station adapter over it |
| `npm run e2e:two-end`, `npm run e2e:mission`, `npm run test:hud` (relay running) | The two-end relay mode is unchanged |
