# MF-1 manual test script: map-first mission explorer

## Setup

Branch `mf1-map-first-ui`. Run:

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:3000 in a desktop browser at ≥ 1024 px wide. Turn
browser page translation **off** for the first pass.

## Steps

| # | Do | Expect |
|---|---|---|
| 1 | Load the page | There is no step wizard. The objective strip reads **"Simulated mission · 2026"** and "Evidence: latest verified in this dataset, through 2025-05-06 (not all NASA data)". It also shows "Reviewed ranking: unavailable · 4 feasible task(s) excluded pending review · 50 relationship(s) awaiting expert review" and the disclaimer (not a NASA mission, not an astronaut mission, not live telemetry). The map fills the middle. Four simulated actions sit below it |
| 2 | Look at the map and the "Layers & legend" panel | The light-blue traverse, three sample sites with dashed rings, a diamond for the last position, and a white cross for the Jezero centre. The legend explains the dashed ring as "coordinates inferred by cross-validation". It also says simulated actions are not drawn. There are no task markers and no Margin Unit outline |
| 3 | Zoom in on the samples, then click **Lefroy Bay** | A context card shows "Verified historical data · Historical rover sample site": M2020-949-26, location, elevation (reference surface inferred), cored 2023-10-13 / sol 949, "Coordinates (inferred)", and a PDS source link |
| 4 | Click **Show related evidence (1)** | The evidence drawer opens, scrolls to the Lefroy Bay hydrated-silica observation and outlines it. Press **Escape**: the drawer closes, the card is still open, and focus is back on the button |
| 5 | In "Select a feature", choose **Drive on sol 909** | The map centres on the drive. The card shows sol 909, 473.9 m (source attribute), "Date: Not stated by the source" and the dataset date 2024-07-03 |
| 6 | Untick **Perseverance traverse** | The traverse disappears and the drive card closes. Tick it again |
| 7 | Choose **Last position in dataset (sol 1176)** | The card warns: "Historical data, not live telemetry and not the rover's current position…" |
| 8 | Tick **Imagery and elevation-data extents**, then click a dashed outline | The extent card says whether the product is map tiles or download-only (DTMs) |
| 9 | Click the action **Abrade a margin rock…** | The card is highlighted and the details open: platform Rover · PIXL, SHERLOC, WATSON; cost 40 simulated points; feasibility; "Location: None assigned"; and a limitation box (provisional status, reviewed ranking unavailable, 2026 reassessment R4). The provisional rank is collapsed |
| 10 | Click **Choose this action (simulated decision)** | The panel says "Chosen as your simulated next action. Nothing is executed." The objective strip shows "Your simulated choice: …" |
| 11 | Drag the budget slider to **30** | Abrasion and coring show "Not feasible: Needs … points; simulated budget is 30". A warning says the chosen action is no longer feasible. Click **Reset constraints** |
| 12 | Open **Advanced workspace** | You see mission mode, the reviewed ranking (unavailable), the provisional ranking (collapsed; 3 pivotal inputs when opened), the comparison table with NE values, weights, task details and the review registry (50 pending). The limitations include the new sample-location sentence |
| 13 | Change a weight, close the drawer, reopen it | The weight, budget, selected action and selected feature are all unchanged |
| 14 | Select **Historical replay (advanced)** | The badge changes to "Historical replay (advanced)", with 11 later records hidden. The sample sites and traverse disappear from the map, and a note explains why. The registry shows 28. "Reveal later evidence" works. Switch back to **Present-day** |
| 15 | Keyboard: Tab to an action card and press Enter; Tab to the map and press + / arrow keys; Esc closes drawers | All of these work, and focus is visible |
| 16 | Repeat steps 3–14 with browser page translation **on** | No "removeChild" error, and the values still update |
| 17 | Resize to phone width (≈ 390 px) | No sideways page scroll. The order is map, feature card, action strip (scrolls sideways), action details. The layer panel opens with "Layers & legend". Drawers fill the screen |

**Report any step that does not match.** Known limitations are listed in
`DEVELOPMENT_LOG.md` under MF-1.
