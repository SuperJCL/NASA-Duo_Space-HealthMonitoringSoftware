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
| Left, top (always) | **Case events:** Data source → Base analysis → Base review → HUD → Crew response → Retest → Reassessment, followed by two separate closure facts: "Case Closed" (a base decision) and "Closing notice: Received by HUD" (a HUD receipt). Each step reads Not reached, Processing, Base decision needed, Waiting, Stopped, Failed, Done or Not needed. A line says whom the case waits for and since when. |
| Left, below | The selected step's evidence and messages. "Base analysis" and "Reassessment" show the internal steps (Data Received → Signal Quality → Comparability → Comparison → Base Review). Then the indicator chart (one simulated sample, summary features only, no invented trend), then the collapsible communication log. |
| Right (fixed) | Decision area: case status, **Next:** (who acts and what), the conclusion, key evidence, the actual text that would be sent, the main actions and an inline review form with editable reason templates. |
| Full flow | "Full flow ⤢" opens the existing data-flow canvas in the left column. The decision area stays visible, so the review can be finished with the canvas open. Opening it changes no state, interrupts no communication and resends nothing. |

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

**Animation** (one-off, tied to recorded events, never timer-driven):

- Observation arrives: cyan marker Data source → Base analysis.
- Analysis finished: Base analysis → Base review.
- Approval sent (relay accepted): coral marker Base review → HUD.
- HUD receipt: green marker HUD → Base review.
- Crew reply: green marker Crew → HUD.
- Retest result: cyan marker Retest → Reassessment.
- Closing notice: sent, and receipt.
- Inside the analysis, a marker moves one hop per step the station reveals.
- The dispatch tracker flashes once on relay acceptance, receipt and acknowledgement.
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

## HUD: two layers (integration mode)

- **First layer** (large):
  - the base-published text, unchanged;
  - a "Now" line with the action really required;
  - only the buttons that are available (Acknowledge, View task, Start, Defer, Submit).
- **Second layer** ("Details" / "Task details", collapsed): the protocol and conditions, the station's
  instructions, basis, ids, receipt and acknowledgement state, and history.
- Finished or closed tasks stay as history with no buttons.
- No category is inferred from the noticeId, and no fatigue, recovery or medical content is added.

## Project introduction: English demo order (2–3 minutes)

Use one clean build and one clean relay session for every recording (see above). Station at
1440×900, HUD at 1280×800.

1. **(0:00–0:20) Mission Map.**
   - "This is the Mars Base. The Mission Map shows simulated targets near Lefroy Bay in Jezero crater, on
     NASA imagery, in 2D and 3D."
   - Toggle 3D terrain, return to 2D, select Target B.
2. **(0:20–0:35) Start EVA.**
   - "Review summary, start EVA" → read the honesty lines (simulated EVA, conditions unknown) →
     **Confirm Start EVA**. Health Monitoring opens once over the map.
   - On the HUD: **Enter HUD**. It joins the run and waits for base messages.
3. **(0:35–0:45) Collapse.**
   - Esc: the map shows A-02 at a *simulated* position (not tracked). Reopen from the chip.
4. **(0:45–1:10) Data in, analysis.**
   - Dev entry → "Comparable change (full flow)" → **Replay and open Health Monitoring**.
   - "One simulated sample from the data replay: summary features only, no raw waveform."
   - The marker enters Base analysis. Signal Quality → Comparability → Comparison fill in; the result
     moves to Base review.
5. **(1:10–1:35) Review.**
   - Right side: conclusion, evidence, the exact notice and retest text, "Next: Base staff: approve or
     reject".
   - Optionally open **Full flow ⤢**: the decision area stays.
   - **Approve and send the retest…** → pick a reason → **Confirm and publish**. The marker goes to the
     HUD; the HUD step waits for a real receipt.
6. **(1:35–2:05) HUD.**
   - The notice arrives (first layer): **Acknowledge** → **View task** → **Start** → **Submit**.
   - The station's chain turns Received by HUD → Acknowledged by Crew → Retest result received, then
     re-evaluation, with round 1 kept.
7. **(2:05–2:30) Decision.**
   - "Retest Within Reference Range — one result in range does not show recovery; the alert stays
     until a person closes it."
   - **Close case…** → the chain shows *Case Closed*, then separately *Closing notice: Received by HUD*.
     The HUD shows the case closed and the old task as history.
8. **(2:30–2:45) Close.**
   - "All data and analysis here are simulated; the base never diagnoses; every message to the crew
     needs a human approval."

## Checks

| Command | What it covers |
|---|---|
| `npm run check` | Lint, typecheck, unit tests, production build |
| `npm run e2e:two-end` | Real station + real HUD through the relay: overlay, event chain, review with the full flow open, HUD offline (no false delivery), no page scroll, English-only check (fresh relay) |
| `npm run e2e:mission` | Mission Map, overlay opening rules, crew marker, drafts across collapse, map failure isolation (fresh relay) |
| `npm run smoke:crew` | Standalone demo (no relay): the overlay, all decision phases, reduced motion, phone |
| `npm run smoke:station` | The legacy workbench at `/legacy/workbench` |
| `npm run test:hud` | The HUD teammate's own suites (standalone mode) |
