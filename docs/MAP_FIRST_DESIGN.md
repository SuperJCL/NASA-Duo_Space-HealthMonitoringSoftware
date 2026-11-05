# MDI: map-first design (present-day mission simulation)

Status: **MF-1 implemented, 2026-11-05,** on branch `mf1-map-first-ui`
(from `mf0-geo-data`), not merged. Manual test: `docs/MF1_MANUAL_TEST.md`.

Previous status: **MF-0 approved and implemented, 2026-11-05.** It is on branch
`mf0-geo-data` and not merged. The owner approved D1–D6 as recommended; the
implementation is described in `docs/GEO_DATA.md`. The rest of this document
remains the design for MF-0b to MF-4.

Original status: **design, 2026-11-05.** This document incorporates the owner's
"Present-Day Mission Simulation" decision into MF-0 and the later Map-First
milestones.

- **MF-0 had not started** when the decision arrived, so there was no
  completed work to preserve.
- **Nothing here is implemented**, and none of it is approved for
  implementation yet.
- **The scoring engine is unchanged.**

It supersedes the parts of `MAP_FIRST_ASSESSMENT.md` listed in §8. That file
is otherwise still valid, including the data facts and 3D feasibility.

**Labels:**
- **[V]** verified live from this container.
- **[A]** assumption.
- **[D]** owner decision needed.

**Principle:** Map First. Action First. Evidence on Demand. Human in Control.

## 1. What the decision changes

| Area | Before | Now (default) |
|---|---|---|
| Default scenario | Retrospective, mission date 2023-09-08 | **Simulated present-day mission, 2026** |
| Evidence used | Records public on or before the snapshot | **All verified records in the dataset.** Cut-off = the latest `availableFrom`, now 2025-05-06 |
| Map content | Imagery only | **Full verified traverse, sample sites, NASA imagery** |
| Primary UI | Guided five-step flow (UX-1, not merged) | **Map with an action strip.** No wizard |
| Snapshot picker, "What happened later", retrospective review | Main workflow | **Historical replay** in the advanced workspace |
| Engine, registry, citations, review rules | — | **Unchanged** |

## 2. Present-day evidence: no engine change needed [V]

Present-day mode calls the existing
`selectEvidenceAsOf(scenario, latestRecordDate)`. This is exactly the path
behind today's "All evidence" button, and it is already part of the 36-state
baseline (the `2025-05-06` states). I ran the engine read-only on this path:

- **Evidence:** 8 observations, 0 records withheld.
- **Gaps:** `gap-no-in-situ-data` becomes **addressed**, through the existing
  observation–gap links. Three local gaps and one regional-context gap remain
  open.
- **Reviewed ranking: unavailable.** 50 relationships await review, so no
  task is eligible.
- **Provisional ranking (not validated):**
  - abrasion 0.743, coring 0.700, stand-off 0.671, orbital stereo 0.400;
  - margin 0.043; the top task is unchanged in 6 of 6 ±20% trials;
  - 3 pivotal unreviewed inputs.
- **Engine limitation text** reads "Only evidence public on or before
  2025-05-06 was used; 0 later record(s) were withheld". It stays accurate
  as written.

The year 2026 is a **mission label**, not a filter date. Using a 2026 date
for filtering would only change the date printed in that limitation, and
would suggest records exist that we do not have. I recommend no specific
mission day [D].

## 3. Historical rover activity vs simulated future actions (Requirement 9)

| Layer | What it is | Geometry | Label |
|---|---|---|---|
| **Historical rover activity (verified)** | Perseverance traverse, sample sites, last position in the dataset | Yes | "Historical · Perseverance · sol N / date · source" |
| **Simulated future action** | The 4 candidate tasks, as actions *you* may choose next | **None** (tasks are methods; no Margin Unit footprint exists) | "Simulated action · not a NASA plan" plus review status |
| **Reference** | Crater centre, imagery and DTM extents | Yes | Source and date |
| Later, needs approval | A site *you* place for a simulated action | User-placed point | "Placed by you · simulated · not a verified target" |

**Rules for these layers:**
- **The rover is never shown as live.** The marker is "last position in our
  dataset: sol 1176 (≈ 2024-06-11)". The rover has kept moving since then,
  and we have no verified geometry after that sol [V: the Trek traverse ends
  at sol 1176].
- **Persistent banner:** "Simulation · not a NASA mission, astronaut mission
  or live telemetry · rover data are historical".
- **[D] Astronaut wording.** I recommend using "astronaut/explorer" only in UI
  copy for the user's role. Task data keeps `platform` = rover / orbital /
  lab. Making an astronaut a performing platform would change engine inputs
  (the platform constraints and the evidence-quality hierarchy), and
  Requirement 10 forbids that without a review.
- **Flagged for scientific review, not changed:**
  - The candidate task pool and `asm-rover-access` / `asm-sample-return`
    were curated for the 2023 situation.
  - In 2026 the abrasion and coring tasks mean *another* abrasion or core.
    Whether these remain the right four actions is a curation question for
    the reviewers.

## 4. MF-0 design: present-day data foundation (no UI change)

**Goal:** typed, validated, sourced map data and a mission-mode type. No UI
and no engine changes.

### 4.1 Files

| File | Content |
|---|---|
| `src/lib/map/features.ts` (pure, no OpenLayers) | Zod schema and types for map features (below); `presentDayFeatures()` and `replayFeatures(date)`. Replay exposes only point features with `availableFrom ≤ date`; replay traverse filtering is deferred to MF-2 |
| `src/lib/mission/mode.ts` | `MissionMode = "present-day" \| "historical-replay"`; `evidenceDateFor(mode, scenario, replayDate)`; present-day uses the latest record date |
| `src/data/geo/jezero-features.json` | Verified points and extents, each with a citation |
| `src/data/geo/perseverance-traverse.json` | Simplified traverse with `sol`, `fromRMC`, `toRMC` and `length`, plus metadata: source, catalog date, sol range, simplification tolerance |
| `scripts/fetch-traverse.mjs` | Reproducible extraction from the Trek MapServer query, then simplification |
| `src/data/sources.json` | **+1 source:** the Trek `Perseverance_Traverse_Path` product. Vol. 4 is already present (`pds-m2020-initial-reports-vol4`) |
| `src/data/scenarios/…json` (+ schema) | Optional `presentDay: { missionLabel: "Simulated mission · 2026" }`. No change to `defaultSnapshotDate`, which stays as the replay default |

### 4.2 Feature model

```ts
type MapFeature = {
  id: string;
  layer: "historical-rover" | "reference";        // simulated actions carry no geometry in MF-0
  kind: "sample-site" | "traverse" | "rover-last-position" | "crater-centre" | "product-extent";
  geometry: { type: "Point"; coordinates: [lon, lat] } | { type: "LineString"; … } | { type: "BBox"; … };
  coordinateConvention: "planetocentric-east-mars2000";
  conventionBasis: "stated" | "corroborated";     // PDS: corroborated (§4.4)
  citation: { sourceId: string; quote: string; locator?: string };
  availableFrom: string;                          // source publication date
  event?: { sol?: number; date?: string };        // when the activity happened
  relatedObservationIds?: string[];               // only where the observation's quote names the site
};
```

### 4.3 Initial content

- **Sample sites: Pelican Point, Lefroy Bay, Comet Geyser** [V]. All three
  come from PDS Initial Reports vol. 4 and use the field format "Latitude
  (N), Longitude (E), Elevation".
- **Remaining sites, as MF-0b:** PDS sample-dossier volumes 1–3 and 5 are
  listed on the PDS directory [V]. Volume 5's label is dated 2026-02-10 and
  it is a 39 MB PDF.
- **Full traverse** [V]:
  - **Size:** 332 segments, sols 14–1176, 27.2 km.
  - **Rover's last position in the dataset:** 18.49568° N, 77.30381° E,
    at the end of sol 1176.
  - **Sol → date:** the date for sol 1176 is computed, ≈ 2024-06-11 [A].
    It can be shown as "≈", or only as the sol.
- **Jezero centre** (Gazetteer, already cited), and the CTX/HiRISE ortho and
  DTM extents (Trek catalog).

### 4.4 Sample coordinate convention

PDS states "Latitude (N), Longitude (E)" but not whether latitude is
planetocentric or planetographic. Two independent checks [V] agree with
planetocentric, east-positive coordinates on the Mars 2000 frame:

1. **The sites lie 2.2–2.5 m from the Trek traverse.**
2. **Their PDS elevations agree with the CTX DTM to within 3 m.** The DTM is
   on a sphere, where the two latitude conventions coincide. Mixing them up
   would shift positions by about 12 km at 18.5° N.

**Plan:** record `conventionBasis: "corroborated"`, and state the method in
the popup.

**[D] Requirement 3** asks to display sample locations. I read that as
approving display on this corroborated basis. Please confirm.

### 4.5 Tests (MF-0 acceptance)

1. **Schema:** Zod validation of both geo files.
2. **Coordinates:** every coordinate lies inside the Trek product extents.
3. **Quotes:** every sample-site coordinate appears verbatim in its PDS
   quote, checked by `verify:citations` against the live PDF.
4. **Traverse integrity:**
   - segment count and sol range match the source;
   - total length matches the source's `length` sum within 0.5%;
   - the simplification deviates at most 1 m from the source geometry.
5. **Rover marker:** it carries the sol and the "not live" wording.
6. **No geometry for simulated actions.**
7. **`relatedObservationIds`:** each one is backed by the observation's quote
   naming the site.
8. **Engine untouched:**
   - `git diff main -- src/lib/decision` is empty;
   - the 36-state baseline is byte-identical;
   - the present-day output equals the `2025-05-06` baseline state.
9. **No coupling:** nothing under `src/lib/decision` imports `src/lib/map`.
10. `npm run check` and the existing smoke test pass. MF-0 has no UI, so the
    smoke test should be unchanged.

## 5. Revised milestones (each needs approval before it starts)

| # | Scope | Size |
|---|---|---|
| **MF-0** | §4: data foundation, mission mode, tests | S–M |
| MF-0b | Sample sites from PDS volumes 1–3 and 5 (curation plus quote verification) | S–M |
| **MF-1** | **Present-day map-first shell as the default** (layout below) | M |
| MF-2 | Historical replay on the map: traverse filtered by sol (needs a verified sol↔date table); later sample sites appear on reveal | S–M |
| MF-3 / MF-4 | 3D: CTX 20 m scene, then a HiRISE 1 m crop (unchanged from the assessment) | M–L / M |

### 5.1 MF-1 shell

- **Objective strip:**
  - the scenario question;
  - "Simulated mission · 2026 · all verified records (latest 2025-05-06)";
  - "Reviewed ranking: unavailable".
- **Map:** imagery, the historical-rover layers and the legend of location
  classes. Clicking a feature opens a context card with its provenance and
  links to the related evidence.
- **Action strip:** 4 simulated actions, each showing cost against the
  budget, feasibility, review status (Provisional is never shown as a plain
  "#1"), and **Choose this action**.
  - **"Human in control":** the choice is recorded locally as the user's
    decision.
  - The app never auto-selects an action.
- **Evidence drawer:** on demand, reusing `EvidenceSection`.
- **Advanced workspace:** weights, criteria, comparison table, review
  registry, provisional details, and **Historical replay** (the existing
  date picker, reveal and retrospective review).
  - **Replay map in MF-1:** sample sites published after the replay date
    are hidden, and the traverse is hidden with a note until MF-2.

## 6. Data sources still to obtain

1. **mars.nasa.gov (MMGIS "Where is Perseverance") is blocked by the proxy
   (403)** [V].
   - It is the likely source of a traverse more recent than sol 1176 [A].
   - If you want the traverse to come closer to 2026, please allow
     `mars.nasa.gov`.
   - Otherwise the map says "traverse through sol 1176 (latest in our
     dataset)".
2. **An official sol↔date table.** Needed only for MF-2, and for showing a
   date next to sol 1176.
3. **PDS volumes 1–3 and 5 (≈ 345 MB in total)** for MF-0b.
   `pds-geosciences.wustl.edu` is allowed.

## 7. Open decisions

- **[D1] Mission date.** Cut-off = latest record date, plus a "2026" label
  with no specific day (recommended).
- **[D2] Sample-site display** on the corroborated convention (§4.4).
  Requirement 3 implies yes; please confirm.
- **[D3] Astronaut wording.** UI copy only; task platforms unchanged
  (recommended).
- **[D4] Traverse currency.** Allow `mars.nasa.gov`, or show the traverse
  only through sol 1176.
- **[D5] MF-1 base branch.** Same question as before. I recommend branching
  from `ux1-guided-workflow` and removing the stepper, so UX-1 is never
  merged as a wizard.
- **[D6] Scientific re-review for 2026.** The task pool and the
  `asm-rover-access` / `asm-sample-return` assumptions. This is for the
  reviewers; MF milestones do not change it.

## 8. Superseded parts of `MAP_FIRST_ASSESSMENT.md`

- **§0 item 4 and §9 risk 1 (traverse temporal policy).** Resolved by
  Requirement 3: the full traverse is shown in present-day mode. The
  question returns only for replay (MF-2).
- **§2, "Usable at the snapshot" column.** It now applies to replay mode
  only.
- **§6, "Later traverse (reveal)" class.** Replay only. In present-day mode
  the whole traverse is "historical rover activity".
- **§7, objective strip text.** Replaced by §5.1 here.
- **§8 plan.** Replaced by §5 here.
