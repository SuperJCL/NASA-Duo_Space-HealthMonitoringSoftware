# Deploying the FlexArray 45-second demo as its own Vercel site

**Production address: https://nasa-duospace-healthmonitoringsoftw.vercel.app/#flexarray**

The teammate's package (`myomars-flexarray-45s-demo.zip`) is published unchanged as a **separate static
website**, on its own Vercel project **`nasa-duo_space-healthmonitoringsoftware-myomars-flexarray-demo`**. It is independent of the MyoMars Base/HUD
site (`myomars-demo`, https://myomars-demo.vercel.app/demo):
- separate project and domain;
- deployed and run independently; no data or messages pass between the two sites during the demos;
- no Python service.

## How it is built

`scripts/build-site.mjs` (Node.js only, no dependencies, no network):
1. Checks the ZIP against `myomars-flexarray-45s-demo.zip.sha256`.
2. Extracts only the package's **prebuilt frontend**, `frontend/dist/` (11 files, about 1.6 MB), into
   `site/`.
3. Checks every extracted file against the package's own `MANIFEST.sha256`, and against the ZIP's
   CRC-32 when the Node.js version provides it.

The page, its visuals, animations and interactions are therefore exactly the teammate's build. The
package states that a clean `npm ci` or `pnpm install` rebuilds this `dist/` byte for byte. The
TypeScript sources stay inside the ZIP, so the root `tsconfig.json`, ESLint and `next build` never see
them.

## Status

| | |
|---|---|
| Production deployment | **Ready**, from `main` `d9bc89f`. Vercel reported success at 2026-11-16 04:49 UTC (build about 6 s); the owner confirmed the Production Deployment is Ready |
| Automated checks before deployment | `site/` served locally like Vercel static hosting: `flexarray-browser` 20/20 with 8 cores emulated. With the real 4 cores, the intended `lite` bay was chosen (a legitimate downgrade) and the suite stops at that check. Review gate 11/11; paused navigation 6/6. **The full real-time playback suite (`flexarray-demo`) did not complete** in that environment |
| Manual acceptance on the live address (project owner, reported 2026-11-16) | **Passed**: full playback, including the 0:35 review pause and the continuation to 0:45 after the confirmation; the link opens anonymously, without a sign-in. The operating system, browser and graphics hardware were not reported; no other environment is claimed. |

## Vercel project settings (`nasa-duo_space-healthmonitoringsoftware-myomars-flexarray-demo`)

| Setting | Value |
|---|---|
| Git repository | this repository; Production Branch `main` |
| Root Directory | **`myomars-flexarray-demo`** |
| Framework Preset | **Other** |
| Install Command | none: there is no `package.json` here and nothing to install. Leave the override off |
| Build Command | **`node scripts/build-site.mjs`** (also set in `vercel.json`) |
| Output Directory | **`site`** (also set in `vercel.json`) |
| Node.js Version | 22.x (any 20+ works) |
| Environment variables | **none** |

`vercel.json` in this folder holds:
- the build command and output folder;
- a one-year immutable cache for the hashed `/assets/*` files, as in the package's own launcher;
- `X-Content-Type-Options: nosniff`.

It is read only by the project whose Root Directory is this folder. The `myomars-demo` project (Root
Directory `./`) does not read it and is not changed.

**Official entry: https://nasa-duospace-healthmonitoringsoftw.vercel.app/#flexarray**. Always share this full address, with `#flexarray`; the demo opens
directly.
- `/` without the hash opens the package's ASTRA console. That is the app's own default screen, not
  the submission demo (see below).
- A server redirect from `/` to `/#flexarray` is not possible: the browser would request `/` again.

## Console functions that are not available on the static site

The 45-second guided demo (`#flexarray`) makes **no** network or API request and writes nothing to
storage. The package's tests check this. It needs no backend.

The package's other ASTRA console screens are outside the submission demo. Some of their functions
call the package's optional Python backend (FastAPI + SQLite, `--full` mode). No Python or API
service is deployed, so on this site these functions are **not available**:

| Function | API call | On the static site |
|---|---|---|
| Pre-EVA readiness assessment: saving the result | `POST /api/readiness` | **Not available.** The result is computed in the browser, but the request gets **404**. The app then says "Server rejected the assessment; authorization is on hold" and holds the assessment. (With the package's own launcher, the request fails as a network error instead, and the app says "Local mode · decision saved in this browser audit log".) |
| Recording a human authorization | `POST /api/authorizations` | **Not available**: it needs a server-saved assessment, so the request is never made |
| NeuroVision screening sync | `POST /api/neurovision/events` | **Not available**: the sync fails and events stay queued in the visitor's browser |

No API service is added and the console is not changed in this repository.
- **Possible change (for the teammate, not applied):** in the package source (`frontend/src/main.tsx`),
  treat a 404 or 405 from `/api/readiness` like a network error. The console would then fall back to
  its local mode. That changes their code and the package checksum, so it is their decision.
- The full console works only in the package's local `--full` mode (Python 3.12+).

## After deploying: manual check on the public address

Use Chrome or Edge, in a private window (no Vercel login), on a computer with a real graphics card.

1. **Reachable:** open https://nasa-duospace-healthmonitoringsoftw.vercel.app/#flexarray. The FlexArray page opens without a sign-in. The
   disclaimer "Conceptual engineering design — not manufactured, clinically validated, or
   flight-qualified." and the label "Guided demo · synthetic data · not a clinical diagnosis" are
   visible.
2. **Plays:** press **Start demo**. Scene 1 shows the Mars EVA bay. At 0:07 the patch explodes into its
   layers. At 0:18 the simulated helmet HUD appears with synthetic sEMG and IMU. Pause and Play stop
   and resume the clock.
3. **Review gate:** at 0:35 the clock stops.
   - Next scene, Play and the progress bar cannot pass the gate.
   - Nothing appears until you click **Confirm review as demo reviewer**.
   - Then the simulated retest instruction, the crew acknowledgment and the reassessment appear, and the
     demo ends at 0:45.
4. **Quality:** on a computer with 4 or fewer CPU cores or a narrow window, the bay backdrop may use
   its lighter version. That is the package's intended downgrade, not a fault.
5. **Independence:** the page makes no request to the MyoMars Base/HUD site. In the browser's network
   panel, there are no `/api` requests during the 45-second demo.
6. **Refresh:** reload the page. If an old version appears after a redeploy, hard-reload: the package
   installs a service worker.

## Check locally (same steps as Vercel)

Build the site:

```bash
cd myomars-flexarray-demo && node scripts/build-site.mjs
```

Then serve `site/` with any static file server, for example:

```bash
npx serve site -l 8100
```

Open `http://127.0.0.1:8100/#flexarray` and press **Start demo**.

The package's own launcher (`node start-demo.mjs`, see `README.md`) serves the same files.
