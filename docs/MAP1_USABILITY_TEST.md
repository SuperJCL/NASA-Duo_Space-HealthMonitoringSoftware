# MAP-1 usability test: interactive spatial decision map

**Purpose:** find out whether the map now supports decisions, not just
display. The complaint from the Mission Glass acceptance review was that the
map felt static. **No improvement may be claimed until this test has been
run with real participants.** The smoke test (`npm run smoke:mission-glass`)
only shows that the behaviour works.

## Builds

- **A (baseline):** `main` at the MAP-0 merge, `f4724c7`.
- **B (MAP-1):** branch `map1-spatial-decision-map`.

For each build:

```bash
git switch --detach <commit-or-branch>
```

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:3000/ at 1440 × 900 with browser translation off.
Repeat tasks 1 and 4 on a phone, or at 390 × 844, for at least two
participants.

## Participants and procedure

- **At least 5 first-time participants per build;** between-subjects
  preferred.
- **Read only the task script.** Tell participants it is a simulated
  training prototype: the targets are scenario-defined positions, not real
  outcrops.
- **Time each task with a stopwatch.** Note wrong clicks, hesitations and
  questions.

## Tasks

| # | Instruction (read aloud) | Completion event | Target |
|---|---|---|---|
| 1 | "Using the map, find the target the system currently suggests first, and say which action it belongs to." | Names Target B / "Abrade and analyse a rock" | ≤ 15 s |
| 2 | "Set the effort to 50. Which target can no longer be done, and why?" | Names Target C (coring), with the reason it needs more effort than is available | ≤ 20 s |
| 3 | "Create a plan with the suggested actions, start it, and show me on the map where you are working now." | Points to Target B, marked "in progress" (Map panel in the EVA HUD) | ≤ 60 s |
| 4 | **Keyboard only** (no mouse or touch): "Select Target A and open its evidence." | Evidence sheet open for "Survey the outcrops" | ≤ 30 s |
| 5 | (Moderator: in the EVA HUD, finish the current action, then trigger "Available effort drops to 50 points" under Scenario controls and click "End remaining work": nothing else fits the 10 pts left.) "Go back to Planning. What happened to each target?" | Says B is done and C skipped; A not feasible with the 10 pts left | ≤ 30 s |

## Questions after the tasks

1. "Are the numbers on the map a scientific recommendation?" (Pass if the
   participant says they are provisional or not validated.)
2. "Which things on the map are real NASA data, and which are simulated?"
   (Pass if they separate the blue verified site and track from the coral
   simulated targets.)
3. "Did the map ever move or zoom in a way that confused you?"
4. "Did anything cover the part of the map you needed?"

## Recording sheet

| Participant | Build | Task | Time (s) | Completed? | Wrong clicks | Answers to questions 1–4 | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Pass criteria (per task, per build)

- **PASS:** at least 4 of 5 participants complete the task within the
  target time.
- **PARTIAL PASS:** 2–3 of 5 do.
- **FAIL:** fewer than 2 of 5 do.

Any participant who treats a provisional rank as validated, or a simulated
target as a real NASA observation, is an integrity failure, whatever the
timing.

## Not covered

- Screen readers. The keyboard path and accessible names are covered by
  automated checks only.
- Routes, travel times and terrain: out of scope for MAP-1.
