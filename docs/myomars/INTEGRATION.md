# MyoMars integration: two-end run (Mars Station ↔ HUD)

**Status (2026-11-15):** the two-end closed loop runs on the real pages through the local relay.

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

### Lint

`myomars-hud/**` is excluded from the station's ESLint. It is the teammate's sub-project, tested by
its own suites; three warnings come from their client code.

## Acceptance (this round): Mars Station ↔ HUD

`npm run e2e:two-end` (`scripts/e2e-two-end.mjs`) drives the real station page and the real HUD
page through the relay. **30/30 passed** against the dev server and against the production build.

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
- **Missing grip:** the sample `grip-missing` is published with `gripForceN: null`, and the station
  shows "结果不完整：缺少握力".
- **No errors:** no relay rejections or invalid deliveries on the HUD side, and no page errors.

**Other checks**

- `npm run check`: lint, typecheck, 33 test files / 375 tests, build.
- Standalone station smoke: `smoke:crew` 63/63 and `smoke:station` 121/121.
- HUD suites in standalone mode: 49/49 and 46/46.
- Replay command line exercised: `start`, `send grip-missing`, and `check` on a non-contract file
  (stops at "format").

**Not verified yet**

- Multi-device LAN access: addresses are printed, but no second device was tested.
- The health-data teammate's data. This is the next acceptance and is reported separately.

## Start (one machine; PowerShell or bash)

```
npm run relay -- --static myomars-hud      # relay on 8787, serves the HUD
npm run dev                                 # station on 3000
```

| Page | Address |
|---|---|
| Mars Station (relay mode) | `http://localhost:3000/?relay=auto` |
| HUD (integration mode) | `http://localhost:8787/` (redirects to `/hud.html?mode=integration`) |

**Start a run** in one of two ways:

- in the station, open "开发入口（数据回放）" and click "开始运行（A-02）";
- or run `npm run replay -- start`.

Then click "Enter HUD" on the HUD page, and replay a sample with "回放并打开面板" or
`npm run replay -- send change`.

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
   - Recommendation: keep `std-grip-40` for the demo. If the team wants walking or knee-bend data,
     add that protocol with its own baseline as a separate, reviewed change.
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
