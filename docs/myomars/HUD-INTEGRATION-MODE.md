# HUD integration mode: what changed on `integration/myomars` (for the HUD teammate)

Your branch is untouched: `feat/myomars-hud` is still at the locked commit
`239d253048a594c2debb4d0021011465b1478bc6`. It was merged unchanged into `integration/myomars`. All
changes below are on the integration branch only:

- `myomars-hud/hud/base-client.js` (+19/−5)
- `myomars-hud/hud.html` (the progressive-disclosure layout below, the 3D scene glue and the design-language styles)
- `myomars-hud/scene/` (new: the illustrative 3D scene, source and generated bundle; see "Illustrative 3D scene" below)
- `myomars-hud/scripts/build.mjs` (your `dist/` copy now includes the design resources and the scene bundle)

To see the exact changes:

```
git diff 239d253 integration/myomars -- myomars-hud
```

## One rule: the changes switch on only with `?mode=integration`

| Open | Behaviour |
|---|---|
| `hud.html` (no flag), served by your mock base (`npm start`) | **Your standalone demo, unchanged.** Your suites still pass on the integration branch: `joint-test` 49/49, `hud-page-test` 46/46. |
| `hud.html?mode=integration`, served by the local relay (`npm run relay -- --static myomars-hud`, whose `/` redirects here) | Two-end run with the Mars Station. The HUD publishes only hud-role events, and the base decides everything. |

In integration mode the page also uses separate local storage keys (`myomars.hud.int.*`). Its
state never mixes with your standalone demo's.

## Standalone demo vs integration mode

| Area | Standalone (yours) | Integration mode |
|---|---|---|
| Background | Panorama image + walking (W / S / A / D) | Illustrative 3D scene, fixed standing viewpoint, drag to look, Reset view; the panorama image is the fallback (see "Illustrative 3D scene") |
| Run start | Intro: choose Scenario 1 / 2 / 3; the HUD publishes `scenario.start` (role `trigger`) | Intro: "Enter HUD" joins the run that the **data replay** started. The HUD publishes no `scenario.start` or `scenario.reset` (`ensureRun` returns the current run). |
| Observations | Walking segments every 3 s, plus patch-reconnect captures (`observation.submitted`, role `trigger`) | None: `submitObservation` returns `integration-mode`. The replay module is the single data producer. |
| Local patch panel | Left thigh, live sEMG/IMU traces, contact estimate, local sensor-fault (RED) | Hidden. It belongs to this page's standalone scenarios; in the Base/HUD demo the data come from the base's data replay. |
| Notice category | From the noticeId suffix (`-sensor`, `-ok`, otherwise "review" = AMBER "Muscle fatigue suspected") | Never inferred. Every station notice is kind `notice`; the level reads BASE NOTICE / BASE TASK / CASE CLOSED. |
| Notice title / finding | `notice.reviewReason` | "Base notice" and the station's astronaut-facing `text`, verbatim. `reviewReason` (the base's internal reason) is never shown. |
| Status line | Scenario wording (AMBER / RED / GREEN, fatigue, medical review) | A short headline from recorded state only ("Base notice · retest requested · <protocol label>", "Base update · case still open", "Case closed by base"). The station's full text is the first line of the card below, not repeated here. |
| Scenario 2 follow-up (recovery guidance, symptom check, medical review) | On | Off: it needs the fatigue category and the unconfirmed `hud.symptoms` extension (team decision pending) |
| Retest card | Body site and action from splitting `protocol.label`; knee-bend capture overlay; left-thigh widget | Protocol label first; conditions (target %MVC, posture, glove) and the station's instructions in "Task details"; no body site and no body map (the contract has no body-site field); capture overlay shows the protocol; left-thigh widget hidden |
| Retest result values | `contract/samples/retest-result.sample.json` (knee-bend placeholder) under the station's protocol | The shared contract fixture `contracts-v1/scenarios/change-retest.json` (from `main` `58b5a08`), **only when its protocol equals the requested one**; otherwise the HUD refuses. A sample is never relabelled. Default `retest-normal`; `&retestSample=retest-changed / retest-invalid` for testing. The card says "Stored shared sample … demo assumption". |
| Case reassessed or closed | Unchanged | The card shows the station's update text ("Base update"); the earlier notice moves to the second layer, whose handle reads "Details · Earlier notice · history"; the base decision is in Details; the button reads "Acknowledge update". A finished retest is "done (history)" ("Instructions (done)" in Task details). A task the base closed before any result is "not needed (history)". Both keep no Start / View / Submit / Defer buttons and no highlight. |
| Retest task without a notice | (not produced by your mock base) | Status line "Base task · retest requested · …", level BASE TASK |
| Waiting | — | Before the EVA: "Connected · waiting for the base to start the EVA (base staff confirm it on the station)". During it: "Connected · no base messages yet. … appear here only after base staff approve" |
| Who starts the run | Your intro / mock base (`scenario.start`, role `trigger`) | Base staff on the station ("Confirm Start EVA"): `scenario.start` from role `station` (contracts v1.1). Your client reads it like any start, so nothing changed in `base-client.js` for this. `station.eva.ended` (proposed extension) is ignored by your client; the run stays open after it. |

## Progressive disclosure (integration mode only)

Base messages (`#alert`) and the retest card (`#rcard`) have two layers. Standalone mode is unchanged.

| | First layer (always visible) | Second layer (collapsed `<details>`) |
|---|---|---|
| Base messages | The station's `text` (or its latest update `summary`), verbatim and large; one **Now** line; only the buttons available now (Acknowledge / Acknowledge update) | **Details**: base decision, case id · version · status, notice id, data time, sent time, device receipt, acknowledgement, basis lines, earlier notice / earlier updates of the case. The handle reads "Details · Earlier notice · history" once there is history. |
| Retest card | Protocol label (large); one **Now** line; only the buttons available now (View task, Start / Defer, Abort, Submit); a short state note (defer reason, rejection reason, SIMULATED sample) | **Task details**: status, protocol label and id, conditions (%MVC, posture, glove), the station's instructions, base update, result receipt, retest id · round · version, request time, and the simulated sample values before submission |

- The **Now** line is derived only from recorded state (acknowledgement, retest status, case status), for example
  "Acknowledge the base notice", "View the task to see the steps", "Start the retest when ready", "Submit the
  captured result", "No action needed · retest done", "No action needed · case closed". It never adds a health
  judgement, recovery advice, a symptom check or a medical step.
- **View task** (on the card or in the status line) opens Task details, so the steps are visible before Start.
- The open / closed state of each second layer is kept in the page's UI state (`S.more`): it survives the
  periodic re-render and incoming messages, and starts collapsed on each page load. The cards are rebuilt only when
  their content changes, so a chosen defer reason is no longer reset by a re-render.
- Finished or closed tasks stay visible as history (dimmed card) with no executable buttons.
- Defensive: the noticeId-suffix medical-review card (`-mr` / `-mrc`) is never shown in integration mode.

**Station texts are English now** (branch `feat/myomars-english-overlay`): the notice, retest
instructions, protocol label ("Standard grip 40% MVC · 30 s") and status notices your page shows come
from the station unchanged. Your vendored `contracts-v1/` copy still has the old Chinese sample
labels; your page never displays them (it uses the protocol the station sends), so it was left as is.

Everything else is your code as you wrote it:

- the relay client (publish, history, SSE, outbox, receipts, ack / defer / result);
- the retest capture flow;
- the reconnect handling;
- the panorama scene with walking (standalone mode; in integration mode it is only the image fallback, see below).

- **Data-link panel:** in integration mode it reads "Retest result link · stored simulated sample → HUD → Base", and its first node is "Sample (sim.)". The page's own standalone patch scenario is not part of the Base/HUD demo. The separate ASTRA patch demo (`astra-patch/`) is an independent program ([DEMOS.md](DEMOS.md)).

## Illustrative 3D scene (integration mode only)

In `?mode=integration` the panorama background is replaced by a real WebGL scene (three.js) seen from a **fixed
standing viewpoint**: ground with rocks and pebbles in front, dark sand dunes and low rises in the mid-ground, a butte
and a crater wall on the horizon, a butterscotch sky with distance haze, a small habitat (the base) and a light-toned
outcrop (the task target). Everything is procedural (noise heightfields, self-built rock and habitat geometry, textures
generated in code): no external assets, no network at run time. A faint caption in the bottom-right corner reads
**"Illustrative Mars scene · not a reconstruction of the task site"**: it is never measured terrain of the mission area.
Standalone mode is unchanged (panorama + walking).

| | |
|---|---|
| Movement | None: W / S / A / D walking is off in integration mode (no collision, no game system). |
| Look around | Drag on **empty scene area** (yaw ±35°, pitch −16…+7°); arrow keys do the same when no control has focus. The drag starts only on the scene canvas, so HUD panels, buttons and dialogs never start it. No auto-rotation, no idle sway. |
| Reset view | Button above the data-link panel. Eases back in 420 ms; instant under `prefers-reduced-motion` or `<html data-motion="reduced">`. "Locate base" (shown when the base is out of view) turns to the base the same way. |
| Markers | **Mars Base** (with the link label the HUD already shows, no distance) and the **task target** (the task title from the base's `scenario.start`, otherwise "Task target · simulated"). Click or Enter opens a small card; ×, Esc or a tap on the scene closes it. Cards state context only: no distances, no numbers, no decisions, no health wording. |
| Readability | Panels and both top bars sit on `--mm-glass`; the visor vignette stays. `scripts/hud-scene-check.mjs` measures text contrast against the brightest pixel behind each panel (body text ≥ 7:1, secondary ≥ 4.5:1). |
| Rendering | Sunlight, sky light, terrain cast shadows, rock contact shadows and distance haze are computed once into vertex colours (the sun and the eye never move), so every material is a tiny `ShaderMaterial`. Frames render **on demand only** (a drag, a resize, a Reset ease); nothing renders while idle, while `document.hidden`, or while the canvas is not visible. |

**Quality levels** (no real-time shadows at any level):

| Level | Pixel ratio cap | MSAA | Terrain grid (near · far) | Rocks · pebbles | Ground texture |
|---|---|---|---|---|---|
| `low` | 1 | off | 70×120 · 40×260 | 160 · 420 | 256² |
| `standard` | 1.5 | on | 100×176 · 56×400 | 340 · 900 | 512² |
| `high` | 2 | on | 136×240 · 72×560 | 560 · 1,700 | 1024² |

Auto picks `low` on a software renderer (SwiftShader, llvmpipe… read through `WEBGL_debug_renderer_info`) or with ≤ 4
logical cores, otherwise `standard`; `high` is opt-in. Override with `?quality=low|standard|high` or **Link & scene
tools → Quality** (kept per browser in `localStorage` key `myomars.hud.int.sceneQuality`; "Auto" clears it). The URL
parameter wins.

**Fallback.** If WebGL 2 is unavailable, context creation fails, the bundle does not load (or takes over 15 s), the
scene cannot start, a scene shader does not compile, or the context is lost, the page shows the existing panorama image (drag to look; no walking) and
the HUD works exactly the same. `?scene=off` forces it. The tools panel states the reason.

| Test hook | Values |
|---|---|
| `<html data-scene>` | `loading` → `webgl` or `fallback` |
| `<html data-scene-reason>` | `off`, `no-webgl`, `load-failed`, `load-timeout`, `init-failed`, `context-lost`, `shader-error` (fallback only) |
| `<html data-quality>` | `low`, `standard`, `high` (WebGL only) |
| `window.__hudScene` | `state`, `quality`, `frames` (render counter), `view()`, `reset()`, `api` (scene API: `setView`, `markerYaw`, `stats`, `profile(n)`) |

**Files and rebuild.** Source `myomars-hud/scene/mars-scene.src.js` (an ES module importing `three`); generated,
committed bundle `myomars-hud/scene/mars-scene.js` (about 354 KB minified, 101 KB gzip), loaded by `hud.html` only in
integration mode. After editing the source run `npm run hud:scene` (`scripts/build-hud-scene.mjs`, rolldown);
`node scripts/build-hud-scene.mjs --check` fails if the committed bundle is stale. three.js 0.186.1 is bundled from
`node_modules/three` under the MIT licence (`NOTICE`, `LICENSES/MIT-three.js.txt`) as a ShaderMaterial-only build: the
modules the scene never reaches (built-in material shaders, WebXR, PMREM) are stubbed, and the build fails if the
scene starts to import something that needs them. Check the scene with `node scripts/hud-scene-check.mjs` (relay
running; `OUT=/dir` writes screenshots, `PERF=0` skips the timings).

## Design language in integration mode

`hud.html` loads the shared `assets/myomars-fonts.css` and `assets/myomars-tokens.css` (copies made by
`npm run design:sync`; variables and fonts only, so standalone mode looks the same). Under `body.int` the HUD's own
colour variables map onto the semantic tokens: cyan `--mm-data` = data and connection, orange `--mm-action` = pending
human action and the primary button (Acknowledge, View task, Start, Submit, Enter HUD), red `--mm-alert` = explicit
alert, green `--mm-ok` = done, amber `--mm-caution` = degraded, dashed violet `--mm-sim` = SIMULATED. Panels use
`--mm-glass`, buttons are at least 36 px (40 px for the card actions), keyboard focus shows the shared 2 px cyan ring,
fonts are Geist (Geist Mono for identifiers). States keep their words and icons. Element ids and test hooks are
unchanged.

**The HUD's own effects are kept** (owner decision after the Windows check, 2026-11-15): the shared tokens restyle
colours, fonts, buttons, panels and spacing, but never remove or retime the HUD's animations. In integration mode:
- the cyan text glow;
- the status-badge glow and the red blink;
- the continuous base-marker ping;
- the queued-packet blink;
- the edge hint;
- the mini-map (base pip turns with the view), the position readout and the speed readout ("Still" while
  standing);
- on the panorama fallback (`?scene=off`, or no WebGL), the original waypoint markers (Dune C-1, Waypoint B-3,
  Return route) and the base distance.

Under reduced motion the animations stop. Base messages start below the top-right block so the mini-map stays
visible. `node scripts/hud-effects-check.mjs` checks all of this.

Still different from the panorama, by design or for lack of a reference:
- In the 3D scene the waypoints and the base distance are not shown. They exist only as panorama positions and
  walking-model distances; there is no original 3D placement for them, so none was invented.
- Suit power and O₂ read "Not reported" (nothing in the contract reports them). The previous values were fixed
  placeholders (82 %, 6.1 h); restore them only if the owner wants placeholders shown.
- Walking (W/S/A/D) is off in integration mode: the requested fixed standing viewpoint.

## Client option (`hud/base-client.js`)

`createBaseClient({ …, integration: true })`:

- `ensureRun` returns the current run and never publishes;
- `submitObservation` is refused;
- `view()` sets `kind: 'notice'`, title "Base notice", and uses the notice `text` (not
  `reviewReason`) for findings and history.

With `integration: false` (the default) the client is byte-for-byte your behaviour.

## Points that need your input (no change made without the team)

1. **Notice category (your V1-11):** we propose an explicit optional field set by the station,
   instead of noticeId suffixes.
2. **`hud.symptoms` and medical review (V1-13 / V1-14):** these need a contract decision before
   the station implements them.
3. **Demo protocol and body site:** your walking (`walk-auto-v1`) and knee-bend (`RT-P1`) data
   differ from the station's current integration sample (`std-grip-40`, grip). That grip protocol is
   only the current integration sample, not the protocol future data must use.
4. **Acknowledgement of status updates** (close / keep watching): keep it or drop it?

## How the integration is checked

```
npm run test:hud        # your two suites (standalone mode), result files restored afterwards
npm run e2e:two-end     # real station page + this page in integration mode (relay and station running)
node scripts/hud-scene-check.mjs   # the 3D scene and its fallbacks (relay running)
```

The station's ESLint skips `myomars-hud/**`; your suites are the check for this folder.

## Browser-demo link (`link=parent`, online demo)

`hud.html?mode=integration&link=parent&session=<id>` is how the online demo (`/demo`,
`docs/myomars/LIVE-DEMO.md`) embeds this page in a same-origin iframe.
- **Transport:** `hud/parent-link.js` gives `base-client.js` a `fetchImpl` that sends the same relay
  calls to the parent page over a MessageChannel. The client logic, receipts and buttons are unchanged.
- **Handshake:** origin, parent window, session and a per-load nonce.
- **Ordering:** calls made before the handshake wait for it.
- **Storage and samples:** the session comes from the URL; storage is memory only (a reload starts
  clean); the retest sample is read from the HUD folder.
- **Hidden frame:** loaded hidden (0×0 viewport), the page skips layout and frames until it has a real
  viewport. This also guards standalone mode, where it never happens.
- **Without `link=parent`:** standalone and relay integration behave exactly as before.
