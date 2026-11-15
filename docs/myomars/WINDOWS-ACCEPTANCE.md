# Windows acceptance guide (PowerShell)

How to run both MyoMars demos on one Windows PC from the final `main`. The two demos are **separate
programs** ([DEMOS.md](DEMOS.md)), so they are started and checked separately.

- **B. Mars Base ↔ HUD:** the software loop in the browser.
- **C. Patch demo:** the independent Python program, in a terminal.

Commands are for **Windows PowerShell 5.1 or PowerShell 7**. Run them in the repository folder unless
a step says otherwise.

---

## A. Get the code (update safely to the final `main`)

**Prerequisite:** Git for Windows (`git --version`).

**First time (no clone yet):**

```powershell
git clone https://github.com/SuperJCL/NASA-11-Mars-Discovery-Intelligence.git
cd NASA-11-Mars-Discovery-Intelligence
git log -1 --oneline
```

**Existing clone:** keep local work first. Never use `git reset --hard`, `git checkout -- .` or
`git clean` here; they discard changes.

1. See what is changed locally:

   ```powershell
   cd C:\path\to\NASA-11-Mars-Discovery-Intelligence
   git status
   ```

2. If `git status` lists changes, keep them first. Choose one:
   - **Option 1, stash them** (including new files):

     ```powershell
     git stash push --include-untracked -m "local changes before final main"
     git stash list
     ```

   - **Option 2, commit them on a separate local branch:**

     ```powershell
     git switch -c local/my-changes
     git add -A
     git commit -m "Local changes kept before updating to main"
     ```

3. Update to the final `main`, fast-forward only, so nothing is overwritten:

   ```powershell
   git fetch origin
   git switch main
   git pull --ff-only origin main
   git log -1 --oneline
   ```

   The last line must show the final `main` commit named in the hand-over report.

4. If `git pull --ff-only` refuses because your local `main` has its own commits, do not force
   anything. Keep your `main` as it is and check out the final version on a new branch:

   ```powershell
   git branch local/main-before-update main
   git switch -c accept/final-main origin/main
   ```

5. Later, to get back stashed changes (on the branch where you want them):

   ```powershell
   git stash list
   git stash apply "stash@{0}"
   ```

   `apply` keeps the stash as a backup; remove it only once you no longer need it.

---

## B. Mars Base ↔ HUD (software loop)

### Requirements

| Item | Version / note |
|---|---|
| Node.js | **22 LTS, version 22.18 or newer** (`node --version`). The relay runs `.ts` files directly with Node's built-in type stripping, which is enabled by default from 22.18. |
| npm | Bundled with Node (`npm --version`). |
| Browser | Chrome or Edge. The station is designed for a 1440×900 or larger window. |
| Free ports | 3000 (Mars Base), 8787 (relay + HUD) |

### Install and build (once per update)

```powershell
npm ci
npm run build
```

`npm ci` installs the exact versions from `package-lock.json` (a few minutes). `npm run build` makes
the production build that the demo runs.

### Start: two terminals

**Terminal 1, relay (also serves the HUD page):**

```powershell
node relay/server.ts --static myomars-hud --host 127.0.0.1
```

- Expected: `MyoMars relay … listening on 127.0.0.1:8787` and
  `HUD (integration mode): http://localhost:8787/hud.html?mode=integration`. Open the HUD with
  `127.0.0.1` instead of `localhost`; see "Pages" below.
- Call `node` directly as shown. Through the PowerShell `npm` wrapper, the `--` before the flags can
  be lost.
- `--host 127.0.0.1` keeps it on this PC (no firewall prompt).
- Without `--data`, the relay keeps everything **in memory only**.

**Terminal 2, Mars Base (production server):**

```powershell
npx next start -H 127.0.0.1 -p 3000
```

Expected: `Local: http://127.0.0.1:3000` and `Ready`.

### Pages

| Window | Address |
|---|---|
| Mars Base (station) | `http://127.0.0.1:3000/?relay=auto` |
| HUD | `http://127.0.0.1:8787/` (redirects to `/hud.html?mode=integration`) |

Use `127.0.0.1`, as above, in both windows. The servers listen on IPv4 only, and `localhost` can
resolve to IPv6 on Windows. Use **one** station tab. A second station tab is a read-only mirror by design.

### Start a clean demo session

1. In Terminal 1, press **Ctrl+C**, then start the relay again with the same command. In-memory
   mode means the restart gives an empty session.
2. Reload the station tab and the HUD tab (F5). The HUD drops its stored snapshot when it sees the
   new session.
3. Check the station header:
   - "Simulated Data · Simulated Analysis"
   - "Relay online · session demo"
   - "Base duty officer · this window decides"

   If it says "Read-only", close the other station tabs.

### Walkthrough: what to do and what you should see

| # | Do | Expect |
|---|---|---|
| 1 | Station: look at the page | Mission Map (2D) with Target A, B, C (coral diamonds, "SIM"). Mission bar: "Mission preparation". Health Monitoring is collapsed. ("ⓘ About" shows the build id.) |
| 2 | Optional: "3D terrain", then "2D map" | Local 3D terrain loads; back to 2D |
| 3 | Click **Target B** (target button or diamond) | Strip: "Task: Abrade and analyse a rock → Target B (simulated target …)" |
| 4 | **Review summary, start EVA** | Summary dialog: mission, task, simulated target, astronaut A-02, "not a real EVA", health conditions unknown |
| 5 | **Confirm Start EVA** | Phase "Simulated EVA in progress". Health Monitoring opens over the map **once**. "Case events" shows "Waiting for data…". |
| 6 | HUD: **Enter HUD** | "Connected · no base messages yet …" |
| 7 | Optional: station **Esc** | Overlay collapses. The map shows "A-02 · simulated position · not tracked" near Target B. Reopen with the "A-02 simulated position" chip or **Health Monitoring ▸ Open**. |
| 8 | Station header: **Dev entry (data replay)** → sample **Comparable change (full flow)** → **Replay and open Health Monitoring** | Event chain: "Data source" ✓, then "Base analysis" processing (steps 1 to 4, about 10 s). Inside the analysis: Data Received → Signal Quality → Comparability → Comparison. |
| 9 | Wait | "Base review · Base decision needed". Right side: "Indicators beyond the individual baseline variation", key evidence, the exact notice and retest text ("Draft only"), "Next: Base staff: approve or reject the candidate". The page itself does not scroll. |
| 10 | Optional: **Full flow ⤢** | The data-flow canvas opens on the left; the decision area stays visible on the right. **← Back to steps** returns. |
| 11 | **Approve and send the retest…** → pick a reason → **Confirm and publish** | Event chain: "Base review" ✓, then "HUD" (a receipt is needed before ✓). Tracker: "Relay accepted ✓", then "Received by HUD ✓" once the HUD confirms. "Crew response · Awaiting acknowledgement". |
| 12 | HUD | First layer: "▲ Base notice" with the base text and "Now: Acknowledge the base notice"; retest card "Standard grip 40% MVC · 30 s" |
| 13 | HUD: **Acknowledge**, then **View task**, **▶ Start retest**, wait for the simulated capture, then **Submit simulated retest result** | Station: "Crew response" ✓ "Acknowledged by Crew"; "Retest" ✓ "Result received"; "Reassessment" processing |
| 14 | Station: wait about 10 s | "Retest Within Reference Range". "Round 1 (kept): Indicators beyond …". "The original alert is still open …". Buttons **Close case…** and **Continue Monitoring…** |
| 15 | **Close case…** → reason → confirm | Event chain shows two separate facts: "✓ Case Closed · … · Base duty officer" and "Closing notice: Received by HUD". Decision area: "Handling complete … Case Closed does not mean the astronaut is healthy or recovered." |
| 16 | HUD | "CASE CLOSED". The retest card reads "done (history)" with no buttons. **Acknowledge update** confirms the final status. |

Optional extra checks:
- Sample **Signal quality failed** → the analysis stops at Signal Quality and branches to "check
  device / remeasure"; later steps are not run.
- Sample **Grip meter not read (missing-value demo)** → "Incomplete Results", nothing compared,
  nothing invented.
- **Continue Monitoring…** keeps the case open without nagging.
- **End EVA** (mission bar) changes the phase only; open cases stay open.

### Stop

Press **Ctrl+C** in Terminal 2 and in Terminal 1 (answer `Y` if asked "Terminate batch job").

---

## C. Patch demo (independent Python program)

- **What it is:** a command-line program that prints JSON, plus a **showcase page** (since the
  unified-experience round) that shows the same program output visually.
- The optional API has a Swagger page (`/docs`), which is an API explorer. It is not the showcase.
- **Independence:** it never contacts the relay, the Base or the HUD.

### Requirements

- **Python 3.12 or newer** (`py -3.12 --version`, or `python --version`).
- Free port 8150 for the showcase page; 8142 only for the optional API.

### Set up (once), from the `astra-patch` folder

```powershell
cd astra-patch
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

- The virtual environment stays inside `astra-patch\.venv`, which git ignores.
- Calling `.\.venv\Scripts\python.exe` directly avoids PowerShell script-activation settings.

### Run the scenarios (the actual demo)

```powershell
.\.venv\Scripts\python.exe -m astra_patch replay --scenario normal
.\.venv\Scripts\python.exe -m astra_patch replay --scenario fatigue_suspected
.\.venv\Scripts\python.exe -m astra_patch replay --scenario sensor_fault
```

- Each command prints one JSON document with **4 observations** and exits by itself, so there is
  nothing to stop.
- Switch scenarios by running the command with another `--scenario` value.
- To keep an output: append `| Out-File -Encoding utf8 normal.json`.

**Every output contains:**
- `"external_submission": "disabled"`;
- `"contract_validation": "not_performed"`;
- `"baseline_comparison": {"status": "not_available", …}`;
- `"research_indicator": {"status": "not_assessed"}`;
- a `missing_measurements` list.

| Scenario | `reported_summary_features` (rms µV / median Hz) | `signal_quality` |
|---|---|---|
| `normal` | 42/86, 43/85, 44/84, 43/85 | `fixture_reported_acceptable`, no flags |
| `fatigue_suspected` | 43/85, 48/80, 54/73, 61/66 (RMS up, frequency down) | acceptable, no flags. The name is test metadata; no fatigue conclusion is drawn. |
| `sensor_fault` | 42/86, 43/85, 132/18, 175/11 | windows 3–4 `unsuitable`, flags `motion_artifact` and `electrode_contact_fault` |

### Showcase page (visual; for the introduction video)

```powershell
.\.venv\Scripts\python.exe -m astra_patch showcase serve
```

1. Open `http://127.0.0.1:8150/`. It needs no network, Base, HUD or relay.
2. **Header:** "Synthetic data · Standalone demo".
3. **Left:** the patch diagram (left thigh), the sEMG and IMU cards and short synthetic waveforms.
   The waveforms are labelled "Synthetic illustrative signal from the demo's capture path" and
   "not the source of these numbers".
4. **Right:** switch `normal` / `fatigue_suspected` / `sensor_fault`. The window values and signal
   quality must equal the CLI table above.
   - In `sensor_fault`, windows 3–4 are hatched "Unsuitable" with their flags and are not plotted.
   - The name `fatigue_suspected` is shown as a simulated label, not a diagnosis.
5. Stop with **Ctrl+C**.

The data file `showcase\data\showcase.json` is committed. To regenerate it, run
`.\.venv\Scripts\python.exe -m astra_patch showcase build` (the result is identical).

### Tests

```powershell
$env:PYTHONPATH = "."
.\.venv\Scripts\python.exe -m pytest -q tests
```

Expected: **96 passed** (a warning may be printed).

### Optional: local API explorer

```powershell
$env:MYOMARS_ACQUISITION_TOKEN = [guid]::NewGuid().ToString("N")
$env:ASTRA_PATCH_DB = "$PWD\astra-patch.sqlite3"
$env:MYOMARS_ACQUISITION_TOKEN
.\.venv\Scripts\python.exe -m uvicorn astra_patch.service:app --host 127.0.0.1 --port 8142
```

1. The third line prints the token. Copy it.
2. Open `http://127.0.0.1:8142/docs` and choose **Authorize**, then paste the token. Requests
   without it return 401.
3. Example:
   1. `POST /api/myomars/v1/console` with
      `{"configuration":{"astronaut_id":"synthetic-console-only"},"mode":"summary_fixture","scenario":"normal"}`.
      It returns a `console_id` and a `round_id`.
   2. `POST /api/myomars/v1/console/{console_id}/actions` with
      `{"action":"start","round_id":"<round_id>","approved":true}`, then
      `{"action":"tick","round_id":"<round_id>","sequence":1}` (2, 3, 4).
   3. `GET /api/myomars/v1/console/{console_id}/observations?round_id=<round_id>`.
4. Stop with **Ctrl+C**, then delete the local database:
   `Remove-Item .\astra-patch.sqlite3*`.

### Running both demos on the same PC

- Ports do not collide: Base 3000 and relay/HUD 8787 for demo B; the patch replay uses no port,
  its showcase page 8150 and its optional API 8142.
- Use a separate terminal for the patch (three terminals in total if the API is running).
- Nothing needs to be stopped or reconfigured on either side, because the programs never talk to
  each other.

---

## D. Acceptance status

| Item | Status |
|---|---|
| Automated checks on the merged code (Linux CI-style run, production build) | **Passed**: `npm run check` (386 unit tests and build); `e2e:two-end` 48/48; `e2e:mission` 29/29; `smoke:crew` 72/72; `smoke:station` 121/121; `smoke:mission-glass` 228; `smoke:eva-route` 50; `smoke` 118; `test:hud` 49 + 46; patch `pytest` 84 passed; patch replay of all 3 scenarios exits 0 |
| Owner's manual acceptance on Windows (this guide, final `main`) | **Pending** |

**Not verified, and not part of this round's development:**
- multi-device LAN use (a HUD on another device through `http://<LAN-IP>:8787/`);
- relay restart with `--data` persistence (restoring a session after a relay restart; the default
  in-memory mode starts clean by design);
- login (the station uses the demo identity "Base duty officer");
- any Windows run (all automated checks ran on Linux).
