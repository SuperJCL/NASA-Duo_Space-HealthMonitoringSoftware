# MG-1 to MG-3 usability test: Mission Glass planning, EVA glance, replanning

**Purpose:** repeat the first manual review of `/mission-glass`, where all
three workflows were a PARTIAL PASS, on the refined build. **No UX goal may be
claimed as achieved until this test has been run with real participants.**
The automated smoke test (`npm run smoke:mission-glass`) only shows that the
controls and text are on screen; it does not show that people find them in
time.

## Builds

- **A (baseline):** the original prototype, commit `323622c`
  (`mdi2-mission-glass-prototype`).
- **B (refined):** branch `mg-refinement` (MG-1, MG-2, MG-3).

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

Open http://localhost:3000/mission-glass at 1440 × 900 (desktop), with
browser translation off. (Since MAP-0, Mission Glass is at `/`, and this URL
redirects there, so the same URL works for both builds.) Repeat task 3 on a phone or at 390 × 844 for at
least two participants.

## Participants and procedure

- **At least 5 first-time participants per build.** Between-subjects is
  preferred; otherwise counterbalance the order.
- **Read only the task script.** Do not explain the interface.
- **Time with a stopwatch,** from the end of the instruction to the
  completion event below. Note hesitations, wrong clicks and questions.
- **Tell participants it is a simulated training prototype,** not a real
  mission or flight software. That is also written in the interface.

## Tasks

| # | Instruction (read aloud) | Completion event | Target |
|---|---|---|---|
| 1 | "Plan the next investigation. Choose the actions you think are best within the effort budget, check the plan, and create it." | "Plan created" is shown | ≤ 60 s |
| 2 | (Start the plan in the EVA HUD, then hide the screen; show it again for 5 s.) "What is the next thing you have to do?" | Participant names the current step and the button to press | Answer after a 5 s glance |
| 3 | (Moderator opens Scenario controls and clicks "Available effort drops to 50 points".) "Something changed. Decide what to do with your plan." | Participant chooses "Use suggested plan" or "Keep current plan anyway" | ≤ 30 s |

## Questions after each task

1. **Task 1:** "Why is the top action ranked first? How sure is that
   ranking?" (Pass if the participant says it is provisional or not
   validated.)
2. **Task 1:** "Why could you not add one of the actions?" (Only when a card
   was blocked.)
3. **Task 2:** "How much effort is available, and how much does the rest of
   the plan need?"
4. **Task 3:** "Which actions were affected, and why?" "What happens to the
   work you already finished?" "Is the plan you kept possible?" (The last
   question only if they kept it.)
5. **All:** "Was anything here presented as real NASA data that you think
   was simulated?"

## Recording sheet (one row per participant and task)

| Participant | Build | Task | Time (s) | Completed? | Wrong clicks | Answers to follow-up questions | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Pass criteria (per task, per build)

- **PASS:** at least 4 of 5 participants complete the task within the
  target time, and answer its follow-up questions correctly.
- **PARTIAL PASS:** completed within the target by 2–3 participants, or
  completed by most but with wrong follow-up answers (for example, believing
  the ranking is validated).
- **FAIL:** completed within the target by fewer than 2 participants.

Also record any participant who believes the targets, steps or effort points
are real measurements. Count that as an integrity failure, whatever the
timing.

## Not covered

- Screen readers. Keyboard-only use was covered by automated checks only.
- Real EVA conditions: gloves, helmet displays, lighting and stress.
- Domain experts' judgement of the science. The ranking remains provisional.
