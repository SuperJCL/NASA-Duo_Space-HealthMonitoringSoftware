# Restore audit: original effects after the unified-experience round

The owner checked the unified-experience branch on Windows (2026-11-15). The Base/HUD loop works,
but some original animations and display effects had changed.

**Decision:**
- The shared design language covers the **Mars Base and the HUD only**: fonts, colours, buttons,
  panels, spacing and status wording.
- Each module keeps its own animations and interactions.
- The ASTRA patch demo is not bound to the shared rules.

**Method:**
- Reference points: `main` `d52b463` (before this round), the teammate's branch
  `feat/astra-standalone-demo`, and the unified-experience branch.
- Only changes with a code reference were restored. Nothing was guessed.

**Commits:**

| Commit | What |
|---|---|
| `f54d2d9` | HUD: the HUD's own effects restored |
| `d7803c9` | Base: Mission Glass rise timing |
| `a9f3ecc` | Patch: unbound from the Base/HUD design; the teammate's CLI code and README sentence restored |

## Mars Base

| Original (`d52b463`) | Changed in this round | Result |
|---|---|---|
| Event-chain markers, data-flow canvas, dispatch-tracker flashes and one-off event animations (`motion.ts`, `EventChainPanel`, `FlowCanvas`, `HealthOverlay`) | Not changed (files untouched) | Kept. Checked by `smoke:crew` and `e2e:two-end` |
| Mission Glass pop-up rise: `mg-rise 220ms ease-out` | Retimed to the token (200 ms, other easing) | **Restored** to 220 ms ease-out |
| Colours, glass radius 18 px, focus | Mapped to the shared tokens (small colour shifts, radius 16 px, one focus ring) | Kept (allowed: colours, panels) |
| Target summary card on map click (planning scores) | Shown only in Advanced planning | Kept. The owner asked for scores off the default view; the card is unchanged inside Advanced planning |
| 3D terrain: contours on, profile open | HiRISE default, contours and profile on demand | Kept (owner asked for the new map) |

## HUD (integration mode; standalone mode was never changed)

| Original (`d52b463`) | Changed in this round | Result |
|---|---|---|
| Cyan text glow (`--glow`) on labels, status, headings | Replaced by a dark drop shadow | **Restored** |
| Status badge glow; red badge blinks | Glow removed, blink off | **Restored** |
| Base-marker ring pings continuously while a task arrives or the base reassesses | Limited to 2 pulses | **Restored** (continuous) |
| Queued result packet blinks | Blink off | **Restored** |
| Edge hint ("Locate base"): mars-tinted pill, glow | Glass pill, no glow or animation | **Restored** |
| Mini-map (radar) with base pip, position readout, speed readout | Hidden | **Restored**. The base pip turns with the 3D view. Base messages start below the block |
| Panorama waypoints: Dune C-1, Waypoint B-3, Return route (with distances) | Hidden | **Restored on the panorama fallback.** In the 3D scene: **no reference**, see below |
| Base marker label with distance ("2.40 km · Link OK") | Distance removed | **Restored on the panorama fallback.** In the 3D scene the base is not at that distance, so it shows the label only |
| Suit power 82 %, O₂ 6.1 h (fixed placeholder values) | "Not reported" | **Not restored, decision for the owner:** the contract reports neither value. Restoring means showing placeholders again |
| Walking with W/S/A/D, panorama background | Fixed viewpoint, 3D scene (panorama as fallback) | Kept: requested in this round |
| Buttons, panels, fonts, colours | Shared tokens | Kept (allowed) |

**No reference (not guessed):**
- Where the three waypoints would sit in the 3D world. They exist only as panorama coordinates and
  walking-model distances.

## ASTRA patch demo

| Teammate original (`feat/astra-standalone-demo`, identical to `main` under `astra-patch/`) | Changed in this round | Result |
|---|---|---|
| Command line: `replay` prints JSON; `check`; optional API with a Swagger page. **No visual page** and no HTML, CSS or JS. `SOURCE.json`: "no source React product UI ported" | `__main__.py` restructured (replay moved to `replay.py`, output unchanged); README sentence edited; `showcase` subcommand and page added | **Restored:**<br>- the teammate's inline `replay` code in `__main__.py` (now only additions on top of the original);<br>- the README sentence, verbatim.<br>JSON output is unchanged |
| — | **Showcase page** `astra-patch/showcase/` | **New in this round; not a restoration.** No teammate page exists to restore. It keeps its current look but is **unbound** from the shared design: its CSS is `showcase/assets/showcase-*.css`, owned by the page and no longer synced or checked by `design:check` |

**No reference (not guessed):**
- The teammate's upstream React product UI (`leonardoTT-debug/ASTRA-MyoMars` @ `91a464b`) was never
  in this repository, so nothing from it was changed or can be restored here.
- A separate teammate package, `myomars-flexarray-demo/` (React, 45-second guided demo), appeared
  on the new branch `origin/feature/myomars-45s-demo`. This round did not touch it. It is not part
  of `astra-patch/`. Whether the patch showcase should take its look is a design decision for the
  owner, not a restoration.

## Checks

`node scripts/hud-effects-check.mjs` checks the restored HUD effects. The other checks are listed
in `DEVELOPMENT_LOG.md`.
