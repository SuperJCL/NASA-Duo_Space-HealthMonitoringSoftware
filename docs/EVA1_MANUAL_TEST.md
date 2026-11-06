# EVA-1 manual test: individual step management

**Purpose:** check that first-time users can manage individual EVA steps
(complete, skip with a reason, pause and resume, note, undo) without losing
track of progress or effort. **No usability claim until this test has been
run with real participants.** The smoke test only shows that the controls
work.

## Build

Branch `eva1-step-management`. Install, build and start it:

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:3000/ at 1440 × 900. Repeat tasks 2 and 4 on a phone
or at 390 × 844 for at least two participants. Before task 1, the moderator
creates the suggested plan ("Fill with suggested order", Review plan,
Create plan), opens the EVA HUD and presses "Start action".

## Tasks (at least 5 first-time participants)

| # | Instruction (read aloud) | Completion event | Target |
|---|---|---|---|
| 1 | "Complete the current step." | Step 1 done | ≤ 5 s |
| 2 | "You cannot do the next step because the target is dusty. Skip it and say why." | Step 2 skipped with a reason | ≤ 30 s |
| 3 | "Pause the work, then continue." | Paused, then resumed | ≤ 15 s |
| 4 | "Write a short observation on the current step." | Note visible on the step | ≤ 30 s |
| 5 | "Oops, you marked the wrong step as done. Fix it." (Moderator first marks step 4 done in the Steps panel.) | Undo used; step 4 back to "To do" | ≤ 15 s |
| 5b | (EVA-1.1) "You pressed Complete by mistake on step 2; the work was not done. Put it back." | Step 2 reopened (with confirmation); note kept | ≤ 30 s |
| 5c | (EVA-1.1) "Look at step 1 again without changing anything, then return." | Viewing step 1, then Back to current step; no state change | ≤ 15 s |
| 5d | (EVA-1.1) "Open the Steps panel, then close it again." Repeat with Caveats and the evidence sheet. | Each closes from its own control or Escape | ≤ 10 s each |
| 6 | (Moderator triggers "Available effort drops to 50 points" and accepts the suggestion.) "What happened to the steps you already did, and to the coring action?" | Steps kept; coring "dropped by replan" (not "skipped by you") | ≤ 30 s |

## Questions

1. "Is your note scientific data?" Pass if they say it is their own text in
   a simulation.
2. "How much effort is committed now, and how much is still an estimate?"
3. "Could you change the procedure, for example add a step, from this
   screen?" Pass if they say no, and that it needs planning.

## Pass criteria

- **PASS:** at least 4 of 5 participants complete a task within its target.
- **PARTIAL PASS:** 2–3 do.
- **FAIL:** fewer than 2 do.

Any participant who believes notes or simulated steps are real EVA or NASA
data is an integrity failure.
