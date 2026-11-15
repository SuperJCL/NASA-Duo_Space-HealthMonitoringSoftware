# MyoMars: two separate demos

MyoMars is shown with **two independent programs** and three interfaces. They share one visual
language (`design/DESIGN.md`) but no runtime files or messages. They share a theme (muscle monitoring for an
astronaut on EVA) but have **no communication link**: separate processes, separate data, started
separately. Neither the interface nor the project introduction claims they are connected.

| | Patch demo (explanatory) | Mars Base ↔ HUD (software loop) |
|---|---|---|
| Purpose | Explain what the sEMG/IMU patch is and how it works: acquisition, summary features, signal quality, scenarios | Show the mission and health workflow: Mission Map, simulated EVA, analysis, human review, HUD notice, retest, re-evaluation, case closure |
| Code | `astra-patch/` (Python 3.12+) | Next.js app (`/`), local relay (`relay/`), HUD page (`myomars-hud/`) |
| Processes | One terminal: the showcase page (`showcase serve`, port 8150) or the replay command; optional local API on port 8142 | Two terminals: relay (8787, also serves the HUD) and the Mars Base (3000) |
| Entry | Browser: `http://127.0.0.1:8150/` (showcase page, generated from the replay output), or the command line (JSON). The Swagger page at `/docs` is only an API explorer | Browser: `http://localhost:3000/?relay=auto` and `http://localhost:8787/` |
| Data source | Its own synthetic fixtures (12 summary windows) and seeded synthetic waveforms. No hardware, no recording. sEMG in µV, walking / quadriceps | The shared contract demo fixtures, published by the Base's **data replay** module. One standardised grip measurement (`std-grip-40`, %MVC, grip meter); the HUD's retest result is a stored simulated sample |
| Analysis | Its own processing; scenario names are test metadata, not diagnoses | Deterministic demo rules on the Base; nothing reaches the HUD without a human approval |
| Talks to the other demo? | **No** | **No** (the HUD and Base talk only through the local relay) |

Details: [PATCH-AUDIT.md](PATCH-AUDIT.md) (patch scope and data),
[ENGLISH-DEMO.md](ENGLISH-DEMO.md) (Base/HUD interface), and
[WINDOWS-ACCEPTANCE.md](WINDOWS-ACCEPTANCE.md) (how to run both on Windows).

## Project introduction (about 3 minutes)

1. **The patch, as a concept (≈ 40 s, patch showcase page at `http://127.0.0.1:8150/`).**
   - Say: "First, the sensor idea: a skin patch with sEMG and motion sensing. This independent demo
     uses synthetic data to show what it measures and how it separates signal problems from muscle
     signals."
   - `normal`: stable RMS (≈ 42–44 µV) and median frequency (≈ 84–86 Hz), quality acceptable.
   - `sensor_fault`: windows 3–4 are hatched *Unsuitable* (motion artifact, electrode contact) and
     not plotted. "A bad signal is reported as a bad signal, not as a muscle change."
   - Optionally `fatigue_suspected`: RMS rises and frequency falls. "The scenario name is a
     simulated label; the demo makes no diagnosis."
   - The same values come from `python -m astra_patch replay --scenario …` (JSON), for viewers who
     want the command line.
2. **The bridge sentence (≈ 10 s).**
   - "The patch demo stands on its own. The mission software next is a separate program; it uses its
     own simulated sample data, not the patch output."
3. **Mission Map (≈ 30 s, Base).**
   - Simulated targets near Lefroy Bay in Jezero crater on NASA imagery, in 2D and 3D. The 3D
     view uses the HiRISE elevation model (5 m mesh from the 1 m DTM, 1× true scale).
   - The right side is **Mission & Crew**: task, astronaut, then (during the EVA) what is known
     about the crew. Unknowns say "Unknown" or "No source in this demo". Planning scores are behind
     "Advanced planning".
   - Select Target B, review the summary, **Confirm Start EVA**. Health Monitoring opens over the map.
   - The HUD joins the run.
4. **Health loop (≈ 90 s, Base + HUD).**
   - Data replay sends one simulated measurement. The event chain shows Data source → Base analysis
     → Base review.
   - The decision area shows the conclusion, the evidence and the exact text to send. The human
     approves with a reason.
   - The HUD shows the notice over its fixed-viewpoint 3D Mars scene (illustrative, not the task
     site): Acknowledge → View task → Start → Submit.
   - The Base re-evaluates; round 1 is kept. "Retest Within Reference Range; one result in range
     does not show recovery."
   - **Close case**: the Base shows *Case Closed* and, separately, *Closing notice: Received by
     HUD*. The HUD shows the case closed and the old task as history.
5. **Close (≈ 10 s).**
   - "Two demos: the patch explains the sensing idea; the Base and HUD show the mission workflow.
     All data are simulated, the Base never diagnoses, and every message to the crew needs a human
     approval."
