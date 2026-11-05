# MDI: map-first interaction and 3D feasibility assessment

Status: **assessment only, 2026-11-05.** No application code was changed,
UX-1 is not merged, and no implementation has started.

**Labels:**
- **[V]** verified live from this container today; the probe is listed in §10.
- **[V-earlier]** verified in an earlier milestone (see `NASA_MAP_RESEARCH.md`).
- **[A]** assumption, not verified.
- **[D]** decision needed from the owner.

## 0. Summary

1. **2D map-first is feasible with the current stack.** OpenLayers 10.11
   already includes everything needed: vector layers, selection, overlays and
   popups. No new dependency is needed for 2D.
2. **The four tasks are methods, not places.** No published footprint of the
   Margin Unit exists in our sources, so **no task can have a map marker.**
   The map can show only verified places: the rover's position, its traverse,
   sample sites, the crater centre and product extents. It can also show the
   Margin Unit's textual locator, but not as a polygon.
3. **Real elevation data for Jezero is available and checks out** [V]:
   - The **CTX DTM** is 20 m, 9.7 MB, float32 GeoTIFF.
   - The **HiRISE DTM** is 1 m and 1.84 GB. It is downloadable but not tiled.
   - **Accuracy:** at two PDS coring sites, the CTX DTM is within 2–3 m of
     the PDS elevations.
   - **Verdict:** local high-fidelity 3D is **feasible**, but only with an
     offline preprocessing step and one new rendering dependency [D].
4. **The Perseverance traverse is available as vector polylines with a
   per-sol attribute** [V]. That makes it possible to show the traverse as of
   the snapshot date. The dataset itself, however, was published after the
   snapshot (2024-07-03), which raises a temporal-policy question [D].
5. **The PDS sample coordinates match the traverse to within 2.5 m** [V]. This
   strongly suggests they use planetocentric, east-positive coordinates on
   the Mars 2000 frame, which partly resolves research task R3. All three
   sites lie on segments driven **after** the snapshot (sol 907), so they
   belong to the reveal only.

## 1. Reusable implementation

| Item | Reuse | Note |
|---|---|---|
| `lib/map/mars-projection.ts`, `mars-geodesy.ts` (+tests) | Unchanged | The same Mars 2000 sphere (R = 3,396,190 m) as every product below [V] |
| `lib/map/trek-layers.ts`, `create-trek-source.ts`, `initial-views.ts` | Unchanged; add entries | The traverse is also a Trek WMTS (PNG raster) [V], but we would render the vector version |
| `components/map/MarsMap.tsx` | Extend | Add a `VectorLayer`, `Select`/click handling and an `Overlay`. The map is currently a self-contained island: it needs `selectedId` and `features` props and an `onSelect` callback. Its basemap and overlay UI can stay |
| `MarsMapLoader.tsx` (dynamic, `ssr:false`) | Unchanged | A 3D viewer would use the same pattern |
| `lib/evidence/*`, `lib/decision/*`, data, registry | Unchanged | The map reads engine output. Nothing geographic feeds the engine |
| `RankingIntegrity`, `DecisionSection` parts, `RevealSection`, `Citations`, `EpistemicBadge` | Reuse inside a drawer or the advanced workspace | Already split into parts by UX-1 |
| UX-1 `IntegrityBar`, focus handling | Reuse | Becomes the top "objective + integrity" strip |
| UX-1 `Stepper` / `steps.ts` | Drop | The map-first design is not a wizard |
| `scripts/smoke-test.mjs` | Extend | The UX-0 translation-safety and integrity checks carry over |

**[D] UX-1 branch.** I recommend not merging the wizard. Instead, start the
map-first work from `ux1-guided-workflow`, so that IntegrityBar and the split
sections come along, and remove the stepper there. The alternative is to
start from `main` and re-extract those components.

## 2. Verified geospatial data we have

All coordinates are planetocentric, east-positive degrees, Mars 2000.

| Data | Geometry | Source / date | Usable at the snapshot (2023-09-08)? |
|---|---|---|---|
| Jezero centre 18.41° N 77.69° E, D = 47.52 km | point | USGS Gazetteer 14300 [V-earlier] | Yes (already cited) |
| Jezero crater outline | WKT, 361 vertices | Gazetteer page [V-earlier]; not yet in the repo | Yes |
| CTX ortho 6 m, HiRISE ortho ≈ 0.32 m/px at z17 | WMTS tiles + bbox | Trek, catalog 2020-08-03 [V-earlier] | Yes (already on the map) |
| CTX DTM 20 m `JEZ_ctx_B_soc_008_DTM_…_20m…` | 1596 × 1512 float32 | Trek, 2020-08-03 [V]. The Trek description calls it the USGS TRN/LVS product | Yes |
| HiRISE DTM 1 m `JEZ_hirise_soc_006_DTM_…_1m…_blend40` | ≈ 21.4k × 21.5k float32, 1.84 GB | Trek, 2020-08-03 [V]. USGS TRN DTM mosaic | Yes |
| Perseverance traverse `Perseverance_Traverse_Path` | 332 polylines; fields `sol`, `fromRMC`, `toRMC`, `length`, `SCLK_START/END`; sols 14–1176; 27.2 km in total | Trek ArcGIS MapServer layer 0, catalog date 2024-07-03 [V] | **[D]**: 244 segments (20.1 km) have sol ≤ 907, but the dataset postdates the snapshot |
| Rover position at the snapshot | end of the sol-907 segment: 18.4824° N, 77.3577° E | derived from the traverse above [V] | Same question as the traverse |
| PDS coring sites: Pelican Point, Comet Geyser; Lefroy Bay (agent-reported) | points + elevations | PDS dossier. 2.2–2.5 m from the traverse; DTM agreement within −1.8 / −3.0 m [V] | **Reveal only.** Nearest traverse sols are 911, 933 and 1084, all after sol 907 |
| MOLA global elevation | ArcGIS ImageServer, S16, ≈ 463 m | Trek [V] | Regional context only; too coarse for local 3D |

**Snapshot sol.** 2023-09-08 corresponds to sol ≈ 907. Two checks agree: the
arithmetic from landing on 2021-02-18 gives 907.2, and the SCLK of the sol-907
segment converts to 2023-09-08 under an assumed J2000 SCLK epoch. Before
shipping, it must be confirmed against an official sol calendar [A].

**Not verified, because the proxy blocks these sites (403):**
- www.usgs.gov: the MSR HiRISE TRN mosaics page;
- hirise.lpl.arizona.edu: DTM how-to;
- registry.opendata.aws: HiRISE DTMs on AWS.

As a result, the license wording, the official accuracy statements and any
newer (MSR) DTM coverage are **[A]**. The Trek API documentation page
was reachable, but it documents WMTS only.

## 3. Additional data to obtain

1. **[D] A sourced location for the Margin Unit**, the only way tasks can be
   shown "somewhere". Options:
   - (a) keep the textual locator only (today's rule);
   - (b) use a published GIS polygon, if one exists. Candidates still to
     check: SIM 3464 GIS data, a photogeologic map of the Mars 2020 field
     site [A];
   - (c) digitise a cited figure, labelled as an approximate regional
     location.

   I recommend (a) now, with (b) as a research task. Option (c) needs
   explicit approval, because it conflicts with "never hand-digitise without
   a citation" unless the figure is cited.
2. **An official sol↔date table**, to confirm sol 907.
3. **Traverse provenance.** The Trek metadata states no producer, method or
   accuracy [V].
4. **A HiRISE DTM crop**, made offline. The endpoint ignores HTTP Range
   requests (200 instead of 206) and the TIFF directory sits at the end of the
   file [V]. The whole 1.84 GB file must therefore be downloaded once, about
   2.5 min at the ≈ 12 MB/s observed here, then cropped and downsampled.
   - **Not yet known:** whether the "blend40" mosaic has no-data holes in the
     margin area [A].
5. **Attribution and license text** for Trek, USGS and HiRISE products. These
   sites are blocked, so this needs manual confirmation.

## 4. Is local high-fidelity 3D feasible for Jezero?

**Yes, as a static, preprocessed local scene. Not as live streaming.**

**Verified data facts [V]:**
- Both DTMs are float32, equirectangular (Mars 2000 sphere, standard
  parallel 0°), with heights relative to the areoid ("DeltaGeoid"). The CTX
  DTM runs from −2710.7 to −1515.5 m, with no no-data pixels.
- The georeferencing is correct: the CTX tie point (4,573,663 m E,
  1,109,693 m N) equals the catalog bbox.
- Trek serves the DEMs only as downloads
  (`TrekWS/rest/cat/data/stream?label=…`), with no WMTS: `WMTSCapabilities`
  returns 404.
- Trek also has an undocumented subset service; calling it without
  parameters returns an exception.

**Proposed pipeline** (build time, run by a script, output committed):

1. Download the DTM.
2. Crop to an AOI: either the whole CTX scene, or about 3 × 3 km of HiRISE
   around the rover's position and the margin.
3. Downsample:
   - CTX: to 40 m, which gives 798 × 756 ≈ 0.6 M vertices;
   - HiRISE: to 2–3 m, which gives about 1–2 M vertices.
4. Quantise to Uint16 (CTX range 1195 m → 1.8 cm steps), plus JSON metadata:
   bbox, spacing, datum, source label and DTM date.
5. Verify the output in a test: the PDS points must agree to within ±5 m, and
   the bbox must match the catalog.

**Size estimates:**
- CTX at 40 m: about 1.2 MB.
- HiRISE crop at 2 m: about 4.5 MB raw (≈ 1,500² samples), less after gzip.

**Rendering:**
- **Texture:** Trek WMTS ortho tiles drawn onto a canvas. Trek sends CORS
  `*` [V-earlier], so WebGL can use the tiles.
- **Geometry:** one plane mesh with a height-displaced vertex grid.
- **Coordinates:** convert to local tangent-plane coordinates:
  x = Δλ·R·cos φ₀, y = Δφ·R. The DTM grid has no cos φ factor, so skipping
  the conversion would distort east–west distances by about 5% at 18.5° N.
- **Vertical exaggeration:** default 1×; anything else is labelled on screen.

**Renderer [D]:**
- **Plain `three` (one dependency) in a client-only component.** It mirrors
  the OpenLayers pattern and is my recommendation.
- **React Three Fiber (+1–2 deps).** Its compatibility with React 19.3 and
  Next 16.4 is not verified [A].

**What 3D cannot show:**
- **CTX at 20 m post spacing:** the effective resolution is a few posts, so
  roughly 60–100 m [A].
- **HiRISE at 1 m:** metre-scale relief at best.
- **Neither DTM resolves rocks smaller than about 1 m,** so 3D must never be
  presented as traversability evidence.

## 5. Priority and review status on the map

- **Tasks are not markers.** Tasks appear in a **task strip** beside the map.
  Selecting a task highlights only the verified context it relates to:
  - rover tasks: the rover's position at the snapshot, plus the Margin Unit
    textual-locator label;
  - the orbital task: the existing HiRISE/CTX coverage extents as reference
    layers.

  The highlight never draws a target point or polygon.
- **Rank and score stay in the strip, not on the map.** No priority heat
  map, no score-sized markers, no traffic-light colours.
- **Review status uses shape and text, not colour alone:**
  - Reviewed: solid border, "Reviewed".
  - Provisional: dashed border plus a permanent "PROVISIONAL · not validated"
    tag. A provisional rank is shown as "Provisional #1", never as "#1".
  - Not evaluated: hollow, "Not evaluated: <reason>".
  - Infeasible under constraints: greyed, with the reason ("over budget by
    N simulated points"). Shown, never hidden.
- **The reviewed-ranking state** ("unavailable: 4 feasible tasks excluded
  pending review") stays in the always-visible integrity strip.

## 6. Routes and locations without unsupported safety claims

| Class | Data | Style | Mandatory label |
|---|---|---|---|
| Verified location | Gazetteer centre, sample sites (reveal) | Solid point icon | Coordinates, source, convention |
| Approximate regional location | Margin Unit (textual only) | **Text label, no geometry** (option b or c in §3 would add a hatched area) | "No published outline; location described in Horgan et al. 2020" |
| Historical rover traverse | Trek traverse, sol ≤ snapshot | Solid thin line | "Historical traverse through sol 907 · source · published 2024-07-03" |
| Later traverse (reveal) | sol > 907 | Dotted grey line, only in reveal mode | "After the mission date" |
| Simulated conceptual route | **None proposed now** | If added later: dashed straight connector | "Conceptual only · straight-line distance · not a planned, assessed or safe route" |
| Terrain-calculated path | **Defer** | — | It would claim more than slope can support. Trek has a path service, but its own UI disables it |

**Rules:**
- No animated driving.
- No green "go" styling.
- No arrival-time or "safe" wording.
- No smoothing that makes a route look planned.
- Every line opens a popup showing its provenance class.

## 7. Proposed layout (no wizard)

```
┌ Objective strip: "Which observation best tells the two hypotheses apart?"  ┐
│  Mission date 2023-09-08 (sol 907) · Simulated · Reviewed ranking: unavail.│
├──────────────────────────────────────────────┬─────────────────────────────┤
│                                              │ Context card (selected item)│
│        MAP  (2D ⇄ 3D toggle, legend,         │  what it is · why it matters│
│        provenance classes, reveal toggle)    │  cost vs budget bar         │
│                                              │  status: PROVISIONAL        │
│                                              │  [Evidence ▸] [Science ▸]   │
├──────────────────────────────────────────────┴─────────────────────────────┤
│ Task strip: 4 compact cards · constraint chips (budget ▮▮▮▯, platforms)    │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Evidence on demand:** a drawer listing the snapshot's observations and
  hypotheses for the selected task. It reuses `EvidenceSection`.
- **Advanced science workspace:** a full-height drawer or a separate route.
  It holds the existing weights, criteria, comparison table, registry and
  provisional ranking, all reused as they are.
- **Mobile:** the map takes 45% of the viewport height, the task strip
  scrolls sideways, and the context card becomes a bottom sheet.
- **Onboarding:** an optional dismissible three-tip overlay instead of a
  mandatory flow.
- **Selection survives 2D↔3D.** One React state holds `selectedId` and the
  mode. Both views render the same pure `MapFeature[]` list (id, lon, lat,
  class, provenance, availableFrom); 3D samples the heightfield for z.

## 8. Implementation plan (small, prioritised; relative complexity)

| # | Scope | Size | Depends on |
|---|---|---|---|
| MF-0 | A pure `lib/map/features.ts` with provenance classes and snapshot filtering by sol and date. A committed traverse extract (GeoJSON for sol ≤ 907 is 0.9 MB raw; simplify it before committing). Tests: extents, convention, no post-snapshot leakage | S | [D] traverse policy |
| MF-1 | 2D map-first shell: objective strip, map, task strip, context card, evidence drawer, advanced drawer. OpenLayers vector layer and selection. Smoke checks, including the translation run | M | MF-0, [D] UX-1 base |
| MF-2 | Reveal on the map: the later traverse and the PDS sample sites | S | MF-1 |
| MF-3 | 3D spike on the CTX 20 m whole scene: preprocessing script, `three` viewer, the same features, mode toggle that keeps the selection | M–L | [D] `three` dependency |
| MF-4 | HiRISE 1 m local crop around the margin and rover position | M | MF-3, the 1.84 GB download |
| Later | Conceptual routes (if wanted). Terrain-calculated paths are not planned | — | Separate approval |

## 9. Technical risks

1. **Temporal policy (high).**
   - The traverse dataset (2024) postdates the snapshot. Filtering by sol
     avoids content leakage but cites a later source.
   - **[D] options:**
     - (i) allow it as "mission-state context", labelled, and never an
       engine input;
     - (ii) show it only in the reveal.

     I recommend (i).
2. **The empty map trap (high, UX).** Without a Margin Unit footprint, users
   may read the rover's position as the target. Mitigation: explicit labels
   and "no published outline" text.
3. **Undocumented endpoints (medium).** `cat/data/stream`, the subset service
   and the traverse MapServer come from Trek's app configuration, not its
   API documentation. Mitigation: preprocess offline and commit the derived
   assets, so runtime depends only on WMTS.
4. **Mislabelled CRS (medium).** ArcGIS GeoJSON output declares `EPSG:4326`
   although the coordinates are Mars 2000 [V]. Code must ignore that label
   and never reproject with Earth parameters.
5. **3D performance and mobile (medium).** Mobile WebGL often limits
   textures to 4096 px, and bundle size will grow [A]. Fallback: 2D only,
   with 3D loaded lazily.
6. **False authority of 3D (medium).** Mitigations: a 1× default,
   resolution notes, and no slope or "hazard" colouring.
7. **Geometry scale bug (low).** Any equirectangular → local conversion must
   apply the cos φ factor, covered by a unit test.
8. **Translation safety (low).** New popups and cards must follow the UX-0
   rule: dynamic text is the sole child of its element.

## 10. Probes run (read-only, 2026-11-05)

- **Trek catalog search** `index/eq/searchItems` for JEZ, Jezero,
  Perseverance and Mars2020, and `searchDEM`.
- **`WMTSCapabilities.xml`:** 404 for the three DEMs; 200 for the traverse
  and MOLA.
- **Traverse queries** (`…/Perseverance_Traverse_Path/MapServer/0`): count
  332; fields; GeoJSON for sol ≤ 907 and for all sols.
- **CTX DTM:** full download (9,675,294 B) and TIFF tag and statistics
  inspection.
- **HiRISE DTM:** Range test, response 200 rather than 206. The 480 MB
  partial download was deleted.
- **Distances** from the PDS sites to the traverse vertices, and DTM
  elevation at the PDS sites.
- **MOLA ImageServer metadata**, and the Trek app `config.json` for service
  URLs.
- Downloaded files are kept in the session scratchpad only. None were
  committed.
