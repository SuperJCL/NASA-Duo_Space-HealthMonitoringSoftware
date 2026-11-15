# MyoMars design language

One product, two interfaces that share this language:

| Interface | Layout | Where |
|---|---|---|
| **Mars Base** | Operations console: map background, docked panels, a fixed decision area | Next.js app, `/` |
| **Astronaut HUD** | Immersive: a 3D Mars scene behind a helmet visor, few large readable panels | `myomars-hud/hud.html` |

They share tokens, type, colour meaning, buttons, panels, spacing and status wording. They do not
share code or runtime files: each module carries its own copy of the design resources.

**What the shared language does NOT do** (owner decision, 2026-11-15):
- It does not replace or simplify a module's own animations and effects. The Base keeps its
  event-chain markers, data-flow canvas, dispatch flashes and Mission Glass rise. The HUD keeps:
  - its cyan text glow;
  - the status-badge glow and red blink;
  - the base-marker ping;
  - the queued-packet blink;
  - the edge hint;
  - the mini-map, position and speed readouts;
  - the panorama waypoints in fallback mode.
- It does not cover the ASTRA patch demo (`astra-patch/`, including its showcase page). That
  program keeps its own look and is not synced or checked against `design/`.

## 1. Resources

| File | Purpose |
|---|---|
| `design/tokens.css` | All variables (`--mm-*`). The canonical source. |
| `design/fonts.css`, `design/fonts/` | Geist and Geist Mono, variable 100–900, Latin. SIL OFL 1.1 (`LICENSES/OFL-1.1-Geist.txt`). |
| `design/components.css` | `.mm-panel`, `.mm-btn`, `.mm-chip`, `.mm-input`, `.mm-dialog`, `.mm-label`, `.mm-num` for the plain-HTML pages. |

- `npm run design:sync` copies them to `myomars-hud/assets/` (as `myomars-*.css`).
- `npm run design:check` (part of `npm run check`) fails if a copy differs.
- Edit only `design/`, then sync.
- The Base imports `design/tokens.css` in `src/app/globals.css`. The Mission Glass names
  (`--mg-*`) are aliases of the tokens, so the existing components follow them.

## 2. Type and numbers

| Token | Size | Use |
|---|---|---|
| `--mm-text-2xs` | 11 px | Provenance and legal lines only |
| `--mm-text-xs` | 12 px | Captions, chips, axis labels |
| `--mm-text-sm` | 13 px | Secondary text, tables |
| `--mm-text-md` | 15 px | Body (Base default) |
| `--mm-text-lg` | 18 px | Panel titles |
| `--mm-text-xl` | 22 px | Page and dialog titles |
| `--mm-text-2xl` | 30 px | One key number per card |

- **Weights:** 400 body, 500 emphasis, 600 titles and buttons. No other weights.
- **UPPERCASE:** only for short section labels (`.mm-label`, 0.12 em tracking).
- **Fonts:** Geist; Geist Mono only for identifiers (event ids, hashes, build ids), never for prose.
- **Numbers:**
  - tabular figures (`.mm-num`, tables, timers);
  - a space between value and unit (`42 µV`, `86 Hz`, `3.2 km`, `18 %MVC`);
  - a true minus sign for negatives (`−2,385 m`);
  - thousands separators from 10,000 up;
  - only meaningful decimals (indicators 1 decimal, distances whole metres);
  - an unknown value is the word **Unknown** or "–" with a reason, never 0.
- **Time:**
  - `HH:MM UTC` for clock times;
  - `12 min` / `1 h 05 min` for elapsed time;
  - "simulated" next to any time from a simulated run.

## 3. Colour

**Surfaces:**
- deep blue-black background (`--mm-bg`);
- raised surfaces (`--mm-surface`, `--mm-surface-2`);
- glass panels over maps and scenes (`--mm-glass`, blur 14 px);
- 1 px hairlines (`--mm-line`, `--mm-line-strong`).

There is one border weight and no glowing borders on ordinary panels.

**Semantic colour:**

| Colour | Token | Means | Never |
|---|---|---|---|
| Cyan | `--mm-data` | Data, measurement, connection, geography, selection | An alert |
| Orange | `--mm-action` | A pending **human** action; the primary button | Decoration |
| Red | `--mm-alert` | An explicit alert or failure | "Attention please" |
| Green | `--mm-ok` | Done, received, within reference range | Healthy or recovered |
| Amber | `--mm-caution` | Degraded, waited long, an unknown that matters | Diagnosis |
| Violet, dashed | `--mm-sim` | "Simulated" / demo-only labels | Real data |
| Mars | `--mm-mars` | Scene colour (terrain, sky tint) | Any status |

**Colour is never the only signal.** Every state carries a word, and where space allows an icon
too (✓ done, ⏸ waiting, ! alert, ? unknown, ↻ retry). The HUD keeps its icons when it dims its
colours.

**Contrast:** body text ≥ 7:1 on `--mm-bg`; secondary text (`--mm-dim`) ≥ 4.5:1. Over a map or a
3D scene, text sits on a glass panel, never directly on imagery.

**Charts:**
- series in the order cyan → amber → violet → green;
- grid `--mm-chart-grid`, axis text `--mm-chart-axis`;
- a reference range is a soft green band (`--mm-chart-band`), labelled, never coloured "good";
- a quality problem shows as a hatched or greyed window with its reason, not as a red data point;
- a chart never invents points between real ones; missing data is a gap.

## 4. Components

**Buttons:**

| Kind | Look | Use |
|---|---|---|
| Primary | Orange fill, dark text | One per area: the next human action |
| Secondary | Outline (`--mm-line-strong`) | Other actions |
| Quiet | Underlined text | Low-weight links ("Close case early…", "About") |
| Selected | Cyan outline and soft cyan fill | Toggles, tabs |

- Minimum height 36 px (HUD 40 px).
- A disabled button is at 42 % opacity with a `not-allowed` cursor. Where the reason is not
  obvious, a line of text next to it says why.

**Chips and status pills:**
- a word, optionally an icon, and a semantic outline;
- simulated labels are dashed violet;
- a pill states a fact ("Relay online", "Received by HUD"), never a judgement.

**Panels:**
- radius 16 px (`--mm-radius-lg`); inner controls 10 px; small fields 6 px;
- spacing on the 4 px grid (`--mm-space-1…6`); panel padding 16–24 px.

**Forms:** inputs have a dark field, a 1 px outline and a cyan focus ring. Every input has a
visible label.

**Dialogs:**
- a strong glass card over a scrim;
- Esc closes it (Esc never closes a case or ends an EVA);
- focus moves into the dialog and returns to the opener.

**Focus:** one keyboard ring everywhere: a 2 px gap, then a 2 px cyan ring (`--mm-focus-ring`).
It shows on `:focus-visible` only.

## 5. Motion

| Token | Duration | Use |
|---|---|---|
| `--mm-dur-fast` | 120 ms | Hover and press |
| `--mm-dur` | 200 ms | Open or close; a state change |
| `--mm-dur-slow` | 420 ms | A one-off event marker (data arrived, message sent, receipt) |

- The tokens time **new** motion only. Animations a module already had keep their own timing and
  behaviour. Examples: Mission Glass rise 220 ms; HUD ping, blink and glow.
- New motion follows a **real recorded event** or a user action, once.
- No new idle loops, flowing borders or pulsing panels.
- A "waiting" state in new UI is still: it shows who is awaited and since when.
- **Reduced motion:** `prefers-reduced-motion` or `<html data-motion="reduced">` sets every
  duration to 0. One-off markers and scene easing are skipped, and the result is the same.
- **3D scenes:** they do not rotate on their own. The camera moves only when the user drags, and
  Reset view returns it to the default.

## 6. Layout per interface

**Mars Base (operations console):**
- the Mission Map is always the background;
- the right column is **Mission & Crew** (task, astronaut, connection and data freshness,
  pending health cases);
- planning scores live behind "Advanced planning";
- Health Monitoring is an overlay with the decision area fixed on its right;
- at 1440 × 900 the review needs no page scroll.

**HUD (immersive):**
- a fixed-viewpoint 3D Mars scene; the visor darkens the edges;
- panels are few, large and on glass;
- the first layer is the base text plus the current action;
- the scene never sits behind text without a panel;
- drag-to-look works only on empty scene area.

## 7. Words

- **English only.** Sentence case for buttons and titles.
- Say what is simulated: "Simulated Data", "Synthetic data", "simulated position".
- **Never use** diagnosis words (fatigue, injury, healthy, recovered) as a conclusion. Scenario
  names are labels ("Scenario: fatigue_suspected · simulated label, not a diagnosis").
- **Unknown stays unknown:** "Not reported", "No data yet", "Unknown". Never a guessed vital sign
  or device state.
