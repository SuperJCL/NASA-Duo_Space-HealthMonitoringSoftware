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

The module is pure: no React and no OpenLayers. It has 17 unit tests, plus
12 EVA-1 step tests (`eva-steps.test.ts`).

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

## EVA step management (EVA-1)

The HUD manages the **state** of each step. It never edits the
**procedure**: the step list comes from the scenario, and changing it or
adding scientific steps would need a separate planning confirmation, which
is not built. It is a simulated training workflow, not a certified EVA
procedure system.

- **State (`PlanItem`):**
  - `steps` holds per-step records (`todo`, `done`, `skipped` with a reason,
    an optional note);
  - `step` is the first unresolved step;
  - `paused` marks a paused current step;
  - `dropped` records who skipped a skipped action: `{by: "user", reason?}`
    or `{by: "replan"}`.
- **Actions:**
  - `complete-step` (current step, or any single step by index);
  - `skip-step` (a non-empty reason is required, up to 160 characters);
  - `pause-step` and `resume-step` (a paused step cannot be completed or
    skipped);
  - `set-step-note` (the user's own text, up to 280 characters, empty
    clears it; never an engine input);
  - `undo-step`;
  - `skip-task` (optional reason).
- **Completion:** when every step is resolved, the action is done if at
  least one step was done, and its simulated effort is committed. If every
  step was skipped, the action counts as skipped by the user and nothing is
  committed. Per-step effort is not modelled.
- **Undo:** one level, covering the last step change (done, skip, pause,
  resume, note). It also undoes a completion, which un-commits the effort.
  It is cleared when the next action starts, the action is skipped, or a
  constraint change or replan happens. A step change clears the replan
  Undo, so the two never mix.
- **Replanning:** an in-progress action keeps its step records, paused
  state and notes, and the impact text says "1 of 4 steps done, 1 skipped;
  those steps are kept". Dropped actions are labelled "dropped by replan"
  everywhere: timeline, plan summary, map markers, target buttons, cards,
  later replan impacts. A manual skip reads "skipped by you" with its
  reason.
- **HUD:**
  - The primary action reads "Complete step N" or "Finish action"; it
    becomes "Resume step N" while paused.
  - Pause sits beside it.
  - "More" holds Skip step…, Note on step…, All steps…, evidence, and Skip
    this action….
  - An inline form handles the reason or note (Enter submits, Escape
    cancels; focus returns to the primary action).
  - The step label shows "1 done · 1 skipped · 2 to do"; the step bar
    colours done green, skipped grey, current coral, and paused yellow.
  - The **Steps** panel lists every step with its state, reason and note,
    plus Mark done, Skip… and Note… buttons.

### EVA-1.1: closing details and correcting steps

- **Details and panels close where they open:**
  - the map summary's Details toggles the card's Level 2;
  - the card's expanded details end with "Hide details ▴";
  - each open EVA panel (Steps, Map, Caveats, Scenario controls, Log) has
    its own Collapse, and focus returns to its toggle;
  - More → "All steps…" toggles;
  - the header Evidence button toggles the evidence sheet. On wide screens
    the sheet starts below the header, so the button stays usable.
  - Escape closes the sheet wherever focus is, and focus returns.

  Closing anything changes no mission state.
- **Viewing is not reopening.**
  - ‹ › in the current card browse other steps read-only ("Viewing step 2 of
    4 · done … this does not change step 2"); the primary action becomes
    "Back to current step".
  - Reopening is a separate, confirmed state change: "Reopen step N…" in the
    card while viewing, or "Reopen…" in the Steps panel.
- **`reopen-step` / `reopenEffects`:**
  - A done or skipped step of the action in progress, or of a completed
    action, becomes not done. The note is kept, and a skip reason is kept as
    `previousReason`.
  - The current step becomes the first unresolved one.
  - Reopening a completed action returns it to in progress and releases its
    committed effort; completing it again commits it once.
  - An action in progress at that moment is set aside (planned again, steps
    kept) and continues afterwards.
  - Replan decisions are not changed.
  - The confirmation lists these effects and flags plan or effort changes.
  - Undo reverts a reopen.
- **The Steps panel** can show a completed action's steps (picker), with
  "Reopen…" only. Notes and marking apply to the action in progress.

### EVA-1.2: explicit step skipping; execution vs effort accounting

- **Skip step N…** is a visible control next to the primary action (it was
  under More).
  - The form says the step is recorded as skipped, not done ("its
    measurement is not made").
  - It requires a reason and offers quick reasons.
  - If later steps are unfinished, it shows a neutral caution: "Later steps
    … may rely on step N. This scenario has no step-dependency data: check
    before continuing." The caution stays visible on the next step. No
    dependency rule is invented.
- **Skip reasons can be corrected** (Steps panel → "Edit reason…") or the
  step reopened. Reopened steps keep a `history` of their earlier states
  and reasons.
- **Execution outcome** (`executionOutcome` and `executionText`):
  - An action whose steps are all resolved is "complete" if every step was
    done, and "partial" if some were skipped ("those measurements were not
    made").
  - Partial actions are labelled in the timeline ("done · 1 step(s)
    skipped"), on the map (badge ½, status "done · partial"), in the cards
    and in the Steps panel.
- **Effort accounting is stated separately as an assumption**
  (`ACCOUNTING_ASSUMPTION`): an action's whole estimated cost is committed
  when it ends, also with skipped steps, because per-step costs are not
  modelled. The HUD shows this whenever a partial action exists.
- **Reopening an ended action:** the confirmation has three sections
  (Execution, Simulated effort accounting, Feasibility after reopening).
  After confirmation, a `recheck` runs the existing engine at the effort
  available after the release.
  - If the plan still fits, a notice says so (Undo kept).
  - If not, or if the engine's order changed, the replanning dialog opens.

### EVA-1.3: direct past-step correction

- **The step checklist is always visible** in the current-action card, below
  the primary action. It used to be an optional "Steps" panel that started
  collapsed.
  - Each row shows the step's state (✓ done, – skipped, ▶ current, Ⅱ paused,
    ○ to do), its reason, note and history.
  - It also offers the row actions: **Reopen** beside every done or skipped
    step, Mark done, Skip…, Note… and Edit reason….
  - Completed actions can be picked when more than one action has steps.
- **Navigation vs status change:**
  - Clicking a step **views** it, read-only, as with ‹ ›; "Back to current
    step" returns.
  - **Reopen** changes its status.
- **Confirmation only when necessary:**
  - **Inside the action in progress,** Reopen is immediate and explained ("It
    is the current step again. Later done steps stay done. Its earlier state
    is kept in its history."), with Undo; no effort changes.
  - **For a completed action,** the three-section confirmation and the
    feasibility re-check remain, because committed effort and the plan
    change.
- **The optional Steps panel and More → "All steps…" are removed** (they
  duplicated the checklist).

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

## Conceptual mission sequence (MAP-2)

The plan is drawn as lines between the scenario-defined targets, in plan
order only, in 2D and 3D, and labelled "Conceptual mission sequence — not a
navigable route". A draft is drawn as a dashed "Draft order preview".

- **Chips:** "Seq n" next to each target gives its plan order; the rank stays
  in the diamond.
- **Selecting a connection** highlights its two tasks, shows the
  straight-line separation (Mars sphere, not a travel distance) and the
  real-DTM straight-line profile.
- **Shared state:** EVA progress, skips, reopening and replanning (with a
  preview of both options) all come from the shared mission state.

Details, tests and manual acceptance: `docs/MAP2_MISSION_SEQUENCE.md`.

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
