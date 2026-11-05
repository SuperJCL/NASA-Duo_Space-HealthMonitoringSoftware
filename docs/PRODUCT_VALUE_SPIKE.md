# Product value spike: a location-specific science briefing (Lefroy Bay)

Status: **spike only, 2026-11-05.** Nothing here is implemented. No UI, engine,
evidence or review-registry changes; no branch merged.

**Verdict: yes. Our existing, already-verified sources support a genuine,
source-grounded briefing for Lefroy Bay.** The briefing can also work for
Pelican Point and Comet Geyser, which have reports of the same format in
the same PDS volume.

What does not exist yet is a **verified link from that location to new
in-situ observation actions**. The briefing should therefore present next
steps as:
- investigations the source itself proposes, and
- clearly labelled simulated ideas.

It should not present them as ranked, located tasks.

Labels: **[V]** verified today against the source text. **[A]** assumption.
**[D]** owner decision.

## 1. Evidence audit: Lefroy Bay

**Primary source, already in `sources.json`, live-verified:** PDS Mars 2020
Initial Reports vol. 4, initial report **M2020-949-26 Lefroy Bay**:
- report dated December 18, 2023;
- volume version 2.0 of 2025-05-06;
- about 37 pages (26-1 to 26-37).

**Secondary sources:** NASA "Meet the Mars Samples: Lefroy Bay (Sample 23)",
and our geographic records from MF-0.

All quotes below were checked verbatim against the source text **[V]**.

| Category | Content (verbatim, abridged) | Locator |
|---|---|---|
| **Where / why here** | Core site 18.48867° N, 77.34705° E (convention *inferred*, MF-0). "Turquoise Bay represents a local topographic high of the Margin unit targeted for investigation because it contains a particularly strong CRISM carbonate signature." | Report header, Summary |
| **Observed / measured** (instrument results as reported) | "Major primary minerals occurring as sand-sized grains are olivine, pyroxene, and altered silicates." · "Silica fills the space between grains, possibly as a cement." · SHERLOC Raman peaks "can be assigned to carbonates … and hydrated/hydroxylated silica"; "the first time that hydrated/hydroxylated silica has been detected by SHERLOC" · "No cavities, vugs or veins are present." · "any organic compounds, if present, are in generally very low abundance." | Lithology, SHERLOC, Assessment §2 |
| **Published interpretation** (team, preliminary) | "Lefroy Bay is tentatively interpreted here to be a compositionally heterogeneous silica-cemented medium to coarse sandstone." · "Bulk composition is that of an altered basalt." · "in-family with the Pelican Point sample acquired about 380 meters to the southeast" | Returned Sample Science, Lithology, Assessment §1 |
| **Unresolved questions** (stated by the source) | "the environment in which the Margin unit rocks were deposited has not yet been established; … fluviolacustrine, aeolian, and pyroclastic deposition remain under consideration." · "the absence of distinctive sedimentary structures leaves open the possibility that this rock is igneous (and altered)." · Stratigraphic position relative to the Shenandoah formation "is unknown." | Returned Sample Science, Assessment §2d, Summary |
| **Next investigations proposed by the source** (Earth laboratories, if returned) | Crystallisation ages of detrital clasts "would provide upper bounds on the timing of deposition of the Margin unit"; lab study could link grains "to their source region outside of Jezero"; paleomagnetism; geochemistry of the cements | Returned Sample Science Considerations |
| **Already done here** | WATSON imaging sol 920 · abrasion "Bills Bay … acquired on sol 935" · SHERLOC sols 938–939 · "drilled on sol 942" · sealed sol 949 after a sampling-arm fault | Summary, header ("Anomalous Behavior") |

**Cross-checks that add confidence [V]:**
- **Distance:** our PDS coordinates put Pelican Point 370 m away at a
  bearing of 147° (south-east). The source says "about 380 meters to the
  southeast".
- **Coverage:** the site is inside the HiRISE 25 cm and 1 m DTM coverage.
- **Traverse:** the traverse passes within 2.5 m of the site.

**Source caveats** (they must shape the UI copy):
1. **Mostly one source,** written by the mission team, described as
   "preliminary" and "tentative". Newer peer-reviewed work is not in our
   dataset (journals are blocked; research tasks R1 and R2).
2. **Shared text across reports.** About a third of the useful sentences
   also appear verbatim in the Pelican Point report: the open questions,
   the "igneous (and altered)" sentence, and parts of the lithology. A
   quote's presence in the PDF does not prove that it is about Lefroy Bay.
   Attribution must check that the quote lies inside report 26's page range
   (§4, item 1).
3. **Editorial errors in the source:**
   - the Lefroy Bay report's habitability paragraph ends "make Pelican Point
     of great interest" (copied text);
   - the outcrop is spelled both "Lake Newell" and "Lake Newall".

   Quote around these; do not correct the source silently.
4. **Spectral identifications are model-based** ("can be assigned to"). Show
   them as "reported by SHERLOC", not as certain mineral facts.
5. **The laboratory investigations depend on sample return.** The NASA page
   says the sample "will hopefully be brought back to Earth". Present them
   as conditional [A], with no claim about the sample-return programme.

## 2. Can a useful briefing be built? Yes, with limits

| Briefing element | Supported? |
|---|---|
| Real location and why it was chosen | **Yes.** PDS coordinates plus a quoted reason |
| What NASA measured there | **Yes.** 5–6 quoted instrument results |
| Published interpretation | **Yes.** Tentative and attributed |
| A grounded open question | **Yes, quoted:** "sandstone or altered igneous rock, and in what environment?" |
| Next investigations: source-proposed laboratory work on *this* core | **Yes.** Inherently tied to this location |
| Next investigations: new *in-situ* actions at a *mapped* target | **No.** There is no verified target geometry (§4) |
| Ranking of next steps | **Not needed for the value test.** The existing engine stays in "Methods & audit" |

**The current four tasks fit poorly here.** At Lefroy Bay, abrasion and
coring have *already been done* (Bills Bay, sol 935; the core, sol 942). The
engine has no notion of "already done at this location", which is why the
current action strip confuses users.

## 3. Separation rule for the briefing

Every line carries one label, and the labels never mix:

| Label | Meaning |
|---|---|
| **Measured** | An instrument result as reported, with its source and locator |
| **Interpreted (team, preliminary)** | The source's own interpretation |
| **Open question (stated by the source)** | A verbatim unresolved question |
| **Proposed by the source** | Investigations the report itself proposes (laboratory work, if returned) |
| **Simulated idea (MDI, not reviewed)** | An MDI-derived suggestion linked to one open question, with review status pending, no location and no ranking. Examples: "look for sedimentary structures in nearby Margin outcrops" (from the "absence of distinctive sedimentary structures" sentence); "compare with Pelican Point" |

## 4. Missing data for a location → next-action link

1. **Section-scoped quote verification.** Check that a quote lies inside a
   given report (page range or heading), not merely somewhere in the PDF.
   This is needed because of the shared text noted above.
2. **Locations of related workspaces and targets:**
   - Bills Bay abrasion patch, Lake Newell outcrop, Victor Island and
     Gnaraloo Bay are named only, or appear only in figures;
   - the PDS reports give core coordinates only.

   A next action cannot be placed on the map without these.
3. **Mapped unit boundaries and contacts.** Examples: the Margin unit, and
   its contact with the fan units, for the stratigraphy question. Candidates
   are SIM 3464 GIS data and a published photogeologic map of the field site
   [A]. This is the existing research gap.
4. **Orbital product identifiers:**
   - the CRISM observation behind the "strong carbonate signature";
   - HiRISE stereo coverage at the site.
5. **Instrument data-product identifiers** (PIXL, SHERLOC, SuperCam at Bills
   Bay), for "see the data" links. Optional.
6. **Newer literature on Lefroy Bay and the Margin unit** (blocked: R1, R2).
7. **An "already done at this site" relation for tasks.** If simulated
   actions are kept, they must know that abrasion and coring were done here.
   That means a data-model change, which needs review (R4).

## 5. Minimal workflow (no wizard)

**Pick a site → read the briefing → open the evidence for any line.**

1. **Open the app:** a map of the three sample sites, shown as labelled
   pins.
2. **Click Lefroy Bay** (or choose it from a site list): the briefing panel
   opens immediately.
3. **Read top to bottom:**
   - why here;
   - measured;
   - interpreted;
   - **the open question** (highlighted);
   - what could help answer it (proposed by the source, then simulated
     ideas);
   - already done here;
   - sources.
4. **Any line → "Source"** shows the verbatim quote and locator.
5. **Optional:** "Compare with Pelican Point" (380 m south-east, same
   format), and a "Methods & audit" link to the existing engine and registry.

## 6. Reuse

- **Data, unchanged:**
  - `pds-m2020-initial-reports-vol4` and `nasa-meet-lefroy-bay` sources;
  - the MF-0 sample site, traverse and extents;
  - `obs-lefroy-bay-hydrated-silica`;
  - the margin-unit hypotheses and `gap-sedimentary-or-igneous`, as broader
    context.
- **New data needed:** about 12–15 curated briefing items for Lefroy Bay
  from the same PDS report.
  - **[D]** I recommend a separate `src/data/briefings/` file using the
    existing Zod record shapes. It would **not be an engine input**: adding
    observations or gaps to the scenario would change engine outputs, and
    this spike assumes no engine change.
  - MDI-derived "simulated ideas" would go into the review registry as
    pending.
- **Code:**
  - `lib/geo` (records, `describeFeature`), `MarsMap` (layers, selection, pins
    for sample sites), `FeatureCard`, which becomes the briefing header;
  - `Citations`, `EpistemicBadge` and `ObservationCard` for quoted lines;
  - `Drawer` for "Methods & audit";
  - `verify-citations.mjs`, extended with section-scoped checks.
- **Moved out of the default view:** the action strip, the scoring engine UI
  and the review registry. They stay available under "Methods & audit".

## 7. User-value test (30–60 s, first-time user)

**Task, read aloud:** "Using the app, tell me what fills the spaces between
the grains in the Lefroy Bay rock, what scientists still do not know about
how it formed, and whether what the app suggests next is a NASA plan."

**Pass for one participant:** within 60 s they say all three of:
1. **silica** (the cement);
2. **its origin is unresolved:** sandstone (shoreline, river or lake, or
   wind) or altered igneous rock;
3. **the next steps are not NASA plans:** they are analyses the team
   proposed for returned samples, or simulated ideas.

The participant must also hold **no misconception** that the rover is at
Lefroy Bay now.

**Target:** at least 4 of 5 first-time participants pass.

**Record:** time to each answer, misconceptions, and whether they used the
source link.

**Baseline:** run the same test on the MF-1 build, to show the change is an
improvement.

## 8. Compact layout

```
MDI · Jezero sample sites · learning tool, not a NASA mission        [Methods & audit]
┌──────────── map (≈ 50%) ────────────┬────────────── Science briefing (≈ 50%) ──────────────┐
│ HiRISE/CTX imagery, traverse faint  │ LEFROY BAY · rock core M2020-949-26 · cored sol 942   │
│ ● Lefroy Bay (selected)             │ Why here: strong orbital carbonate signal  [source]   │
│ ● Pelican Point  ● Comet Geyser     │ MEASURED   olivine/pyroxene sand grains; silica fills │
│ "No Margin Unit boundary is         │            pores; carbonate + hydrated silica (SHERLOC│
│  available" note; coordinate caveat │            first); no veins; organics very low if any │
│                                     │ INTERPRETED  tentatively a silica-cemented sandstone  │
│                                     │ ┌ OPEN QUESTION ─────────────────────────────────────┐│
│                                     │ │ Sandstone (shoreline, river/lake or wind) or       ││
│                                     │ │ altered igneous rock? Setting "not yet established"││
│                                     │ └────────────────────────────────────────────────────┘│
│                                     │ COULD HELP  Proposed by the team (if returned): dating│
│                                     │             grains and carbonates, source of grains,  │
│                                     │             paleomagnetism · Simulated ideas (MDI,    │
│                                     │             not reviewed): look for sedimentary       │
│                                     │             structures nearby; compare Pelican Point  │
│                                     │ DONE HERE  sol 920 imaged · 935 abraded · 942 cored   │
│                                     │ Sources: PDS vol. 4 report 26 (2023-12-18) · NASA     │
└─────────────────────────────────────┴───────────────────────────────────────────────────────┘
```

On phones: site chips, then the briefing; the map becomes a 30% strip
above it.

## 9. If approved: smallest next steps (relative size, no estimates)

| Step | Scope | Size |
|---|---|---|
| **BR-1** | Curate the Lefroy Bay briefing items, with section-scoped quote verification, separate from the engine | S–M |
| **BR-2** | Briefing panel, site pins, map context; run the §7 test | M |
| **BR-3** | Pelican Point and Comet Geyser briefings (same format) | S |
