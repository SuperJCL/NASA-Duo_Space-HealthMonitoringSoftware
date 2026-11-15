# HUD integration mode: what changed on `integration/myomars` (for the HUD teammate)

Your branch is untouched: `feat/myomars-hud` is still at the locked commit
`239d253048a594c2debb4d0021011465b1478bc6`. It was merged unchanged into `integration/myomars`. All
changes below are on the integration branch only, in two files:

- `myomars-hud/hud/base-client.js` (+19/−5)
- `myomars-hud/hud.html` (+107/−29)

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
| Notice title / finding | `notice.reviewReason` | "Base notice" and the station's astronaut-facing `text`. `reviewReason` (the base's internal reason) is never shown. |
| Status line | Scenario wording (AMBER / RED / GREEN, fatigue, medical review) | Restates station facts only: notice text, protocol label, the station's status summary |
| Scenario 2 follow-up (recovery guidance, symptom check, medical review) | On | Off: it needs the fatigue category and the unconfirmed `hud.symptoms` extension (team decision pending) |
| Retest card | Body site and action from splitting `protocol.label`; knee-bend capture overlay; left-thigh widget | Protocol label and conditions (target %MVC, posture, glove) plus the station's instructions; no body site (the contract has no body-site field); capture overlay shows the protocol; left-thigh widget hidden |
| Retest result values | `contract/samples/retest-result.sample.json` (knee-bend placeholder) under the station's protocol | The shared contract fixture `contracts-v1/scenarios/change-retest.json` (from `main` `58b5a08`), **only when its protocol equals the requested one**; otherwise the HUD refuses. A sample is never relabelled. Default `retest-normal`; `&retestSample=retest-changed / retest-invalid` for testing. The card says "Stored shared sample … demo assumption". |
| Case reassessed or closed | Unchanged | The earlier notice is shown as "Earlier notice · history"; "Next" becomes "Base decision"; the button reads "Acknowledge update". A finished retest is "done (history)" with "Instructions (done)". A task the base closed before any result is "not needed (history)", with no Start / View / Submit / Defer buttons and no highlight. |
| Retest task without a notice | (not produced by your mock base) | Status line "Base task · retest requested · …", level BASE TASK |
| Waiting | — | Before the EVA: "Connected · waiting for the base to start the EVA (base staff confirm it on the station)". During it: "Connected · no base messages yet. … appear here only after base staff approve" |
| Who starts the run | Your intro / mock base (`scenario.start`, role `trigger`) | Base staff on the station ("Confirm Start EVA"): `scenario.start` from role `station` (contracts v1.1). Your client reads it like any start, so nothing changed in `base-client.js` for this. `station.eva.ended` (proposed extension) is ignored by your client; the run stays open after it. |

**Station texts are English now** (branch `feat/myomars-english-overlay`): the notice, retest
instructions, protocol label ("Standard grip 40% MVC · 30 s") and status notices your page shows come
from the station unchanged. Your vendored `contracts-v1/` copy still has the old Chinese sample
labels; your page never displays them (it uses the protocol the station sends), so it was left as is.

Everything else is your code as you wrote it:

- the relay client (publish, history, SSE, outbox, receipts, ack / defer / result);
- the retest capture flow;
- the reconnect handling;
- the 3D scene.

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
