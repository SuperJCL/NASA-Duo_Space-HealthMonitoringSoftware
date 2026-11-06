# MDI 2.0 "Mission Glass": interaction prototype

Status: **default entry point since MAP-0 (2026-11-05),** route **`/`**,
after MG-1 to MG-3 passed manual acceptance. The research workspace (BR-2)
moved to `/research`, and the old `/mission-glass` URL redirects to `/`. It
is still a simulated training prototype, not the full MDI 2.0
implementation. (Originally built on branch `mdi2-mission-glass-prototype`.)

Run it:

```bash
npm run build
```

```bash
npm start
```

Then open http://localhost:3000/.

## Design system (scoped to `.mission-glass` in `src/app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `--mg-bg` / `--mg-bg-2` | `#0b111c` / `#131d2d` | Deep space blue-grey canvas, with a radial gradient (not flat black) |
| `--mg-surface` | `#172235` | Selected card, plan rows |
| `--mg-glass` / `--mg-glass-strong` | `rgba(22,33,52,.74)` / `rgba(18,27,43,.92)` | Layered glass panels, with 14 px backdrop blur |
| `--mg-line` / `--mg-line-strong` | `rgba(160,186,218,.16 / .32)` | Hairlines, borders |
| `--mg-text` / `--mg-dim` / `--mg-faint` | `#eaf1f9` / `#a3b3c8` / `#74869e` | Text hierarchy |
| `--mg-coral` (+ `-soft`) | `#ff8066` | **Restrained accent:** primary actions, selection, simulated targets, the "simulated" label |
| `--mg-cyan` (+ `-soft`) | `#62d4e6` | **Geography and verified context:** fits-budget status, evidence links, verified context |
| `--mg-ok` / `--mg-caution` | `#84d8a6` / `#f1c878` | Done steps / over budget (used sparingly) |

**Typography** (Geist, unchanged):

| Use | Size |
|---|---|
| Body | 15 px |
| Meta | 13 px; **nothing below 13 px** |
| Card title | 17 px |
| Panel title | 20 px |
| HUD effort | 24 px |
| HUD current task | 32 px |
| Small caps labels | 13 px, 0.12 em tracking |

**Shape:** 18 px panel radius, 16 px card radius, 12 px controls.

**Motion** (all interaction-driven, none persistent):
- a 220 ms rise when panels and prompts appear;
- a 200 ms height reveal for Level 2;
- 150–300 ms colour and width transitions on progress and effort bars.

Motion is disabled under `prefers-reduced-motion`. There are no glows, pulses
or decorative sci-fi elements.

## Information hierarchy

| Level | Where | Content |
|---|---|---|
| **1** | Task card | Rank (existing engine, provisional), action, one-line rationale, cost, a plain-language feasibility line (MG-1: "Fits: 40 pts, leaving 60 pts.", "Doesn't fit your plan: …", "Not possible: …"), one add/remove toggle |
| **2** | Card "Details" | What, equipment, target (scenario-defined, with straight-line distance; no route), the conditions the priority depends on, limitations |
| **3** | "Evidence and sources" sheet | The engine's own reasons per criterion (including Not Evaluated); open questions with source quotations and review status; verified Lefroy Bay context (PDS page); assumptions; review-registry status |

## Shared mission-state contract (`src/lib/prototype/mission-glass.ts`)

The module is pure: no React and no OpenLayers. It has 17 unit tests.

- **`MissionState`:**
  - `mode` (`planning` or `eva`);
  - `budget` (simulated effort, the engine's `res-effort` constraint);
  - `selectedTaskId` (synced with the map target);
  - `draft` (ordered task ids);
  - `plan` (items of `{taskId, status: planned|active|done|skipped, step}`);
  - `replan`: an MG-3 `ReplanProposal` (`trigger`, `committed`,
    `available`, `remainingNeed`, per-action `impact` with a verdict and a
    plain-language explanation, `current` and `suggested` options,
    `noFeasible`, `reason`);
  - `retained` (set when the user keeps a plan that exceeds the available
    effort);
  - `previous` (the plan before the last accepted replan, for Undo; cleared
    when the mission moves on);
  - `notice` (a dismissible status message);
  - `log`.
- **`missionReducer` actions:** select, toggle-draft, move-draft,
  use-suggested, set-budget, create-plan, set-mode, start-task,
  complete-step, skip-task, constraint-event, accept-replan, keep-plan,
  undo-replan, dismiss-notice, reset-plan.
- **`taskViews(...)`:** builds Level 1 and 2 views from **existing**
  `rankProvisional` / `rankReviewed` output. It computes no score.
- **Plan logic:** sums simulated costs; `fitInOrder` follows the engine's
  order and drops tasks that do not fit the remaining effort. `planFit` and
  `addability` (MG-1) give the running total and the plain-language
  feasibility of each card.
- **Replanning (MG-3, `buildProposal`):** after a scenario event, the engine
  is re-run at the available effort (new budget minus committed effort).
  - **Committed effort** is the cost of completed actions. It is never
    replanned. **Remaining need** is the estimated cost of planned and
    in-progress actions.
  - Only remaining work is replanned: the suggestion is the engine's
    provisional order, restricted to remaining actions that fit.
  - A decision is requested if the remaining plan no longer fits, or if the
    engine's order changed. Otherwise a notice says the plan still fits.
  - **Accept** keeps completed actions and the steps of an in-progress
    action, marks dropped actions skipped (not deleted) and offers Undo.
    **Keep** changes nothing and, if the plan is infeasible, sets a
    persistent warning with "Review replanning".
  - **No feasible alternative:** when no remaining action fits, the options
    are "End remaining work" (remaining actions marked skipped) or keeping
    the plan anyway.

**Reused, unchanged:**
- **Engine and evidence:** `lib/decision` (engine, review modes),
  `lib/evidence` (scenario, registry), the review registry and `sources.json`.
- **Geography and briefing:** `lib/geo` (verified features), `lib/briefing`
  (the Lefroy Bay briefing view) and `lib/mission/mode` (present-day
  evidence).
- **`MarsMap`.** New, optional props:
  - `simulatedTargets` (a separate layer: coral dashed diamond, "SIM ·"
    label);
  - `chrome="minimal"`;
  - `initialOverlays`;
  - a `data-view-extent` attribute for tests.

  No engine, evidence, geo or briefing file changed. The engine grids are
  byte-identical to MF-1 and BR-2.

## Spatial decision map (MAP-1)

The planning map is a decision surface, not a backdrop. Everything it shows
comes from the engine and the shared mission state; there is no separate map
ranking.

- **Marker state (`src/lib/prototype/target-markers.ts`, pure, 5 unit
  tests).** `targetMarkers` combines each target with:
  - its task view (the engine's provisional rank and budget feasibility);
  - the mission state (draft and plan items).

  Each marker carries:
  - **badge:** the rank, "✓" when done, or "–" when not ranked;
  - **tone:** candidate, added, planned, active, done, skipped or
    infeasible;
  - **status:** a short state word;
  - **text:** plain-language priority and plan text.
- **One decision context.** Before a plan exists, the cards and the map use
  the engine at the whole budget. Once a plan exists, they use the engine at
  the effort still available (budget − committed), as the EVA HUD and
  replanning do. Cards become read-only once a plan exists, and show its
  state.
- **Markers (`MarsMap`).**
  - **Shape:** coral diamonds labelled "SIM ·", with the badge inside.
  - **Tone:**
    - dashed: candidate;
    - solid: added or planned;
    - filled: active;
    - green with ✓: done;
    - grey dashed: skipped;
    - yellow dashed: not feasible.
  - **Selection:** the selected target gets a white outline that grows in
    over 180 ms. Other targets stay visible, slightly dimmed.
  - **Verified data** stays blue and never carries a rank.
  - **The small EVA map** labels only the current target, so labels do not
    overlap.
- **Selection and focus.**
  - **A card or target button** selects the task and centres its target in
    the visible part of the map (clear of the panel and summary), with a
    280 ms transition. The zoom is clamped to the level that shows all
    targets, −0.5 to +1.
  - **A marker click** selects the task without moving the map.
  - **Reduced motion:** no transitions.
- **Map context.**
  - **Target buttons over the map** in provisional-rank order (rank, name,
    state; descriptive accessible names). They are the keyboard and touch
    alternative to the canvas.
  - **A closable target summary:**
    - scenario-defined position;
    - provisional priority and "not validated";
    - cost and feasibility;
    - straight-line distance, with no route;
    - Details (Level 2) and Evidence (Level 3).

    On wide screens it floats right of the zoom buttons; on phones it sits
    below the map.
- **Test hooks:** `data-sim-markers`, `data-selected-id` and `data-motion`
  on the map element mirror what is drawn.

## Actual vs scenario-defined data

| Data | Status |
|---|---|
| Lefroy Bay site, traverse, other sample sites, imagery | **Actual,** verified records from MF-0 (the PDS coordinate convention is inferred by cross-validation) |
| Lefroy Bay context in Level 3 (silica, open question, coring on sol 942) | **Actual,** BR-1 briefing items with PDS page references |
| The three tasks, their descriptions, instruments and gap links | Existing scenario data. The tasks are **simulated**; the gap links are AI-drafted, pending review |
| Ranks, rationale facts, feasibility, stability | **Existing engine output, provisional**, not scientifically validated. The reviewed ranking is unavailable |
| Effort costs and budget (100 points) | Existing **simulated** parameters |
| Targets A, B and C (positions as offsets from Lefroy Bay) | **Scenario-defined (simulated).** Not verified outcrops; never written into geo data |
| Task names, EVA step checklists, scenario events (effort to 50 or 100), warnings | **Scenario-defined** (`src/data/prototype/mission-glass.json`) |
| Astronaut position, telemetry, routes | **Not shown, not invented** |

## Interactions: implemented vs mocked

**Implemented** (working, covered by `scripts/smoke-mission-glass.mjs`, 101
checks):
- **Planning:**
  - ranked cards from the engine;
  - the simulated budget slider re-ranks live (at 50 points, coring becomes
    infeasible and the order changes);
  - Level 2 expand/collapse;
  - the Level 3 sheet (Escape closes it);
  - two-way map ↔ card selection (click a target on the map, or click a
    card);
  - a verified-feature popover;
  - plan builder: add or remove, suggested order, reorder, budget check,
    create plan. MG-1 flow: Compare → Add (one toggle per card) → Review
    (summary dialog with reorder and remove) → Create.
- **EVA (MG-2 glance order):**
  - current action with a provisional-priority chip, the current step in
    large type, one focused primary button, essential constraints and brief
    progress; map, caveats, scenario controls, log and skip behind optional
    controls;
  - start, complete step, complete task and skip, with simulated progress;
  - simulated effort consumption;
  - warnings, including dynamic over-budget;
  - a minimal map that follows the current target;
  - plan timeline and event log.
- **Replanning (MG-3):** a scenario event opens a fixed alert dialog:
  - constraint changed;
  - committed / available / estimated remaining;
  - impact on each action;
  - the suggested option vs keeping the current plan;
  - an always-visible decision footer.

  Escape does not dismiss it, and Tab stays inside. After the decision:
  an Undo notice, or a retained-infeasible warning. The no-feasible state is
  supported. If the plan still fits, a notice says so.
- **Other:**
  - the mode switch keeps a single mission state;
  - narrow-screen layout;
  - translation-safe text (simulated translation run, repeated while the
    review and replanning dialogs are open);
  - reduced motion (entry animations and transitions disabled).

**Mocked or simulated by design:**
- **Scenario controls** ("Simulate: available effort drops to 50 points") are
  demo buttons, not real events.
- **The task steps** are a scenario checklist; completing a step does
  nothing outside the app.
- **No timers, no telemetry, no positions.** Effort is consumed only when a
  task completes.
- **Persistence:** the plan lives in memory only and is reset on reload.
- **EVA framing:** the HUD uses the model's platforms (rover, Earth
  laboratory) for equipment. "Astronaut" is the framing of the simulated
  experience only.

## Known gaps for the usability review

- **On a phone,** the replanning dialog body scrolls; the decision footer
  stays visible, but the "Keep current plan" details are below the first
  screen.
- **MAP-1 limitations:**
  - **Map labels sit close together:** the three targets are about 100–250 m
    apart, so at the default zoom the labels of B and C can sit close
    together.
  - **No route, travel time, terrain or safety information** (out of scope).
    The straight-line distance is scenario geometry only.
  - **The selection transition is drawn on the canvas:** screen readers rely
    on the target buttons and the summary.
- **The orbital task is excluded** by the scenario (`excludedPlatforms`),
  which keeps the three surface actions. This is a scenario choice, not a
  scientific judgement.
- **Not tested** with screen readers, or by real users. The manual protocol
  is `docs/MG_USABILITY_TEST.md`.
