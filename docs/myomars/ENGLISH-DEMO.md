# MyoMars English demo: Mission Map + Health Monitoring overlay

This is the English, single-language version of the Mars Base used for the international project
video. Branch `feat/myomars-english-overlay`, draft PR
[SuperJCL/NASA-11-Mars-Discovery-Intelligence#5](https://github.com/SuperJCL/NASA-11-Mars-Discovery-Intelligence/pull/5).
It is not merged until the owner approves the English video material and the interaction.

All health data shown is **simulated**: shared contract demo fixtures, published by the data-replay
module. It is not the health-data teammate's data. LAN multi-device use is not verified.

## What changed

**Layout.** The Mission Map is always the background. Health Monitoring is an overlay on it.

| | |
|---|---|
| Size | About 85% of the viewport wide and 80% high. At 1440×900 the review needs no page scroll. |
| Top bar | Mission summary, relay status, device status, the run's real crew (no padding members), Collapse (Esc). |
| Left | Observation (one simulated sample; no invented history or trend); indicators against the individual baseline (summary features only, no raw sEMG waveform); compact chain Data Received → Signal Quality → Comparability → Comparison → Base Review; recent communications. |
| Right (fixed) | Decision area: conclusion, key evidence, the actual text that would be sent, the main actions and an inline review form with editable reason templates. |
| Full flow | "Full flow ⤢" opens the existing data-flow canvas inside the overlay; "← Back to overview and decision" restores it. Neither changes state, interrupts communication or resends anything. |

**Opening and collapsing.**

- After **Confirm Start EVA** the overlay opens once. From then on only the user opens it: new
  cases or other people's messages only notify (chip badge, mission-bar count, map chip), they
  never move the overlay or take focus.
- **Collapse (Esc)** only collapses it. **End EVA** (mission bar) and **Close case** (decision
  area) are separate actions.
- While it is open the map is inert (no click-through). Collapsed, the map works normally and
  analysis and communication keep running.
- The selected case, drafts and an open review form survive collapse, reopen and person switch.

**Crew position.** There is no position source. The crew marker is drawn at a **simulated position
near the task target** (≈ 90 m east of it), labelled "A-02 · simulated position · not tracked", with
its own legend row ("Crew · simulated position (no live tracking)"). It is shown only during an active
EVA, in the 2D map. A task target is never presented as the astronaut's position. Clicking the
marker, the "A-02 simulated position" chip or a pending-case chip opens the overlay at that person.

**Animation.**

- A data marker moves once along the compact chain, one hop per step the station reveals.
- Sending, HUD receipt and crew acknowledgement flash once in the dispatch tracker.
- While waiting for base staff, the HUD or the crew, nothing moves; the waiting party, the start
  time and the elapsed time are shown.
- No looping edges. Reduced motion, a background tab or the replay speed never change a result.

**Decision area by phase** (`data-phase` on `decision-panel`):

| Phase | Shows |
|---|---|
| analysing | Progress (step n of 4), no action; for a retest, the round-1 result kept unchanged |
| review | Conclusion, key evidence, the draft notice and retest text, Approve / Reject |
| (review form) | Reason templates (editable), reason, Cancel (draft kept), Confirm and publish |
| sending / dispatched | Per message: Relay accepted → Received by HUD → Acknowledged by Crew, only from real replies; who is awaited and since when |
| failed / deferred | The reason, Resend (same message) or "Close case early…" |
| reassessed | Round-2 result, round 1 kept, "original alert still open", Close case / Continue Monitoring (or another retest) |
| monitoring | "Decision recorded: Continue Monitoring", a quiet "Close case early…", no nagging |
| decided | Candidate rejected, nothing sent; Close case / Continue Monitoring |
| closed | Handling complete, who closed it and why, "Case Closed does not mean the astronaut is healthy or recovered", status-notice delivery |

**English only.**

- No i18n framework, no language switch, no new dependency.
- Event types, protocol ids, field keys, numbers and rules are unchanged.
- Contract sample labels changed, so `contracts/` was regenerated and `contracts:check` passes.
- Glossary: Mars Base, Mission Map, Health Monitoring; Awaiting Base Review, Received by HUD,
  Acknowledged by Crew; Retest, Incomplete Results, Unable to Assess; Continue Monitoring, Case
  Closed; Simulated Data, Simulated Analysis.
- "Within Reference Range" never means healthy or recovered. "Unable to Assess" never means
  normal. No new diagnostic terms.
- The HUD was already English. It shows the station's English notice, retest and status texts.
- Its vendored `myomars-hud/contracts-v1/` copy still carries the old Chinese protocol label. The
  HUD never displays that label: it uses the protocol the station sends.
- `e2e:two-end` checks that the station page, the HUD page and every station message carry no
  Chinese text.

## Start a clean English demo session

Old Chinese messages are never rewritten. A relay session that already contains them keeps them.
For the video, start from an empty session:

1. Stop the relay (Ctrl+C) and start it again. Without `--data` it keeps everything in memory only,
   so a restart is an empty session. With `--data <dir>`, start it with a new, empty directory
   instead.

   ```
   npm run relay -- --static myomars-hud
   ```

2. Start the station: `npm run dev`, or for the video the production build (shows a clean build id):

   ```
   npm run build && npm start
   ```

3. Open the station at `http://localhost:3000/?relay=auto` and the HUD at
   `http://localhost:8787/` (redirects to `/hud.html?mode=integration`). Reload both if they were
   already open. The HUD drops its stored snapshot when it sees a new relay session. The header
   shows "Relay online · session demo" and "Base duty officer · this window decides".
4. Use one station window. A second window is a read-only mirror by design.

## Video walkthrough (about 2 minutes)

1. **Mission Map.** 2D map, 3D terrain toggle, select Target B. Then "Review summary, start EVA" →
   Confirm Start EVA. The overlay opens once.
2. On the HUD: **Enter HUD**. It joins the run and waits for base messages.
3. **Collapse (Esc).** The map shows the crew marker at its simulated position. Reopen with the
   "A-02 simulated position" chip or "Health Monitoring ▸ Open".
4. **Dev entry (data replay)** → sample "Comparable change (full flow)" → "Replay and open Health
   Monitoring". The chain marker moves step by step; the decision area shows "Simulated analysis
   in progress", then the conclusion.
5. **Review.** Approve and send the retest… → pick a reason template → Confirm and publish. The
   tracker shows Relay accepted and Received by HUD (real receipt).
6. **HUD.** Acknowledge → View task → Start retest → Submit. The station shows Acknowledged by
   Crew, then "Retest result received · re-evaluating", round 1 kept.
7. **Re-evaluation.** "Retest Within Reference Range" with "the original alert is still open". Close
   case… or Continue Monitoring… → the HUD shows the status (Case closed by base).
8. Optional: **Full flow ⤢** and **← Back**; the quality-failed sample ("Signal quality failed") for
   the branch; "Grip meter not read (missing-value demo)" for Incomplete Results.

## Checks

| Command | What it covers |
|---|---|
| `npm run check` | Lint, typecheck, unit tests, production build |
| `npm run e2e:two-end` | Real station + real HUD through the relay, including the overlay, no page scroll and the English-only check (fresh relay) |
| `npm run e2e:mission` | Mission Map, overlay opening rules, crew marker, drafts across collapse, map failure isolation (fresh relay) |
| `npm run smoke:crew` | Standalone demo (no relay): the overlay, all decision phases, reduced motion, phone |
| `npm run smoke:station` | The legacy workbench at `/legacy/workbench` |
| `npm run test:hud` | The HUD teammate's own suites (standalone mode) |
