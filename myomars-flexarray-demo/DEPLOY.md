# Deploying the FlexArray 45-second demo as its own Vercel site

The teammate's package (`myomars-flexarray-45s-demo.zip`) is published unchanged as a **separate static
website**, the Vercel project **`myomars-patch-demo`**. It is independent of the MyoMars Base/HUD site
(`myomars-demo`):
- separate project and domain;
- no shared code, data or messages;
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

## Vercel project settings (`myomars-patch-demo`)

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

**Entry URL:** `https://<project domain>/#flexarray`.
- `/` without the hash opens the package's ASTRA console, which is the app's own default screen.
- A server redirect from `/` to `/#flexarray` is not possible (the browser would request `/` again).

## What needs the Python API, and what happens without it

The 45-second guided demo (`#flexarray`) makes **no** network or API requests and writes nothing to
storage. The package's tests check this.

Only the package's other ASTRA console screens call the optional FastAPI backend (`--full` mode):

| Call | Screen | Without a backend |
|---|---|---|
| `POST /api/readiness` | Pre-EVA assessment → Evaluate readiness | The result is computed in the browser first. The package's own launcher drops `/api` connections, so the app says "Local mode · decision saved in this browser audit log". A static Vercel site answers `/api` with **404**, so the app says "Server rejected the assessment; authorization is on hold" and the assessment stays on hold |
| `POST /api/authorizations` | Record human authorization | Only called after a server-saved assessment, so it is never called here |
| `POST /api/neurovision/events` | NeuroVision screening sync | Fails in both cases; events stay queued in the browser, as in the launcher's default mode |

**Minimal adaptation, not applied:** in the package source (`frontend/src/main.tsx`), treat a 404 or
405 from `/api/readiness` like a network error, so the console falls back to its local mode. Then
rebuild and reissue the package. That changes the teammate's code and checksum, so it is their
decision. The official `#flexarray` demo does not need it. Running the FastAPI backend online would
need a separate Python host and is out of scope.

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
