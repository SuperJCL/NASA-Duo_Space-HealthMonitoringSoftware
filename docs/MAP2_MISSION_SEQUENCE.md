# MAP-2: conceptual mission sequence (2D and 3D)

The user's plan is shown as lines between the scenario-defined targets,
**in plan order only**, on the 2D map and on the local 3D terrain. The lines
are labelled everywhere as **"Conceptual mission sequence — not a navigable
route"**. A draft is shown as a **"Draft order preview — not a navigable
route"**.

They are not routes, paths, travel distances, travel times or safety
assessments, and they are not NASA operational plans. Targets stay
scenario-defined positions.

## Source of truth

`src/lib/prototype/mission-sequence.ts` (pure, unit-tested) derives the
sequence from the **shared mission state**: the draft order, the plan items
and their states. It adds no state of its own. Planning, EVA and replanning
therefore always show the same sequence, in 2D and in 3D.

### Phases

| Phase | When | Drawn as |
| --- | --- | --- |
| none | no draft and no plan | nothing |
| draft | actions added, no plan created | dashed coral preview, chips "Draft n" |
| confirmed | after "Create plan" | solid lines, chips "Seq n", label as above |

- **Discard plan** removes the confirmed connections. The reducer keeps the
  draft, so its preview returns. Removing the draft actions draws nothing.
- **Numbers** are positions in the plan (or the draft). They are never the
  engine's rank: the rank stays in the target's diamond (MAP-1), and the
  legend says which is which.

### States

| Target state | Meaning | On the line? |
| --- | --- | --- |
| planned | in the plan, not started | yes |
| active | in progress | yes |
| done | completed: all steps done | yes |
| done-partial | completed with skipped steps (badge ½) | yes |
| skipped-user | skipped by the user, with the reason | no: keeps its number |
| dropped-replan | dropped by an accepted replan | no: keeps its number |

A connection's state comes from **where it leads**:

- history (green): to completed work;
- current (bold coral): to the current action, i.e. the one in progress, or
  else the next planned one;
- remaining (coral): to work still to do;
- infeasible (yellow, dashed): to work that does not fit the current
  constraints.

Skipped and dropped targets leave the line, so the line joins the
neighbouring actions in plan order. For example, Seq 1 → Seq 3 when Seq 2
was skipped.

### Reopen and replanning

- **Reopen** never reorders. Reopening a completed action changes only
  states; the plan order, the numbers and the connection ids stay.
- **Replanning preview:** the replan dialog shows both options as small
  plan-order diagrams.
  - The "Suggested" diagram uses the same `itemsAfterReplan` function as the
    reducer, so accepting draws exactly what was previewed.
  - "Keep current" marks the connections that no longer fit, using the
    dialog's own running fit.
- **Accept** changes only the remaining work. Completed history is kept, and
  dropped actions become "dropped by replan".
- **Undo** restores the previous sequence, as far as the existing undo
  allows.
- **Keep current plan** keeps the sequence and marks what does not fit.
- **No feasible alternative:** no new connection is drawn. Only the
  completed history remains, and the unfinished actions become dropped.

### Geometry

- **Missing positions:** a target without a scenario position gets no
  inferred one. Its connections are reported as gaps ("No connection drawn:
  … Positions are never inferred.") and are never bridged.
- **Straight-line separation:** great circle on the IAU2000 Mars sphere
  (`greatCircleDistanceM`, R = 3,396,190 m), from lon/lat only. It is
  always labelled "not a travel distance". No view and no vertical
  exaggeration can change it.

## 2D (OpenLayers) and 3D (three.js)

- **2D:** a sequence layer under the target markers.
  - One line per connection, with a small static arrowhead showing plan
    direction, and a "Seq n" chip under each target.
  - Clicking a line selects it. A target under the same pixel wins.
- **3D:** the same connections, draped on the DTM.
  - The lines follow the real DTM samples every 5 m along the straight line,
    5 m above the surface, scaled only for display at the current vertical
    exaggeration.
  - A cone shows plan direction, with "Seq n" chips under the targets.
  - Clicking a tube selects it.
  - A connection outside the 3 km DTM crop is not drawn and has no profile
    (`segmentCoverage`); the panels say so.
- **Selection is shared** (Mission Glass state) and kept when switching
  views. Selecting a connection:
  - rings both of its targets, and marks both task cards with a dashed
    outline;
  - opens a connection summary: plan order, a short explanation, and the
    straight-line separation.
- **The profile reuses the existing real-DTM tool:**
  - in 2D, the summary includes the profile chart, loading and checking the
    verified DTM only when needed;
  - in 3D, the viewer's profile panel switches to that connection (on wide
    screens it opens; on phones it stays as the user left it).
  - Both are labelled "Straight sampling line: not a route, not a safe path,
    no travel time or traversability."
- **Keyboard:** "Mission sequence on the map" in the planning panel lists
  targets in plan order with their state in words. The connection leading to
  each target sits just before it. Every row is a button: a target, or a
  connection.
- **EVA:** the HUD's optional Map panel shows the same sequence, with the
  connection to the current action in bold. Its caption names the line as a
  conceptual sequence.
- **Motion:** no animation and no glow. Lines are static, so reduced motion
  needs nothing extra.

## Tests

- **Unit** (`mission-sequence.test.ts`, `terrain.test.ts`):
  - draft versus confirmed, reorder, discard;
  - EVA history, current and remaining; completed with skipped steps;
    skipped by the user;
  - reopen keeps the order;
  - replan: preview equals the accepted result, keep, undo, no feasible
    alternative;
  - missing geometry;
  - Mars great-circle distances;
  - terrain coverage.
- **Browser** (`scripts/smoke-mission-glass.mjs`, MAP-2 section):
  - planning preview, reorder, confirmed sequence;
  - selecting a connection by clicking it in 2D and in 3D;
  - 2D/3D parity, and that 5× changes no distance;
  - the keyboard list;
  - discard;
  - EVA states, reopen and skip;
  - replanning accept, undo, keep and no-feasible;
  - phone and reduced motion;
  - translation.

## Manual acceptance

1. **Planning:**
   - Add Abrade, then Coring: a dashed "Draft order preview" appears
     (Draft 1 → Draft 2).
   - In Review, move Coring up and watch the preview reverse.
   - Create the plan: the line turns solid and the chips read Seq 1/Seq 2.
     Target C keeps its rank badge "2" while its chip reads "Seq 1".
2. **Connections:**
   - Click the line, or use "Mission sequence on the map" → "Connection
     1 → 2". Both targets and cards are highlighted, and the summary shows
     the straight-line separation and the DTM profile.
   - Switch to 3D: the same connection is selected and the profile panel
     shows it.
   - Switch to 5×: the separation does not change.
3. **Discard:** discard the plan; only the draft preview remains.
4. **EVA:**
   - Set the budget to 120, add Survey, Abrade and Coring, create the plan,
     and complete Survey. Open the HUD's Map panel: the connection to Abrade
     is bold.
   - Skip a step of Abrade and finish it: its marker shows ½ and its
     connection turns green.
   - Reopen a step of Survey: the order and numbers stay.
   - Skip Coring: it keeps "Seq 3" but leaves the line.
5. **Replanning:**
   - At a budget of 110 with Survey, Abrade and Coring, complete Survey, then
     Scenario controls → "restored to 100 points".
   - Compare the two diagrams, then accept: Coring is dropped by replan.
   - Undo restores the sequence.
   - Repeat with "drops to 50 points": no feasible alternative, and no new
     connection is drawn.
6. **Phone:** the map label, the list and the summary below the map; nothing
   overflows.

## Limitations

- **Untested coverage and gap states:** the scenario's three targets are all
  inside the DTM crop and all have positions. The "outside the crop" and
  "missing position" states are covered by unit tests and code paths only,
  not by a browser scenario.
- **Two numbers per target:** the rank in the diamond (MAP-1) and Seq n
  (plan order). The legend and the list explain the difference. At the EVA
  minimap's small size, chips and labels can overlap.
- **Mode coverage:** 3D is available in planning mode only, as in MAP-3A. The
  EVA HUD shows the 2D sequence, and connection selection is a
  planning-mode interaction.
- **No route information:** the lines carry no travel distance, time, path
  or safety information, by design.
