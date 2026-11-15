# EVA route & scouting (simulated planning layer)

Mission Glass has a third tab, **EVA route**, next to **Mission planning** and **EVA HUD**. It
answers one planning question on the verified CTX terrain around Lefroy Bay:

> With limited EVA time, suit O₂ and rover battery, is it worth sending a scout rover to check
> unobserved ground before the crew walks to a target, and does what it sees change the route or
> the target?

It is a prototype of EVA active scouting **built on existing techniques**: grid A*, a published
metabolic model (Pandolf et al. 1977, as implemented in Sol Atlas) and an expected-value comparison.
Robotic scouting and re-planning have prior work, so it makes no claim to be first. It is not
flight software, and its numbers are not mission rules.

## What it does

1. **Terrain.** The 3D view is the existing MAP-3A viewer, which shows the verified CTX DTM crop at
   1× by default. A tint per DTM post shows what is known about the ground, and route lines and
   points are drawn on top. The 2D plan shows the same layer over the CTX orthoimage. It is also the
   fallback when WebGL is unavailable.
2. **Target selection.** Choose a primary and an alternative target from the Mission Glass simulated
   targets A–C. You can use the selects, or click a target on the terrain to make it primary.
3. **Route generation.** A* on the *observed* map, in three modes:
   - **crew**: observed, crew-walkable ground only. This is the only kind of route a crew can be
     sent on.
   - **candidate**: may cross unobserved ground. It finds a shortcut worth scouting and can never be
     approved.
   - **rover**: ground the rover may drive.
4. **Resource budget.**
   - **Crew round trip.** Time and O₂ come from the Sol Atlas EVA model. This includes walking speed
     against grade, one 20 min science stop, the reserve and the suit-time verdict. Waiting suited
     while the rover scouts is charged at 150 W.
   - **Rover.** Time and energy for each leg, with a battery reserve on its return home.
5. **Scouting loop.**
   - The rover drives to the last observed cell before the shortcut's first unobserved cell, then
     observes within 250 m. This simulated sensor is the only path from the hidden truth to the
     map.
   - The map updates and the routes are re-planned. The loop repeats until a shorter crew route is
     confirmed, the benefit disappears, or the battery reserve would be breached.
6. **Options.** After each update the options are recomputed: scout, continue, detour, known route,
   switch to the alternative, or cancel.
   - Approval needs a safe outbound **and** return crew route on observed ground, plus an EVA verdict
     that is not no-go.
   - Every approval is re-checked at the moment it is made.
7. **EVA HUD.** The HUD shows the approved route's walk distance, EVA time and O₂ margin in one line.

The three ground-truth variants (simulator only) start from the same map, knowledge and budget. The
decisions below are computed, not scripted. They were checked by unit tests and by
`scripts/smoke-eva-route.mjs`:

| Variant | Hidden truth / setup | Computed result |
|---|---|---|
| A · Shortcut clear | Unobserved ground is walkable | Scout 6.51 > known 6.07. The rover confirms the shortcut in 5 posts after a 21 min wait, and continue scores 7.14. |
| B · Obstacle on the shortcut | Sand ripples cross the direct line. The rover can drive them; the crew may not walk them. | Same first decision as A. 7 posts, 36 min wait. Detour 6.67 > known 5.38 > switch 2.48. |
| C · Scouting too costly | Rover 2 km east on the traverse, 45 % charged | Scouting is feasible, but scout 5.68 < known 6.07, so the known route is chosen. |

## Real data, simulated data, model assumptions

| Kind | What | Where |
|---|---|---|
| **Real NASA data** | Elevations of the CTX DTM crop, unchanged | `public/terrain/ctx-lefroy-bay/`, `src/data/terrain/` |
| | CTX orthoimage | same |
| | Verified sample sites | `src/data/geo/` |
| | Perseverance's historical traverse | `src/data/geo/perseverance-traverse.json` |
| **Derived** | Slope from the 20 m DTM (central differences, rounded up). It smooths boulders and small scarps, so it is a lower bound and not a ground observation. | `src/lib/eva-route/grid.ts` |
| **Simulated (scenario)** | Habitat position | `src/data/prototype/eva-scouting.json` |
| | Surveyed areas: habitat disk, walking corridor, Lefroy Bay work area | same |
| | The corridor along the real traverse treated as surveyed walkable ground (an assumption) | same |
| | Rover start and charge | same |
| | Hidden hazards (the ripple field) | same |
| | Targets A–C (scenario-defined positions) | `src/data/prototype/mission-glass.json` |
| **Model assumptions (upstream)** | Sol Atlas EVA model: Pandolf rate with Mars gravity and suit penalty, 0.6 kg usable O₂, 25 % reserve, 20° slope limit, 20 min stop at 190 W, 8 h suit rating, 150 W seated | `src/lib/eva-route/sol-atlas-eva.ts` |
| **Model assumptions (simulated)** | Crew surface rule: firm ground or sand | `traversal.ts` |
| | Rover rules: ≤ 25°, can drive ripples | same |
| | Rover energy model: 1.5 m/s, 110 Wh/km, 4 kWh, 20 % reserve, 250 m sensor with no line of sight | `budget.ts` |
| | Waiting suited at 150 W | same |
| **Decision weights (simulated)** | Prior p = 0.6 that the shortcut is walkable | `assumptions.ts` |
| | Demo values: primary 10 and alternative 6. These belong to the target's **role**, not to the target's science. | same |
| | Costs: 0.5 per EVA hour, 16.7 per kg O₂, 0.1 per rover kWh | same |

The demo values are **not science scores**. They never come from the MDI decision engine and never
feed it: ranks, scores and the plan are unchanged by anything in this view. The EVA window and the
weights can be edited in the panel; each change creates a new state version.

## Code layout and interfaces

```text
src/lib/eva-route/      pure TypeScript (no DOM, no React, no three.js)
  sol-atlas-eva.ts      EVA O₂/time model (modified copy of Sol Atlas eva.js)
  pathfind.ts           masked A* (modified copy of Sol Atlas pathfinding.js)
  grid.ts               planning grid over the verified CTX crop, derived slope
  knowledge.ts          observed map (UNKNOWN is not safe), immutable versions
  traversal.ts          crew vs rover rules
  truth.ts              SIMULATOR ONLY: hidden truth + Sensor
  world.ts              surveyed-area mask, hidden truth, start cells
  planner.ts            route modes, route summaries
  budget.ts             crew sortie, rover legs
  assumptions.ts        decision weights (simulated)
  scouting.ts           next scouting step, best-case estimate
  options.ts            options with hard safety checks and values
  mission.ts            closed loop controller (snapshot without truth, versions)
  scenario.ts, repository.ts   scenario schema / loader (server side)
  overlay.ts            render-neutral tint + polylines for 3D and 2D
  tools.ts              tool-call entry point for future agents
src/components/route/   useEvaRoute (state, clock), RouteWorkspace, RoutePanel, RoutePlanCanvas
src/components/terrain/TerrainViewer.tsx   optional routeOverlay / showProfile / followSelection props
```

- **Terrain → planning:** `buildPlanningGrid(meta, verifiedHeights)`.
- **Planning:** `planRoute(grid, observedMap, from, to, { mode })`.
- **Resources:** `astronautSortie(grid, out, back, { waitS, params })` and `roverLeg(grid, route)`.
- **Loop:** `new Mission({...})`, then `options()`, `startScouting()`, `advance(dtS)` or
  `skipScouting()`, then `approve(id)` or `cancel()`.
- **UI:** `buildOverlay(...)` feeds `TerrainViewer`'s `routeOverlay` prop.
- **Future agents:** `toolDefinitions()` and `callTool(mission, name, input)` in `tools.ts`.
  - The tools are: `get_state`, `plan_route`, `eva_budget`, `estimate_scouting`, `evaluate_options`
    and `choose_option`.
  - Every input is checked with Zod, and `toolDefinitions()` exports JSON schemas.
  - No tool can reach the hidden truth.
  - A choice made on a stale `stateVersion` is refused.
  - No agent and no model call are wired in. An integration must keep the rules in `tools.ts`: an
    agent chooses among computed options, never changes their numbers, and never assigns science
    scores.

## Provenance of the code

| MDI file | Origin | Changes |
|---|---|---|
| `sol-atlas-eva.ts` | Sol Atlas `src/terrain/eva.js` (Apache-2.0, `9e1b2e0`) | TypeScript port. Removed the rover-ride option, the per-sample timeline, the radiation helper and the daylight checks. Equations and defaults are unchanged and checked against upstream outputs in `eva-route.test.ts`. |
| `pathfind.ts` | Sol Atlas `src/terrain/pathfinding.js`, via MarsScout `src/core/pathfind.js` | Hard no-go cells and slope limit, caller-supplied passability, no corner cutting, cell indices, TypeScript |
| `grid.ts` | MarsScout `src/core/grid.js` | Rewritten for the CTX crop: uses MDI's `lonLatToGrid` and `gridToLonLat`, and derives slope (MarsScout read upstream HiRISE slope) |
| `knowledge.ts`, `traversal.ts`, `truth.ts`, `planner.ts`, `budget.ts`, `scouting.ts` | MarsScout `src/core/*.js` | TypeScript. Sensor range 350 → 250 m for the 3 km crop. |
| `assumptions.ts`, `options.ts` | MarsScout `src/core/assumptions.js`, `options.js` | Values attach to target **roles** (primary / alternative) instead of fixed targets A/B; TypeScript |
| `world.ts`, `mission.ts` | MarsScout `src/core/world.js`, `mission.js` | Scenario offsets resolved from a verified anchor; MDI traverse lines; primary/alternative targets; `skipScouting()`; TypeScript |
| `eva-route.test.ts` | MarsScout `test/*.test.mjs` | Rewritten for Vitest on the real CTX crop (15 tests) |
| `scenario.ts`, `repository.ts`, `overlay.ts`, `tools.ts`, `src/components/route/*`, `scripts/smoke-eva-route.mjs` | New | — |

**Not brought in:**
- Sol Atlas: its HiRISE tile and data files (the tile does not overlap MDI's CTX crop: east edge
  77.366° E vs the tile's west edge 77.390° E), the global map, sound, recording, Netlify
  configuration and branding.
- MarsScout: the Science and Mission agents, the local agent server, the policy comparison, its
  Vite UI, and its Séítah/OEB scenario geography.

## Verification

- `npm test` includes `src/lib/eva-route/eva-route.test.ts`. It covers:
  - the upstream parity values;
  - the grid built from the unchanged heights;
  - the isolation of the planner from the truth;
  - the three variants;
  - the EVA-window limit;
  - approval refusals;
  - the tools (schemas, validation, no truth, stale choices refused);
  - the overlay.
- `npm run smoke:eva-route` (needs a running app; set `BASE_URL`) runs 50 browser checks:
  - terrain and overlay;
  - target selection;
  - route generation;
  - budgets;
  - the full B loop (scout → rover moves → observations → map update → re-plan → approve);
  - the 2D plan and the truth toggle;
  - the HUD line;
  - variant C and the EVA-window limit;
  - a phone layout.
