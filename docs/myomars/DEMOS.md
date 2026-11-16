# MyoMars: two official demos

MyoMars is shown with **two official, independent demos** on **two websites, deployed and run
independently**. No data or messages pass between them during the demos. They share a theme (muscle
monitoring for an astronaut on EVA) but have **no communication link**: separate Vercel projects,
separate code, separate data. Neither the interfaces nor the project introduction claim they are
connected.

| | Mars Base ↔ Astronaut HUD (software loop) | FlexArray patch demo (sensor concept) |
|---|---|---|
| Purpose | Show the mission and health workflow: Mission Map, simulated EVA, analysis, human review, HUD notice, retest, re-evaluation, case closure | Show the sensor patch concept: the six-layer FlexArray-MN patch, simulated sensing and a review sequence, as a 45-second guided demo |
| Official address | **https://myomars-demo.vercel.app/demo** (Vercel project `myomars-demo`) | **https://nasa-duospace-healthmonitoringsoftw.vercel.app/#flexarray** (its own Vercel project, `nasa-duo_space-healthmonitoringsoftware-myomars-flexarray-demo`; [DEPLOY.md](../../myomars-flexarray-demo/DEPLOY.md)) |
| Code | Next.js app (`/demo`), HUD page (`myomars-hud/`), in-browser bus ([LIVE-DEMO.md](LIVE-DEMO.md)) | The teammate's package in `myomars-flexarray-demo/` (React + Vite, prebuilt), published unchanged |
| Runs | In the visitor's browser; nothing to install | Static files in the visitor's browser; no server, no Python |
| Data | The shared contract demo fixtures, published by the Base's data replay: one standardised grip measurement (`std-grip-40`, %MVC, grip meter). All simulated | Its own synthetic data (fictional crew member A01, synthetic sEMG and IMU). Not a diagnosis |
| Human step | Every message to the crew needs a human approval with a reason | At 0:35 the demo stops until a person clicks **Confirm review as demo reviewer** (simulated; it creates no authorization record) |
| Talks to the other demo? | **No** | **No** |

The FlexArray demo contains its own animated helmet HUD and "Mars Base medical review" scenes. They
are part of that animation. They are **not** the MyoMars Base/HUD software, and no data passes
between the two demos.

## Deployment and acceptance status

Deployment, the automated checks and the owner's manual acceptance are recorded separately. Only what
has actually been confirmed is marked as done.

| | Base ↔ HUD site | FlexArray site |
|---|---|---|
| Production deployment | **Ready** from `main` `d9bc89f`: Vercel reported success at 2026-11-16 04:43 UTC | **Ready** from `main` `d9bc89f`: Vercel reported success at 2026-11-16 04:49 UTC; the owner confirmed the Production Deployment is Ready |
| Automated checks before deployment (Linux container, headless Chromium, software WebGL; local production build) | `e2e:browser-demo` 38/38: full loop, tab switches, resets, isolation, fallbacks | `flexarray-browser` 20/20 with 8 cores emulated. With the real 4 cores, the intended `lite` bay was chosen (a legitimate downgrade); the suite stops there. Review gate 11/11; paused navigation 6/6. **The full real-time playback suite did not complete** |
| Manual acceptance on the live address (project owner, reported 2026-11-16) | **Passed**: the full operating loop; the link opens anonymously, without a sign-in | **Passed**: full playback, including the 0:35 review pause and the continuation to 0:45 after the confirmation; the link opens anonymously, without a sign-in |

The manual acceptance is the owner's report. The operating system, browser and graphics hardware were not reported; no other environment is claimed. The automated checks are local runs from before the
deployment and are a separate record.

How to check: [LIVE-DEMO.md](LIVE-DEMO.md) (Base/HUD) and the manual check in
[DEPLOY.md](../../myomars-flexarray-demo/DEPLOY.md) (FlexArray).

## FlexArray site: what the static deployment does not provide

The official FlexArray demo opens directly at `/#flexarray` and needs no API. The site serves only
the package's prebuilt frontend. The package's other **ASTRA console** screens are reached through
"‹ ASTRA" in the demo, or through `/` without the hash. Some of their functions need the package's
optional Python backend (FastAPI + SQLite), which is not deployed. On the static site these
functions are **not available** and are not part of the submission:

| Console function | On the static site |
|---|---|
| Pre-EVA readiness assessment: saving the result | **Not available.** The result is computed in the browser, but the save request gets 404. The assessment is held ("Server rejected the assessment; authorization is on hold") |
| Recording a human authorization | **Not available**: it needs a server-saved assessment |
| NeuroVision screening sync | **Not available**: events stay queued in the visitor's browser |

These functions work only with the package's full local mode (`node start-demo.mjs --full`, Python
3.12+). Details: [DEPLOY.md](../../myomars-flexarray-demo/DEPLOY.md).

## Development and backup entries (not the submission demos)

| Entry | What it is |
|---|---|
| Base/HUD two-end relay mode (`/?relay=auto` with `node relay/server.ts --static myomars-hud`) | The local, two-process version of the Base ↔ HUD loop (HUD on another device on the network). See [WINDOWS-ACCEPTANCE.md](WINDOWS-ACCEPTANCE.md) |
| FlexArray package launcher (`node start-demo.mjs` in an unzipped copy) | The same files as the FlexArray site, served locally (see the package `README.md`) |
| `astra-patch/` and its showcase page (`python3 -m astra_patch showcase serve` in its virtual environment, port 8150; see `astra-patch/README.md`) | The Python ASTRA patch demo (#4) and the explanatory page added in the #6 round. **Kept as a development and backup entry. It is not the submission's patch demo.** It uses its own synthetic fixtures: 12 summary windows, sEMG in µV, walking / quadriceps, with a signal quality check (`normal`, `sensor_fault`, `fatigue_suspected` scenario labels, not diagnoses). Scope: [PATCH-AUDIT.md](PATCH-AUDIT.md) |

Details: [ENGLISH-DEMO.md](ENGLISH-DEMO.md) (Base/HUD interface) and [LIVE-DEMO.md](LIVE-DEMO.md)
(online Base/HUD demo).

## Project introduction (about 3 minutes)

1. **The patch, as a concept (≈ 50 s, https://nasa-duospace-healthmonitoringsoftw.vercel.app/#flexarray).**
   - Say: "First, the sensor concept: FlexArray-MN, a conceptual engineering design for a skin
     patch. This is a separate 45-second guided demo with synthetic data. It is not a medical
     device and makes no diagnosis."
   - Press **Start demo**:
     - 0:00–0:07: the EVA preparation bay, fictional crew member A01.
     - 0:07–0:18: the six-layer patch explodes, with the microneedle, sweat-management and
       electronics layers.
     - 0:18–0:32: a simulated helmet HUD with synthetic sEMG and IMU. A fatigue-related trend is
       flagged for review only, labelled **Not a diagnosis**.
     - 0:32–0:45: the medical review scene. At 0:35 the demo waits for **Confirm review as demo
       reviewer**, then shows a simulated retest instruction, the crew acknowledgment and the
       reassessment.
2. **The bridge sentence (≈ 10 s).**
   - "The patch demo stands on its own; its HUD and review scenes are part of that animation. The
     mission software next is a separate program with its own simulated sample data. Nothing passes
     between the two."
3. **Mission Map (≈ 30 s, https://myomars-demo.vercel.app/demo, Mars Base tab).**
   - Simulated targets near Lefroy Bay in Jezero crater on NASA imagery, in 2D and 3D. The 3D
     view uses the HiRISE elevation model (5 m mesh from the 1 m DTM, 1× true scale).
   - The right side is **Mission & Crew**: task, astronaut, then (during the EVA) what is known
     about the crew. Unknowns say "Unknown" or "No source in this demo". Planning scores are behind
     "Advanced planning".
   - Select Target B, review the summary, **Confirm Start EVA**. Health Monitoring opens over the map.
4. **Health loop (≈ 90 s, Mars Base and Astronaut HUD tabs).**
   - **Demo controls → Load sample: Comparable change** sends one stored simulated measurement. The
     event chain shows Data source → Base analysis → Base review.
   - The decision area shows the conclusion, the evidence and the exact text to send. The human
     approves with a reason.
   - The **Astronaut HUD** tab shows a "new" badge. The HUD shows the notice over its
     fixed-viewpoint 3D Mars scene (illustrative, not the task site): **Enter HUD** → Acknowledge →
     View task → Start → Submit.
   - The Base re-evaluates; round 1 is kept. "Retest Within Reference Range; one result in range
     does not show recovery."
   - **Close case**: the Base shows *Case Closed* and, separately, *Closing notice: Received by
     HUD*. The HUD shows the case closed and the old task as history.
5. **Close (≈ 10 s).**
   - "Two demos: the patch demo shows the sensor concept, and the Base and HUD show the mission
     workflow. All data are simulated, nothing here makes a diagnosis, and every message to the crew
     needs a human approval."
