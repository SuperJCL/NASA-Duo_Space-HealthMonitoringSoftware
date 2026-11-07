# SCI-1 v1: evidence for the three candidate actions

**Status:**

- first version, for review;
- branch `sci1-evidence-v1`, not merged;
- every new relationship is `pending` and drafted by the AI agent;
- no scoring or ranking change (that is SCI-2).

**Ground rule.** "Current evidence is insufficient to support a scientific
ordering" is not "the action has no scientific value". Nothing here says an
action lacks value. Where the sources give no discriminating outcome, this
report says so and stops there.

**What "possible new output" means here.** It is a hypothesis for reviewers
about what an action could add *relative to the work already done in the
Margin unit*. It is not a finding, and it is not a prediction that the
action would succeed.

## 0. What this version contains

| File | What it is |
|---|---|
| `src/data/scenarios/jezero-margin-unit.sci1-proposals.json` | 27 verbatim evidence quotes and 11 pending proposals. **Not read by the engine or the app.** |
| `src/lib/evidence/sci1-proposals.ts` (+ test) | Zod schema and integrity rules: unique IDs, existing sources/tasks/gaps/hypotheses, `status: "pending"`, `draftedBy: "ai-agent"`, PDS quotes name their report. |
| `src/data/sources.json` | Two NASA sources added: the Mars 2020 science-instruments page and the Mars Sample Return page (both retrieved 2026-11-07). |
| `scripts/verify-sci1.mjs` (`npm run verify:sci1`) | Live check: each PDS quote lies inside the named sample report *and section*; prints page labels; reports where the locator-correction quotes actually occur. |
| `scripts/verify-citations.mjs` | Now also checks the 27 SCI-1 quotes (156 quotes in total: 129 + 27). |
| `scripts/lib/pds-reports.mjs` | `splitReports` / `pageAt` moved out of `verify-briefing.mjs` so both scripts share them (no behaviour change; `verify:briefing` still 35/35). |

**Unchanged:** `jezero-margin-unit.json` (scored scenario data), the review
registry (50 pending, 0 approved), the engine, weights, criteria and every UI
string. A unit test asserts that the provisional ranking at 2025-05-06,
100 pts is still exactly the SCI-0 result (Abrade 0.7428571428571429, Core
0.7, Survey 0.6714285714285714; 47 unreviewed inputs; the same 3 pivotal
inputs) and that no app or engine module imports the proposals file.

**Sources read for this version:**

- PDS Mars 2020 Initial Reports Vol. 4 (`pds-m2020-initial-reports-vol4`):
  the Pelican Point (M2020-923-25) and Comet Geyser (M2020-1088-27)
  reports; sections Summary Description, Preliminary Scientific Assessment
  and Returned Sample Science Considerations. Lefroy Bay (M2020-949-26) is
  used through the existing briefing.
- NASA, Mars 2020 science instruments page (`nasa-m2020-science-instruments`).
- NASA, Mars Sample Return page (`nasa-mars-sample-return`).

Page labels below are those printed by `verify:sci1` (report prefix, page).

## 1. Summary

| | Survey (`task-standoff-survey`) | Abrade (`task-abrasion-proximity`) | Core (`task-core-for-earth`) |
|---|---|---|---|
| **Already done in the Margin unit** | SuperCam and Mastcam-Z at the sampled sites; western Margin outcrops described as lacking clear sedimentary structures (27-2) | Three abrasions: Amherst Point (Pelican Point, sol 915), Bills Bay (Lefroy Bay), Castle Geyser (Comet Geyser, sol 1080), with WATSON, PIXL, SHERLOC, SuperCam | Three cores: Pelican Point (sol 923), Lefroy Bay, Comet Geyser (sol 1088), "the third sample of the Margin campaign" (27-2) |
| **Possible new output (for review)** | An outcrop-scale record of whether distinctive sedimentary structures are present at Margin outcrops not yet examined: the observation the reports name as missing | Close-up texture and chemistry of a Margin rock expression not yet abraded; the source-named candidate is the lighter-toned low-lying western Margin rock | A sealed core of a Margin rock expression the three cores do not represent, in which Earth laboratories could test how the carbonate formed (detrital or in situ) **if it is returned** |
| **Key testable question** | Q-S1: are distinctive sedimentary structures visible at outcrop scale? | Q-B1: does a not-yet-abraded rock expression differ in texture and chemistry from the three abrasions? | Q-C1 (only if returned): did the carbonate form as detrital grains or in situ? (carbonate process, not host-rock origin) |
| **Discriminating outcome in the sources?** | Yes, one-sided: structures present → favours sedimentary; absent → favours none | **None yet.** At Comet Geyser, texture and chemistry were each "consistent with" both sandstone and altered igneous rock | Only if returned, and one-sided: detrital carbonate → favours a sedimentary host; in-situ carbonate → informs the alteration process, not the host-rock origin |
| **Biggest missing evidence** | Any geology at Target A; whether later observations already found structures | A reviewer-defined discriminating outcome; whether the lighter-toned rocks were abraded after Comet Geyser | Sample-return status beyond the page wording; tube availability; why a fourth core adds to the three |
| **Effect on the comparison if approved (SCI-2 computes)** | New link to `gap-sedimentary-or-igneous`. **Hypothetical, not current:** only if this link is approved and later adopted into the scored data (SCI-2) would Survey be linked to 2 of 3 open questions; today 1 of 3 | A pivotal existing link (`→ gap-lake-connection`) is flagged for revision | Its lab-dependent value would carry an explicit condition |

## 2. Survey (stand-off)

### What has been done

- SuperCam already reports heterogeneity near Bunsen Peak: "SuperCam
  analyses indicate that the rocks in the vicinity of Bunsen Peak are
  compositionally heterogeneous, and similar to previous measurements of the
  Margin unit." (27-2)
- Outcrop-scale structure has been looked at in the west: "The western
  Margin lacks clear sedimentary structures at the outcrop level, including
  at Bunsen Peak." (27-2)

### Possible new output

An outcrop-scale record of whether distinctive sedimentary structures are
present at Margin outcrops not yet examined. The reports name this as the
missing observation:

> "In the absence of strong evidence for sedimentary structures, the Margin
> unit could alternatively be a pyroclastic or extrusive or intrusive igneous
> deposit." (Pelican Point, Summary Description, 25-2)

> "the absence of distinctive sedimentary structures leaves open the
> possibility that this rock is igneous (and altered)." (Pelican Point,
> Preliminary Scientific Assessment, 25-33)

### Testable questions

- **Q-S1.** Do outcrops at the survey target show distinctive sedimentary
  structures at outcrop scale?
  - Present → favours `hyp-sedimentary` over `hyp-crystalline-igneous`.
    Pyroclastic deposits can also be layered, so this may not separate
    sedimentary from pyroclastic.
  - Absent → favours none ("leaves open", 25-33).
- **Q-S2.** If structures are found, do they indicate a depositional setting?
  The report says that without them the setting is open: "if the Margin unit
  is sedimentary, it may have been deposited in almost any setting:
  shoreline, fluviolacustrine, aeolian or pyroclastic." (27-2)
- **Q-S3.** Can the survey observe contacts that bear on the relative
  position of Margin outcrops? Open in the source: "their relative position
  within any Margin stratigraphy has not been established." (27-2) Whether a
  stand-off survey can answer this is a reviewer question.

### Observations and instruments

- Mastcam-Z: "Mastcam-Z has cameras that can zoom in, focus, and take 3D
  pictures and video at high speed to allow detailed examination of distant
  objects." (NASA instruments page)
- SuperCam: "It can identify the chemical and mineral makeup of areas on
  Mars as small as a pencil point, from a distance of more than 20 feet
  (7 meters)." (NASA instruments page)
- Limit: natural surfaces can hide structure: "a dusty, light-toned,
  granular, fractured and minimally layered in-place outcrop." (25-2)

### Missing evidence

1. Any geology at Target A (it is a scenario offset; no source places a
   suitable outcrop there).
2. Whether observations after Comet Geyser (sol 1088) found structures
   elsewhere in the Margin (not read).
3. Instrument resolution against expected bed scale (NASA pages are general;
   instrument papers not read).
4. Peer-reviewed Margin-unit literature (R1 and R2 still blocked).

## 3. Abrade (close-up)

### What has been done

- Three abrasions, one per core: Amherst Point (25-2), Bills Bay (Lefroy Bay
  report) and Castle Geyser (27-2).
- The first showed "a moderately to poorly sorted medium to coarse-grained,
  aqueously altered rock tentatively identified as a sandstone, with a cement
  likely composed of silica." (25-2)
- At Comet Geyser, neither texture nor chemistry decided the origin:
  - "The rock texture is consistent with a moderately to poorly sorted coarse
    sandstone or an altered igneous rock." (27-30)
  - "Mineralogy and chemistry are consistent with a sandstone (possibly at
    least partially altered in-situ), or a heavily altered igneous rock, e.g.
    a listvenite." (27-30)

### Possible new output

Close-up texture and chemistry of a Margin rock expression not yet abraded,
for comparison with the three abrasions. The one source-named candidate in
the sections read:

- The western Margin has two expressions: "resistant dark-toned
  high-standing and often massive outcrop interbedded with lighter-toned
  low-lying rocks." (27-2)
- The sampled workspace is the first of these: "The Bunsen Peak workspace
  consists of a high-standing, resistant, dark-toned and smooth rock which
  stands ~ 1 m above lighter-toned low-lying rocks." (27-2)
- The eastern samples come from different-looking ground: "mostly tabular or
  plate-like outcrop … in a relatively flat landscape." (27-2)

None of the three abrasions is described as being on the lighter-toned
low-lying western rocks. What those rocks are is not established here.

### Testable questions

- **Q-B1.** Does a not-yet-abraded rock expression (for example the
  lighter-toned low-lying western rocks) differ in grain texture, cement and
  chemistry from Amherst Point, Bills Bay and Castle Geyser?
- **Q-B2.** Is there an abraded texture or chemistry that only one origin
  explains? **The sources read do not specify one.** A reviewer must define
  it before Abrade can be assessed for hypothesis discrimination.

### Observations and instruments

- PIXL: "It identifies chemical elements at a tiny scale."
- SHERLOC: "SHERLOC uses cameras, spectrometers, and a laser to search for
  organics and minerals that have been altered by watery environments".
- WATSON: "SHERLOC is assisted by WATSON, a color camera for taking close-up
  images of rock grains and surface textures."

(All three: NASA instruments page.)

### Missing evidence

1. A discriminating outcome (reviewer). Without it, Abrade's discrimination
   stays unsupported. **This is not evidence that abrasion has no scientific
   value.**
2. Whether the lighter-toned low-lying rocks were abraded after sol 1088 (not
   verified).
3. Geology and accessibility at Target B.
4. Any source showing abrasion data deciding a lake origin. None in this
   dataset; that matters because `Abrade → gap-lake-connection` is one of the
   three individually pivotal inputs.

## 4. Core (for Earth laboratories)

### What has been done

- Three Margin cores: "Comet Geyser is the third sample of the Margin
  campaign" (27-2).
- They are already proposed for the laboratory questions:
  - "analyses of the three Margin unit samples could document details of
    their igneous origin (provided adequately unaltered material remains)."
    (27-2)
  - "Crystallization ages of detrital igneous clasts and/or minerals within
    the Pelican Point sample would provide upper bounds on the timing of
    deposition of the Margin unit." (25-34)
- The samples differ: "Comet Geyser appears more enriched in alteration
  materials than either of the other Margin unit samples." (27-2)

### Possible new output

A sealed core of a Margin rock expression that the three cores do not
represent. How its carbonate formed could be tested in Earth laboratories,
but only if the core is returned:

> "the origin of the carbonate, whether detrital grains or the result of in
> situ alteration, is still unknown." (Comet Geyser, Returned Sample Science
> Considerations, 27-32)

> "Detailed laboratory study of the suite of grains/clasts would address this
> unknown" (27-32)

### Testable questions

- **Q-C1 (only if returned).** Did the carbonate form as detrital grains or
  in situ? This is a question about the **carbonate's formation process**,
  not directly about the **host rock's origin** (sedimentary or igneous).
  - Detrital carbonate grains → favours `hyp-sedimentary` (the source frames
    this as "a source-to-sink sedimentary system").
  - Carbonate formed in situ → informs the alteration process, for example
    "pervasive water/rock interaction leading to extensive mineral
    carbonation likely in a subsurface environment" (27-31). **On its own it
    does not favour either host rock.** In-situ alteration is stated as
    compatible with both: "consistent with a sandstone (possibly at least
    partially altered in-situ), or a heavily altered igneous rock" (27-30).
    The host rock's origin needs its own evidence.
- **Q-C2 (before coring, in situ).** Does Target C sample a rock expression
  the three cores do not represent? This decides whether a fourth core adds
  to what the three already offer.
- **Q-C3 (only if returned).** Crystallization ages bounding deposition, as
  already proposed for Pelican Point (25-34).

### Observations and instruments

- Coring and sealing, with in situ characterisation before coring (as in the
  existing campaign).
- Laboratory grain/clast study only after return.

### Condition

As retrieved on 2026-11-07, NASA's page says: "Mars Sample Return (MSR) was
a proposed multi-mission campaign by NASA and ESA (European Space Agency) to
bring carefully selected samples from Mars to Earth." This report records
only that wording. It draws no inference about programme decisions, and the
wording may change.

### Missing evidence

1. The current official sample-return status beyond this wording.
2. Tube availability (not found).
3. Whether the three existing cores already suffice ("provided adequately
   unaltered material remains", 27-2).
4. Geology at Target C.

The sampled rock itself carries a caveat: "It is not certain that Bunsen
Peak is in-place, but similarities with surrounding bedrock strongly support
a genetic relationship with them." (27-2)

## 5. Evidence that would change the comparison, in priority order

All items are `pending` proposals in the proposals file. None is scored. The
order is by expected effect on the three-way comparison.

| # | Proposal | Why it matters for the comparison |
|---|---|---|
| 1 | `sci1:task-gap:task-standoff-survey->gap-sedimentary-or-igneous` | Survey's best source-supported question is unlinked today (SCI-0 I10): Survey is linked to 1 of 3 open questions. **Hypothetical future result:** only if a reviewer approves this link and SCI-2 adopts it into the scored data would Survey be linked to 2 of 3. No score is computed here. |
| 2 | `sci1:review-note:task-gap:task-abrasion-proximity->gap-lake-connection` | This existing link is individually pivotal for #1 (SCI-0). No source here supports it. Suggests "Consider needs_revision" to the reviewer. |
| 3 | `sci1:review-note:task-gap:task-standoff-survey->gap-formation-unknown` | A loose "input to" link that counts in Survey's score. Suggests "Consider needs_revision"; proposal 1 is the sourced route. |
| 4 | `sci1:discrimination:task-standoff-survey`, `…:task-abrasion-proximity`, `…:task-core-for-earth` | Hypothesis discrimination is Not Evaluated for all three today (SCI-0 I7). Survey and Core get sourced, one-sided outcomes (Core only if returned). Abrade gets an explicit "no source-supported outcome yet", which is not "no value". |
| 5 | `sci1:hypothesis-support:interp-silica-cemented-sandstone=>hyp-sedimentary`, `…:interp-altered-igneous=>hyp-crystalline-igneous` | Evidence quality is identical (1.0) for all three because only orbital data are linked to the hypotheses (SCI-0 I4, I6). **A new relationship type: needs a schema change in SCI-2.** |
| 6 | `sci1:assumption:asm-sample-return` | Core's lab value rests on this condition; the display should carry it (SCI-0 I14, I15). |
| 7 | `sci1:assumption:asm-instrument-capability` | Replaces an uncited MDI summary with NASA's descriptions (SCI-0 I13). No score effect. |
| 8 | `sci1:locator:pds-quote-in-comet-geyser-report` | Provenance correction (finding F1). No score effect. |

The agent does not apply any of these. Approval, rejection or revision is a
named reviewer's decision; moving approved items into the scored scenario,
and any schema change, is SCI-2.

## 6. Findings

- **F1. Wrong report named in four citations.** Two quotes cited as
  "Pelican Point initial report" are in the **Comet Geyser** report
  (M2020-1088-27, Returned Sample Science Considerations, 27-32):
  - "Detailed laboratory study of the suite of grains/clasts would address
    this unknown";
  - "the origin of the carbonate, whether detrital grains or the result of in
    situ alteration, is still unknown."

  They appear in four places:
  - the scenario link `task-core-for-earth → gap-sedimentary-or-igneous`;
  - the scenario discrimination `da-core-detrital-carbonate`, citation 1;
  - two registry evidence entries.

  The quotes are verbatim, and the engine does not read locators, so no score
  is affected. `verify:sci1` prints where each quote is found. The correction
  is proposed, not applied, because it touches scored data and registry
  evidence.
- **F2. Sample-return page wording.** On 2026-11-07, NASA's MSR page
  describes MSR in the past tense ("was a proposed multi-mission campaign").
  The dataset's newest status is the December 2023 "will hopefully be brought
  back to Earth". Core's laboratory value is conditional on return. This
  version adds no other status claim.
- **F3. The sampled sites do not span the Margin's outcrop types.**
  - The eastern samples come from "tabular or plate-like outcrop … in a
    relatively flat landscape".
  - The western sample comes from the dark-toned high-standing rock, not the
    lighter-toned low-lying rocks.
  - Relative stratigraphic position "has not been established".

  This is where Abrade and Core could add relative to history. It is not yet
  shown that they would.
- **F4. Abrade's discrimination is undefined.** The latest abrasion did not
  decide sedimentary versus igneous. This is insufficient evidence for a
  discrimination value, not a lack of value.
- **F5. Core's added value over the three cores is not established.** The
  existing cores are already proposed for the same laboratory questions.

## 7. Not done in this version

- No change to the score formula, weights, criteria, evidence hierarchy, the
  scored scenario data, the review registry or any UI text.
- No new task–gap link in the scored data; no review status set.
- No merging or de-duplication of questions (SCI-0 B3 stays a suggestion).
- Not read:
  - instrument papers (resolution, detection limits);
  - operations after sol 1088;
  - peer-reviewed Margin-unit literature (R1 and R2 still blocked);
  - official programme documents beyond the MSR page.

## 8. How to check

```bash
npm run verify:sci1
```

Each PDS quote is checked inside its report and section, with page labels.
The four locator citations are reported with the report they occur in.

```bash
npm run verify:citations
```

All 156 quotes are checked, including the 27 SCI-1 quotes.

```bash
npx vitest run src/lib/evidence
```

This runs the schema and integrity checks. It also asserts that everything
is pending and AI-drafted, and that the provisional ranking is unchanged.

```bash
git diff main -- src/data/scenarios/jezero-margin-unit.json src/data/scenarios/jezero-margin-unit.reviews.json src/lib/decision
```

The output must be empty: the scored data, the registry and the engine are
untouched.
