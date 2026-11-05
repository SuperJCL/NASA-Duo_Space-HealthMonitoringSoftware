# MDI 2.0 "Mission Glass": interaction prototype

Status: **prototype for manual usability review, 2026-11-05.** Branch
`mdi2-mission-glass-prototype`, route **`/mission-glass`**. The main app at
`/` (BR-2) is unchanged. This is not the full MDI 2.0 implementation.

Run it:

```bash
npm run build
```

```bash
npm start
```

Then open http://localhost:3000/mission-glass.

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
| **1** | Task card | Rank (existing engine, provisional), action, one-line rationale, status chip, "In plan" |
| **2** | Card "Details" | What, equipment, target (scenario-defined, with straight-line distance; no route), simulated resources, the conditions the priority depends on, limitations |
| **3** | "Evidence and sources" sheet | The engine's own reasons per criterion (including Not Evaluated); open questions with source quotations and review status; verified Lefroy Bay context (PDS page); assumptions; review-registry status |

## Shared mission-state contract (`src/lib/prototype/mission-glass.ts`)

The module is pure: no React and no OpenLayers. It has 9 unit tests.

- **`MissionState`:**
  - `mode` (`planning` or `eva`);
  - `budget` (simulated effort, the engine's `res-effort` constraint);
  - `selectedTaskId` (synced with the map target);
  - `draft` (ordered task ids);
  - `plan` (items of `{taskId, status: planned|active|done|skipped, step}`);
  - `replan` (`{reason, suggested}`);
  - `log`.
- **`missionReducer` actions:** select, toggle-draft, move-draft,
  use-suggested, set-budget, create-plan, set-mode, start-task,
  complete-step, skip-task, constraint-event, accept-replan, keep-plan,
  reset-plan.
- **`taskViews(...)`:** builds Level 1 and 2 views from **existing**
  `rankProvisional` / `rankReviewed` output. It computes no score.
- **Plan logic:** sums simulated costs; `fitInOrder` follows the engine's
  order and drops tasks that do not fit the remaining effort.
- **Replanning:** after a scenario event, the engine is re-run at the
  remaining effort. A prompt appears if the remaining plan no longer fits, or
  if the engine's order changed. Accepting or keeping the plan is the user's
  choice.

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

**Implemented** (working, covered by `scripts/smoke-mission-glass.mjs`, 41
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
    create plan.
- **EVA:**
  - current task with its priority line;
  - start, complete step, complete task and skip, with simulated progress;
  - simulated effort consumption;
  - warnings, including dynamic over-budget;
  - a minimal map that follows the current target;
  - plan timeline and event log.
- **Replanning:** a scenario event triggers the prompt, with reason and
  suggestion; accept or keep; no prompt when the plan still fits.
- **Other:**
  - the mode switch keeps a single mission state;
  - narrow-screen layout;
  - translation-safe text (simulated translation run).

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

- **In EVA,** the replanning prompt appears below the current-task card. It
  takes focus, but on short screens it can sit below the fold.
- **At crater zoom, the target labels overlap** in the small HUD map.
- **The orbital task is excluded** by the scenario (`excludedPlatforms`),
  which keeps the three surface actions. This is a scenario choice, not a
  scientific judgement.
- **Not tested** with screen readers, or by real users.
