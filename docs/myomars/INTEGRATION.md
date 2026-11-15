# MyoMars integration: one simulated EVA, from the task map to health monitoring (Mars Station ↔ HUD)

**Status (2026-11-15):**

- **Accepted baseline:** the user accepted the two-end run (station ↔ HUD) on shared simulated
  data, after running one main flow by hand.
- **Product update (same day):** the original 2D map, 3D terrain and task functions are no longer
  a separate system. They are now the **preparation phase of the same mission** on the base station
  (see "Mission integration" below).
- **Merge:** the user authorised merging PR #2 into `main` once all checks pass. Its name is
  "MyoMars 模拟数据双端联调基线（含任务准备到健康监测）".

- **Acceptance target:** the exact `integration/myomars` commit named in PR #2's description. A
  later change must be stated there, and the affected checks re-run.
- **Not claimed:** the health-data teammate's data, and multi-device LAN access. Both are follow-up
  tasks, see the end of this document.
- **HUD changes for the HUD teammate:** [HUD-INTEGRATION-MODE.md](HUD-INTEGRATION-MODE.md).
- **English demo + Health Monitoring overlay (branch `feat/myomars-english-overlay`, draft PR, not
  merged):** the station UI is English-only and Health Monitoring is an overlay on the Mission Map.
  See [ENGLISH-DEMO.md](ENGLISH-DEMO.md). The sections below use the English UI labels; the history
  sections keep the labels of their time.

## Mission integration (Mission Map → Health Monitoring)

**One station, one mission:** the Mission Map is always the background; Health Monitoring is an
overlay on it, opened and collapsed with "Health Monitoring ▸ Open / ▾ Collapse" in the mission bar
(or Esc). The bar always shows the mission, the phase, the EVA task with the astronaut, and the
health cases to review.

**Preparation** (overlay collapsed):

1. The existing Mission Glass, embedded unchanged (`embedded` prop). It covers:
   - 2D map and 3D terrain;
   - task selection on the map, target list or cards;
   - planning, EVA route and EVA steps.
2. Choose the astronaut. A-02 is the HUD device, so the only choice.
3. "Review summary, start EVA": the task, the simulated target, the astronaut, and the
   health-measurement conditions (unknown unless the measurement states them; no terrain-to-health
   inference; not a real EVA).
4. **"Confirm Start EVA"**: the only action that starts a run. The station publishes one
   `scenario.start` (contracts v1.1: the station role may publish it).

**During the EVA** (the overlay opens once per run; after that the user's choice for the run wins,
also across a refresh):

- The overlay: observation, indicators, compact analysis chain, communications and the fixed
  decision area (review, dispatch tracker, retest, status notices); the full data-flow canvas opens
  inside it. Layout and rules: [ENGLISH-DEMO.md](ENGLISH-DEMO.md).
- Collapsed, the map shows the crew at a labelled simulated position and the pending cases.
  Clicking one opens the overlay at that person's case. Nothing is ever opened automatically.
- Collapsing never ends the task, resets the run, or stops analysis or communication.

**Ending:**

- "End EVA" publishes `station.eva.ended` (proposed extension). It changes the phase only: no
  event is closed or deleted, and it is not a health statement.
- Events stay viewable and can still be handled.
- A new EVA is refused while events of the ended one are open.

**Isolation:**

- The map loads behind an error boundary with a working retry.
- A map code or asset failure shows a notice on the map; Health Monitoring keeps working.

**Data boundaries:**

- One fixed mission (`mission-glass-lefroy`, 3 tasks, simulated targets) and the demo astronaut
  A-02.
- Run = EVA: `scenarioId` = mission, `task` = chosen task and `targetId`, `astronaut` = executor.
  Cases, devices and protocols hang off the run as before.
- Health data still come from the replay module's simulated samples. A replay is re-assigned to
  the EVA's person, time and task as listed assumptions; the stored EVA minute becomes unknown.
- The replay drawer no longer starts runs. `npm run replay -- start` needs `--dev-run`.

**Kept as separate pages:**

- `/legacy/mission-glass` (full Mission Glass, unchanged);
- `/research`;
- `/legacy/workbench`.

**Preserved full map/EVA state:**

- commit `76e2888` (branch `eva-route-scouting`, Mission Glass at `/` with EVA route & scouting);
- checked on 2026-11-15 in a clean worktree: lint, typecheck, 304 tests, build;
- the annotated tag `archive/mission-glass-complete-2026-11-14` exists only locally: this session
  may push branches but not tags (HTTP 403). The command to create it is in the merge section
  below.

## Two-end baseline (earlier in this document)

- **Product interfaces:** there are two, the Mars Station and the astronaut HUD.
- **Trigger:** there is no Trigger page. The former Trigger teammate now provides health data, which
  is not on any branch yet.
- **Observations:** they come from the **data replay module** and use **simulated samples** only. No
  teammate data is connected.
- **Branches:** nothing here is merged into `main`. `main` is merged only after integration
  acceptance.

## Locked sources

| Part | Source | Status |
|---|---|---|
| Shared contracts | `main` `58b5a08` | Published, unchanged |
| Mars Station | `feat/myomars-station` `7638421` | Accepted canvas baseline |
| HUD | `feat/myomars-hud` **locked at `239d253048a594c2debb4d0021011465b1478bc6`** | PR #1 open, not merged. The teammate branch is not modified; it is merged into `integration/myomars` with `--no-ff` (merge commit `43e606d`). |
| Health data | none yet | Read from the teammate's branch when pushed, then checked; it is not merged first |
| Integration | `integration/myomars` | Relay, data replay, compatibility patches, acceptance script |

## Scope after the change

- **No Trigger or simulator product page:** no `/trigger` or `/simulator` route, and no deployment
  structure for a third front end.
- **The `trigger` role stays** in contracts v1 as the **data producer** role, so there is no
  protocol rename.
- **Data replay module (`src/lib/replay/replay.ts`):** pure code that both entry points use.
  - **Command line:** `npm run replay -- list | start | send <sample> | check <file>`.
  - **Station:** the hidden dev entry in relay mode, labelled "开发入口 · 数据回放（模拟样例）".
  - **What it does:** starts runs and publishes stored samples as role `trigger`. It never
    analyses, approves or answers for the HUD.
- **Single data producer in a two-end run:** every `scenario.start` and `observation.submitted`
  comes from the replay. The HUD publishes `hud.*` and `retest.result` only, and the acceptance
  script checks this.

## HUD `239d253` compared with the pre-checked `a76c0e8`

What the teammate changed:

- **Scenario 2 follow-up:** after an AMBER notice, the HUD shows the steps
  Acknowledge → Recovery Guidance → Symptom Check → (medical review) → existing retest.
- **New event type:** a **proposed extension** `hud.symptoms` (`contract/extensions/`). It is not
  in the shared contracts.
- **Medical review:** shown through notices with the noticeId suffixes `-mr` / `-mrc`, which is
  another suffix convention (their gap V1-14).
- **Mock base:** handles `hud.symptoms`, holds retest results back while medical review is
  pending, and adds a "medical clear" console button.
- **Faster demo pacing:**
  - message flight 0.8 s;
  - retest capture 3 s;
  - 3 s walking segments;
  - mock review 0.8 s.
- **Retest card text:** "returning to the habitat" is replaced by the station's own instructions.
  This **resolves** earlier difference 5 (the habitat text), so it is kept as the teammate wrote it.
- **Client API:** additive only (`submitSymptoms`, `deferNotice`, `activeCase().medical/symptoms/recoveryDefer`).
  The publish, history and stream calls the relay serves are unchanged.

Earlier differences that are still open in `239d253`:

| # | Difference | Status in `239d253` |
|---|---|---|
| 1 | The HUD starts runs (its scenario intro publishes `scenario.start`) | Unchanged |
| 2 | The HUD's own walking-segment simulator publishes observations (role `trigger`) | Unchanged |
| 3 | Notice kind inferred from the noticeId (a station notice `…-n1` becomes "AMBER · Muscle fatigue suspected") | Unchanged, and it now also opens the recovery and symptom flow |
| 4 | `notice.reviewReason`, the base's internal reason, used as the notice headline | Unchanged |
| 5 | Body site and action from splitting `protocol.label` ("标准握持 40% MVC" as a body site); fallback "Left quadriceps"; knee-bend capture overlay | The habitat text is fixed; the label split, the quadriceps fallback and the knee-bend overlay remain |
| 6 | The retest result sample is a knee-bend placeholder (`knee-bend-v1-sample-01`, 20 s, `gripForceN: null`) sent under the station's protocol | Unchanged; the sample note asks for "the shared base's sample" |
| 7 | Session `demo` | Same on both sides |

## Compatibility changes on `integration/myomars`

The HUD changes apply **only with `hud.html?mode=integration`**. Without the flag the page is the
teammate's standalone demo. Their suites still pass on the integration branch: `joint-test` 49/49
and `hud-page-test` 46/46.

### HUD (`myomars-hud/`)

**Client: `hud/base-client.js`, new option `integration`**

- **No data production:** no `scenario.start` or `scenario.reset`, and `submitObservation` is
  refused. The HUD joins the run that the replay started.
- **No inferred category:** every station notice is kind `notice`.
- **Astronaut-facing text only:** the notice title is "Base notice", and findings use the
  notice's `text`. `reviewReason` is never displayed.

**Page: `hud.html`, flag `?mode=integration`**

- **Intro:** the scenario choice is replaced by "Enter HUD" (join the run).
- **Local simulation off:** no walking segments, no patch-reconnect captures, no local
  sensor-fault inference. The local patch panel (left thigh, live traces) is marked
  "not used in integration mode".
- **Status lines restate station facts:** the station's notice text, the protocol label and the
  station's status summary. There is no AMBER/RED category, no "fatigue" and no "medical review"
  claim.
- **Recovery, symptom and medical-review steps are off.** They depend on the inferred fatigue
  category and on the unconfirmed `hud.symptoms` extension.
- **Retest card:**
  - shows the protocol label, the protocol conditions and the station's instructions;
  - no invented body site or action;
  - the capture overlay shows the protocol, not a knee bend;
  - the left-thigh widget is hidden.
- **Retest result values:** taken from the vendored **shared contract fixture**
  (`contracts-v1/scenarios/change-retest.json`, from `main` `58b5a08`), only when its protocol
  equals the requested one. Otherwise the HUD refuses: a sample is never relabelled.
  - The default fixture is `retest-normal`; `&retestSample=retest-changed | retest-invalid` selects
    another (development use).
  - The card states "Stored shared sample (recorded for ev1, used for this run as a demo assumption)".
- **Separate local storage keys,** so integration state never mixes with the standalone demo.

### Relay and station

**Relay**

- `/` redirects to `/hud.html?mode=integration`.
- On start, it prints the HUD addresses for this machine and the LAN.

**Station analysis: result completeness by protocol**

- **New outcome `result-incomplete`.** The standard protocol has three indicators: two sEMG
  features and the independent grip-meter reading. When some are missing:
  - the station lists which were received and which are missing;
  - it states that nothing was invented or zero-filled;
  - it compares nothing and makes no inference;
  - it keeps any existing alert;
  - the candidate is "按协议补齐测量" (complete the measurement per protocol).
- A completely missing feature set is still "analysis failed".

**Station notice**

- `basis` carries analysis evidence only. The internal workflow line ("生成待审候选…") is no longer
  sent.
- The reviewer's reason travels only in the contract field `reviewReason`, which the HUD does not
  show.

**Station dev entry**

- It is now the replay module's station entry:
  - start run;
  - sample choice;
  - intake checklist;
  - replay.
- Labels say "数据回放（模拟样例）", not "Trigger". The banner says two-end run, simulated samples,
  not the teammate's data.

### Lint and the HUD's own tests

`myomars-hud/**` is excluded from the station's ESLint. It is the teammate's sub-project; three
warnings come from their client code. Its own suites are the check for that folder, and they are
part of the integration verification: `npm run test:hud` (`scripts/hud-tests.mjs`). This runs
`joint-test` and `hud-page-test` in standalone mode, then restores their committed result files.

### Closing round (after the user's first hands-on run)

These are fixes, not new features. Each one re-ran the affected checks.

- **HUD, integration mode only:**
  - once the base has reassessed or closed a case, the earlier notice is "Earlier notice · history"
    and the decision is "Base decision";
  - a finished retest is "done (history)";
  - a task the base closed before any result is "not needed (history)", with no Start / View /
    Submit / Defer buttons and no highlight;
  - a retest task without a notice (for example after an incomplete result) shows "Base task ·
    retest requested" instead of "no base messages".
- **Station lease (bug):** in React development mode the station page mounts twice. The release
  from the first mount could reach the relay after the renewed claim, and hand the lease to another
  open station window. The reloaded window then became read-only a few seconds later. Nothing was
  ever processed twice, but the window lost control. The adapter now releases only if the page has
  no live subscription for that window id after one second. The regression test simulates the late
  release: it fails on the previous adapter and passes now.
- **Replay wording:** `std-grip-40` is labelled "当前集成样例协议（不是未来数据的唯一协议）". Other
  protocols are explained as "no station baseline yet", not as "non-standard".
- **`npm run test:hud`:** added, see above.
- **Two-end acceptance:** extended from 30 to 40 checks, see below.

## Acceptance (this round): Mars Station ↔ HUD

`npm run e2e:two-end` (`scripts/e2e-two-end.mjs`) drives the real station page and the real HUD
page through the relay. **40/40 passed** against the dev server and against the production build
(see PR #2 for the commit).

**Main flow**

1. Replay starts the run, and the HUD joins it.
2. A replayed observation is analysed, and the station stops at human review.
3. Approval with a reason, then the HUD shows the notice and the retest task.
4. HUD device receipts reach the station; the astronaut's confirmation is shown separately.
5. Retest capture, then one `retest.result` with the requested protocol and the shared simulated
   values.
6. The station re-evaluates (v2) and sends one receipt.
7. Human close, then the HUD shows "Case closed by base" with the station's text.
8. The astronaut acknowledges the final status.
9. Keep watching: a second case with `retest-changed` gives v2 "仍超出", the decision "保留关注", and
   the HUD shows "Base update …"; the case is not closed.

**Content rules on the HUD**

- No category inferred and no "fatigue" wording.
- No added actions (habitat, recovery, symptoms).
- The internal review reason is never shown, before or after the close.
- No invented body site.

**Robustness**

- **Duplicates:** a repeated HUD submit is ignored; re-posting the same result is a relay duplicate.
- **Station reload:** the case is restored and nothing is re-sent (station messages 6 → 6).
- **Second station window:** read-only; only one station client ever published.
- **HUD reload:** the final status is restored and nothing new is sent.
- **Single data producer:** all run starts and observations came from the replay; the HUD
  published only hud-role events.
- **Old run:**
  - a late `hud.ack` for the ended run gets `409 stale-run`;
  - the HUD shows the new run without the old case;
  - the station's card for the new run has no events.
- **Missing grip:**
  - the sample `grip-missing` is published with `gripForceN: null`;
  - the station shows "结果不完整：缺少握力" and says nothing was invented or zero-filled;
  - 15 s later the case is still open and nothing has gone to the HUD.
- **Refresh both ends with a pending task:** the relay's `lastSeq` is unchanged; the HUD still shows
  the task; the station shows the same step and still evaluation v1.
- **Keep watching, then close (same case):**
  - exactly one status notice each (`monitoring`, then `closed`);
  - HUD "Case closed by base" and CASE CLOSED; the station shows "事件已关闭".
- **HUD after the close:** the earlier notice and the retest instructions are history, and no task
  buttons are shown.
- **Refresh both ends after the close:** the same final state, and nothing re-sent.
- **Retest task without a notice, then closed before a result:**
  - the HUD shows "Base task";
  - after the close, the task is "not needed (history)".
- **No status notice published twice** in the whole run.
- **No errors:** no relay rejections or invalid deliveries on the HUD side, and no page errors.

**Integration verification (run all of these after any change):**

| Command | What it covers |
|---|---|
| `npm run check` | Station and relay: lint, typecheck, unit tests (including the lease regression and the relay end-to-end test), build |
| `npm run test:hud` | HUD teammate's suites, standalone mode: `joint-test` 49, `hud-page-test` 46 |
| `npm run e2e:two-end` | Real station page and real HUD page in integration mode, through the relay: 40 checks. EVAs are started and ended through the mission map. |
| `npm run e2e:mission` | Mission integration on the real pages: 2D/3D, task selection starts nothing, one human start, map ↔ health (drafts, events, relay log), events on the map with a jump, refresh, map failure, end EVA keeps events, read-only mirror, kept pages: 28 checks |
| `npm run smoke:mission-glass`, `npm run smoke:eva-route`, `npm run smoke` | Original Mission Glass page, EVA route, research workspace |
| `npm run smoke:crew`, `npm run smoke:station` | Standalone station (fallback entry): 63 and 121 checks |

The last results are stated in PR #2 with the commit they ran on.
- Replay command line exercised: `start`, `send grip-missing`, and `check` on a non-contract file
  (stops at "format").

**Not verified yet**

- Multi-device LAN access: addresses are printed, but no second device was tested.
- The health-data teammate's data. This is the next acceptance and is reported separately.

## Manual acceptance (three steps)

Start as below (one station window, one HUD window). Optionally keep
`http://localhost:8787/v1/health` open: its `lastSeq` is the relay's message count.

1. **Missing grip stays missing; the result is incomplete; the case is not closed.**
   1. Start an EVA on the Mission Map, then click "Enter HUD" on the HUD page.
   2. In "Dev entry (data replay)", choose "Grip meter not read (missing-value demo)", then click
      "Replay and open Health Monitoring".
   3. Expect, after about 10 s:
      - the decision area: "Incomplete Results: missing grip force", and the evidence says missing
        values are not invented or set to zero;
      - the chain stops at Comparison ("Incomplete Results: not compared"); in "Full flow ⤢" the
        Comparison node's evidence reads "missing (not provided)", never 0;
      - the case stays "Watch open · Awaiting Base Review" however long you wait;
      - the HUD still says "no base messages yet".
2. **Continue Monitoring, then close: HUD and station agree; no notice twice.**
   1. Open the HUD as `http://localhost:8787/hud.html?mode=integration&retestSample=retest-changed`
      (so the retest still differs).
   2. Replay "Comparable change (full flow)", approve, and on the HUD do Acknowledge → View task →
      Start retest → Submit.
   3. When v2 is ready, choose "Continue Monitoring…" with a reason. The HUD shows "Base update ·
      … Continue Monitoring …" and the case stays open.
   4. Then "Close case early…" with a reason. The HUD shows "Case closed by base" and CASE CLOSED;
      the station shows "Case Closed" and "Handling complete".
   5. In Communications for that case, each status notice appears exactly once (Continue
      Monitoring, then Case Closed).
   6. The HUD's earlier notice reads "Earlier notice · history", the retest card reads "done
      (history)", and there are no task buttons.
3. **Refresh both ends: tasks and results restored; nothing sent or processed twice.**
   1. Right after an approval (the HUD shows the retest task), note `lastSeq`.
   2. Refresh the station page and the HUD page (click "Enter HUD" again).
   3. The HUD shows the same task; the station shows the same step and the same evaluation version.
      `lastSeq` is unchanged.
   4. Repeat after the case is closed: both pages show the same final state, and `lastSeq` is
      unchanged.

## Start (one machine; PowerShell or bash)

```
npm run relay -- --static myomars-hud      # relay on 8787, serves the HUD
npm run dev                                 # station on 3000
```

| Page | Address |
|---|---|
| Mars Base (relay mode) | `http://localhost:3000/?relay=auto` |
| HUD (integration mode) | `http://localhost:8787/` (redirects to `/hud.html?mode=integration`) |

A clean English demo session (empty relay) is described in [ENGLISH-DEMO.md](ENGLISH-DEMO.md).

**Start the EVA** on the station:

1. On the Mission Map, choose a task: a target on the map, the target buttons, or a task card.
2. Keep the astronaut A-02.
3. Click "Review summary, start EVA", then "Confirm Start EVA".

The Health Monitoring overlay opens over the map.

Then:

1. Click "Enter HUD" on the HUD page. It joins the EVA and shows only "Connected · no base
   messages yet": it gets content only after base staff approve something.
2. Replay a sample with "Replay and open Health Monitoring" or `npm run replay -- send change`. The
   station analyses it for about 10 s and stops at "Awaiting Base Review".
3. In the decision area, click "Approve and send the retest…", pick or write a reason, then
   "Confirm and publish". The HUD now shows the notice and the retest task.
4. On the HUD: Acknowledge → View task → Start retest → Submit after the capture.
5. After the station's re-evaluation, close the case or choose Continue Monitoring. The HUD then
   shows the final status.
6. "End EVA" in the mission bar: open cases stay open. A new EVA can start once they are closed.

The station's dev entry lists the same steps. It only replays samples; it never starts a run.

The standalone station demo stays available at `http://localhost:3000/` (without `?relay`), and the
HUD's own standalone demo stays at `myomars-hud` → `npm start`.

## Decisions still needed

Each item gives the concrete difference and a recommendation. Nothing below was changed silently.

1. **Demo protocol and body site.**
   - The difference:
     - The station and the shared fixtures use `std-grip-40`: grip 40% MVC, 30 s, standing, EVA
       glove, forearm by the notice text, with the grip-meter reading as an independent
       measurement.
     - The HUD's own data are walking segments (`walk-auto-v1`, left thigh) and a knee-bend retest
       (`RT-P1`).
     - The station has no baseline for those protocols, so they are "not comparable".
   - Today's choice: the integration run uses the shared `std-grip-40`, and the HUD hides its
     thigh-specific visuals.
   - `std-grip-40` is **only the current integration sample**. It is not the protocol future data
     must use. Teammate data keeps its own protocol id and conditions. The station compares data
     only against a baseline for the same protocol, so a new protocol needs its own baseline (a
     separate, reviewed change), never a relabel to `std-grip-40`.
2. **Body site and device are not in the contract.**
   - Protocol has no body-site field, and `deviceId` is optional.
   - Recommendation: an additive optional `protocol.bodySite` and a required device id in the
     teammate's data. Until then, the replay marks the body site as an assumption and the device as
     missing.
3. **Missing grip-meter reading.**
   - Today: the result is incomplete, nothing is compared, and the human decides.
   - The alternative is a protocol variant without grip, where only the sEMG features are compared.
     That changes what the protocol means, so it needs a new protocol id and its own baseline, not
     a silent subset.
   - Recommendation: keep today's behaviour.
4. **Notice category (V1-11).**
   - The HUD needs a category for its colours and its Scenario 2 flow.
   - Recommendation: an additive optional field (for example `category: "measurement-change" |
     "acquisition" | "status"`) set by the station. Never inferred from IDs. Until then,
     integration mode shows a neutral "Base notice".
5. **`hud.symptoms` and medical review** (teammate proposal, V1-13 / V1-14).
   - Needs a team decision before the station implements it:
     - a new type in the shared contracts;
     - a station receipt and a human medical-review step;
     - a "clearance" message (not a noticeId suffix).
   - It stays off in integration mode until then.
6. **Retest result values in integration mode.**
   - Today: the HUD submits the shared contract fixture whose protocol matches the request.
   - Recommendation: the health-data teammate provides retest windows, read through the replay
     module. The HUD keeps publishing `retest.result` as the single source; it is not also sent by
     the replay.
7. **Demo assumptions the replay states:**
   - samples recorded for `ev1` are assigned to the run's astronaut A-02 (the station's A-02
     baseline has the same simulated values as EV1);
   - the replay time replaces the stored capture time.
8. **The astronaut can "Acknowledge" a status update** (close / keep watching).
   - The station records it; it does not reopen anything.
   - Decide whether status updates need an acknowledgement at all.

## Next acceptance: teammate data → replay → station analysis → HUD

When the health-data teammate pushes:

1. Fetch their branch and read the files there. Do not merge into `main` first.
2. Run `npm run replay -- check <file>` on each file. The checklist covers:
   - format and source;
   - person, body site, device;
   - units, sample rate, time;
   - protocol conditions;
   - missing values;
   - raw signals versus computed features.
3. **Raw sEMG / IMU** needs a feature-extraction step that is defined and validated first. The
   station today accepts only the summary features (median frequency Hz, RMS %MVC, grip N). Raw
   values are never written into those fields.
4. **Missing person, body site or conditions:** no baseline is applied. Any metadata the demo adds
   is marked as an assumption.
5. **Only after this:** add their samples to the replay module (source label = teammate data), then
   run the same two-end acceptance.

## Earlier preparation (reference)

**Relay API:**

- `POST /v1/sessions/:sid/events`, with headers `x-myomars-role` and `x-myomars-client`;
- `GET …/events?after=n`;
- `GET …/stream` (SSE, `Last-Event-ID`);
- `POST` / `DELETE …/station-lease`;
- `GET /v1/health`.

**Validation and gating:**

- checks against the shared Zod contracts, the publisher role and duplicate / conflicting eventIds;
- run gating (`stale-run`, `unknown-run`);
- same-host CORS for development.

**Station restore, lease and statuses:**

- History restore applies the station's own earlier messages without re-sending them.
- One station window holds the lease; the others are read-only.
- Relay hand-off, HUD receipt and astronaut confirmation are separate statuses.

**Limits:** no authentication, so this is for local / LAN development only.

## Merge plan and follow-up tasks

- **PR #2**, named "MyoMars 模拟数据双端联调基线（含任务准备到健康监测）", is merged into `main`
  through the normal PR flow once every check above passes. The user authorised this on
  2026-11-15. It does not claim the teammate's health data or multi-device LAN access.
- **Roll back:**
  - `main` before this merge is `58b5a08`;
  - the merge commit can be reverted with `git revert -m 1 <merge>`;
  - the complete standalone map/EVA state is commit `76e2888`.
- **Preservation tag:** this session cannot push tags. Create it once from any clone:
  `git tag -a archive/mission-glass-complete-2026-11-14 76e2888 -m "Complete Mission Glass map/EVA work before the MyoMars station integration"`,
  then `git push origin archive/mission-glass-complete-2026-11-14`.
- **Follow-up 1, health-data intake:** when the teammate pushes, read their branch, run
  `npm run replay -- check <file>`, then follow "Next acceptance" above. This is reported
  separately.
- **Follow-up 2, multi-device LAN:**
  - the station on one machine, the HUD on another device, through `http://<LAN-IP>:8787/`;
  - firewall and allowed origins (`--origins`) checked;
  - reported separately.
