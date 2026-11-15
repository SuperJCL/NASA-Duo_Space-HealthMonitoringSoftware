# HUD integration mode: what changed on `integration/myomars` (for the HUD teammate)

Your branch is untouched: `feat/myomars-hud` is still at the locked commit
`239d253048a594c2debb4d0021011465b1478bc6`. It was merged unchanged into `integration/myomars`. All
changes below are on the integration branch only, in two files:

- `myomars-hud/hud/base-client.js` (+19/−5)
- `myomars-hud/hud.html` (+202/−19 against `239d253`, including the progressive-disclosure layout below)

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
| Run start | Intro: choose Scenario 1 / 2 / 3; the HUD publishes `scenario.start` (role `trigger`) | Intro: "Enter HUD" joins the run that the **data replay** started. The HUD publishes no `scenario.start` or `scenario.reset` (`ensureRun` returns the current run). |
| Observations | Walking segments every 3 s, plus patch-reconnect captures (`observation.submitted`, role `trigger`) | None: `submitObservation` returns `integration-mode`. The replay module is the single data producer. |
| Local patch panel | Left thigh, live sEMG/IMU traces, contact estimate, local sensor-fault (RED) | Marked "Local patch · not used in integration mode"; traces and contact hidden; no local fault inference |
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
- the 3D scene.

- **Data-link panel:** in integration mode it reads "Retest result link · simulated sample → HUD → Base (patch not connected)", and its first node is "Sample (sim.)". The page's own patch demo is not used there, so the panel never suggests a patch link.

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
```

The station's ESLint skips `myomars-hud/**`; your suites are the check for this folder.
