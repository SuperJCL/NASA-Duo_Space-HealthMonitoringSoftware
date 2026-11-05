# BR-2 usability test: Lefroy Bay science briefing vs the MF-1 baseline

**Purpose:** find out whether first-time users understand the Lefroy Bay
science within 60 seconds. **No improvement may be claimed until this test
has been run with real participants.** Automated checks only show that the
answers are on screen; they do not show that people find them.

## Builds

- **A (baseline): MF-1,** branch `mf1-map-first-ui` (`e2b910f`).
- **B: BR-2,** branch `br-lefroy-briefing` (the BR-2 commit).

For each build:

```bash
git switch <branch>
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

Open http://localhost:3000 in a desktop browser at 1280 × 800 or larger, with
browser translation off.

## Participants and order

- **At least 5 first-time participants per build,** none of whom has seen
  the app.
- **Between-subjects** is preferred. Otherwise counterbalance: half see A
  first and half see B first, with a 10-minute break.
- **Do not explain the app** beyond the task script.

## Task script (read aloud, identical for A and B)

> "This app is about a real place on Mars called Lefroy Bay. Please find the
> answers to four questions and say them aloud as soon as you know them. You
> have 60 seconds."
>
> 1. What fills the spaces between the rock's grains?
> 2. What is still uncertain about how the rock formed?
> 3. Are the future investigations it discusses already approved NASA
>    missions?
> 4. Is the rover at Lefroy Bay now?

Start the timer when you finish reading. Stop at 60 s. Do not hint.

## Scoring (answer key, grounded in the report)

| # | Correct (counts as answered) | Source in the app (B) |
|---|---|---|
| 1 | **Silica** (possibly as a cement) | Measured: report header, p. 26-1 |
| 2 | **How it formed is uncertain:** probably a sandstone, but the setting is unknown (shoreline, river or lake, wind); less likely an altered igneous rock | "Still unknown" box: p. 26-1 |
| 3 | **No.** They are laboratory analyses discussed in the report, conditional on the sample being returned to Earth, which is not guaranteed | Proposed by the source: pp. 26-36/37; NASA page (2023-12) |
| 4 | **No (or "not known from the app").** The data are historical: the traverse continues past Lefroy Bay and ends at sol 1176, about 2.5 km west; nothing is live | Rover note: MF-0 traverse |

**For each participant and build, record:**
- the time to each correct answer, or "not answered";
- **misconceptions:**
  - treating an interpretation as a measurement (for example "it is a
    sandstone" stated as fact);
  - treating the future investigations as approved or scheduled;
  - believing the rover is at Lefroy Bay, or that the position is live;
  - treating simulated ideas as NASA plans;
- whether they opened a **Source** quotation;
- whether they needed to scroll the briefing panel.

**A participant passes** with all four answers correct within 60 s and no
misconception. **Target for B:** at least 4 of 5 pass. Report A and B side by
side: pass rate, median time per question, and misconception counts.

## After the timed task (optional, 2 minutes)

- "In one sentence, what is this app for?"
- "Which parts are NASA's measurements, which are the scientists'
  interpretations, and which are ideas from this app?" Score this 0–3 for
  correct separation.

## Notes for the moderator

- **On A (MF-1), Lefroy Bay** is reached through the map, the "Select a
  feature" list or a marker click. The action strip is visible.
- **On B,** it is reached from the site list or the map marker.
- **Keep the timer running** if a participant opens a drawer.
- **Record observations verbatim.** Do not summarise them as "improved".
