# Location science briefings (BR-1)

Status: **BR-1 implemented, 2026-11-05,** on branch `br-lefroy-briefing`. One
briefing so far: **Lefroy Bay** (`src/data/briefings/lefroy-bay.json`).

## What a briefing is

A briefing is a small, curated, source-grounded summary of one real location.
It is **separate from the ranking engine**:
- no briefing item is an engine input;
- `lib/evidence` and `lib/decision` never import `lib/briefing`, and a test
  enforces this;
- the engine baseline is byte-identical.

Each item records:
- its id and location id (the MF-0 geographic record);
- a concise claim;
- **one** classification;
- its topic and scope (sample or Margin unit);
- citations: source id, source URL, verbatim quote, report section, page
  labels, and the other reports that share the wording;
- limitations and conditional language;
- provenance.

| Classification | Meaning | Count (Lefroy Bay) |
|---|---|---|
| Measured | An instrument result or a documented rover operation, as reported (historical record) | 15 (7 measurements, 2 site context, 5 operations, 1 NASA sample-status statement) |
| Interpreted | The report's own preliminary interpretation | 2 |
| Open question | An unresolved question stated by the source | 3 (1 about this sample, 2 about the whole Margin unit) |
| Proposed by source | A future investigation the report discusses: conditional on sample return, not an approved NASA activity | 2 |
| Simulated idea | MDI-drafted; review pending; not a NASA plan; no location; does not repeat operations already done here | 2 |

## Verification

**`npm run verify:briefing`** (live). It downloads PDS Initial Reports vol. 4
and splits it into sample reports by page label (`26-N` = Lefroy Bay). It
then checks, for every report quote:
1. **report scope:** the quote is inside the Lefroy Bay report;
2. **section:** it lies in the declared section;
3. **pages:** it lies on the declared page labels;
4. **sharing:** whether the identical wording also appears in the Pelican
   Point or Comet Geyser reports, exactly as declared.

Web sources are checked for presence. On 2026-11-05 it ran **35 location
checks with 0 problems**. A mutation run (wrong section, wrong page, an
undeclared shared quote, and a quote that exists only in Pelican Point's
report) produced 4 out of 4 failures, as expected.

**Other checks:**
- **`npm run verify:citations`** also checks all briefing quotes for
  presence (129 quotes in total).
- **Offline rules** (`src/lib/briefing/integrity.ts`, run at build and in
  tests):
  - allowed classification per topic;
  - shared wording only at Margin-unit scope, with an explicit "identical
    wording" limitation;
  - future investigations must state that return is not guaranteed and that
    they are not an approved NASA activity;
  - simulated ideas must be pending, start with "Simulated idea:", and
    never propose drilling, coring, abrasion or sealing again;
  - quarantined quotes cannot be used;
  - all four operations already performed must be stated.

## Coverage of the first-time-user questions

| Question | Answer in the data | Classification |
|---|---|---|
| What fills the spaces between the grains? | "Silica fills the space between grains, possibly as a cement." (p. 26-1) | Measured (with the report's hedge) |
| What remains uncertain about how it formed? | "probably a sandstone, deposited in a currently uncertain setting … Less likely, an altered igneous deposit" (p. 26-1), plus two Margin-unit-wide questions | Open question |
| Are the future investigations approved NASA missions? | No. Laboratory dating and paleomagnetism are discussed in the report and depend on return, which NASA's page calls hoped for (2023-12) | Proposed by source, plus a Measured status statement |
| Is the rover at Lefroy Bay now? | Not answered by the briefing. The geographic data (MF-0) show rover data ending at sol 1176, 2.5 km away, and the data are not live | Geographic record |

## Uncertain claims, quarantine and source notes

- **Shared wording with Pelican Point.** Kept only at Margin-unit scope:
  - the depositional-environment question;
  - the stratigraphy question;
  - the sentence behind the "sedimentary structures" simulated idea.

  Six more shared sentences were **not used**, because Lefroy-specific
  alternatives exist (examples: the "igneous (and altered)" sentence and
  "Bulk composition is that of an altered basalt.").
- **Quarantined:** the Lefroy Bay report's habitability paragraph ends "make
  Pelican Point of great interest for astrobiological investigation" (p.
  26-37), apparently copied text. Its conclusion is not used.
- **Source notes** (kept verbatim, not corrected):
  - "Lake Newell" vs "Lake Newall";
  - "Ls 136,6" (decimal comma);
  - NASA's "Sample 23" vs the PDS designation M2020-949-26;
  - the report date (2023-12-18) inside volume version 2.0 (2025-05-06).
- **Preliminary status.** All interpretations are "preliminary" or
  "tentative" in an initial report. Newer literature is not in the dataset
  (journals blocked; research tasks R1 and R2).
- **Spectral identifications are model-based** ("can be assigned to"); the
  limitation says so.
