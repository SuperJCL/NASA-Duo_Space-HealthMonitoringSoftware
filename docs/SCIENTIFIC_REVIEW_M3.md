# M3 scientific review

Date: 2026-11-05. Reviewer: AI agent. These findings are recommendations for
human review.

## 1. USGS SIM 3464 unit Nue and the Perseverance Margin Unit

### What the sources say

The quotes below are verbatim and were verified live with
`npm run verify:citations`.

- **SIM 3464 (Sun & Stack, 2020-12-02)**
  - It defines the **upper etched unit (Nue)** as a regional unit "located
    along and on the northern Jezero crater rim and wall, along the interior
    margin of Jezero crater, and throughout Nili Planum".
  - The map associates Nue "with olivine and variable carbonate", citing
    earlier orbital studies.
  - It interprets Nue (and Nle by proxy) "as ash-fall or pyroclastic-surge
    deposits due to the draping morphology and banding".
  - It notes that Nue "may not have been affected by lacustrine processes
    like unit Nle".
  - **It never uses the term "margin unit".** Its statement that confirming
    origins needs rover instruments and returned samples refers to "these
    units", meaning its map units.
- **Horgan et al. (2020; public record 2019-11-11)** identifies the
  "Marginal Carbonates" with CRISM, "along the inner margin of the crater,
  near the largest inlet valley and the western delta".
- **NASA blog, 2023-09-07** describes a margin carbonate unit "in a narrow
  band along the inner edge of Jezero's western crater rim". It gives two
  hypotheses: lake deposition and mineral carbonation.
- **NASA blog, 2024-08-30** reports that the Mars 2020 team carries three
  hypotheses "for the origin of this unit: sedimentary, volcanic
  (pyroclastic), or crystalline igneous". This is the first source in the
  dataset that applies a volcanic/pyroclastic hypothesis to the margin unit
  itself.

### Assessment

- Nue and the margin unit overlap geographically (the interior margin), but
  no source in the dataset equates them. Nue is defined regionally, and the
  Marginal Carbonates and the margin unit are defined by carbonate spectra
  and location.
- Treating Nue as the margin unit (the M2 behaviour) was therefore
  **insufficiently supported**.

### Changes in M3

The following records were reclassified as **regional context**. They were
not deleted.

| Record | M2 | M3 |
|---|---|---|
| `obs-upper-etched-unit-mapping` (SIM 3464 Nue) | local observation | regional context |
| `interp-volcanic-drape` (Nue as ash-fall/pyroclastic) | competing hypothesis for the margin unit | regional-context interpretation, not a competing hypothesis |
| `gap-origin-needs-rover` (SIM 3464 "these units") | local gap | regional-context gap (not in coverage) |
| `obs-crism-ctx-mineral-map` (PIA23380, crater-wide) | local observation | regional context: the caption never identifies the margin unit |

New local hypotheses from the 2024-08-30 source:

- `hyp-sedimentary`
- `hyp-volcanic-pyroclastic`, which links to the Nue records as context
  only
- `hyp-crystalline-igneous`

**Enforced rules.** Integrity checks now reject regional context used as
local support, used to address a local gap, or used as a competing
hypothesis. The evidence-quality criterion counts regional context only at
the lowest level.

### Consequence at the default snapshot (2023-09-08)

- **Before.** Three competing interpretations, one of them the Nue
  volcanic drape.
- **After.**
  - Two competing local hypotheses: lacustrine (Horgan 2020) and mineral
    carbonation (NASA 2023).
  - One margin-unit observation (Horgan's CRISM identification).
  - Four regional-context records shown separately.

## 2. Hypotheses vs interpretations, and dates

- **Hypothesis vs interpretation.**
  - `stance: "hypothesis"` marks candidate explanations under consideration:
    "we propose… may", "an alternative hypothesis", "hypotheses we're
    carrying", "could be".
  - `stance: "interpretation"` marks authors' conclusions, e.g. "We therefore
    interpreted…", "tentatively interpreted…".
- **Four kinds of date are kept apart.**

| Date | Meaning | Used for filtering? |
|---|---|---|
| `observedOn` | Acquisition date (e.g. Sol 915 = 2023-09-16) | **No** (a test enforces this) |
| `availableFrom` (observations) | Public availability: latest cited source date | Yes |
| `availableFrom` (hypotheses/interpretations) | Publication date of the claim | Yes |
| Reveal date | `availableFrom` relative to the snapshot, shown as "revealed: N days after snapshot" | Display only |

- **Snapshot policy ("public availability").** A record, task-gap link,
  priority statement or assessment is visible only when every source it
  cites was public on the snapshot date.

## 3. Literature

| Source | Status |
|---|---|
| Zastrow & Glotch (2021), PMC8243932 | **Not accessible.** `pmc.ncbi.nlm.nih.gov` is denied by the environment's network policy (proxy 403); it is not in the allowed-domains list. Nothing from it was added. |
| Moreland et al. (2025), doi:10.1029/2024JE008797 | **Not accessible.** `doi.org` resolves to `agupubs.onlinelibrary.wiley.com`, which returns a Cloudflare bot challenge (`cf-mitigated: challenge`). This is site-level and is not bypassed. The Crossref metadata API (`api.crossref.org`) is also proxy-denied. Nothing from it was added. |

To unblock, use either route:
- Add `pmc.ncbi.nlm.nih.gov` to the allowed domains. If Moreland et al. is
  NASA-funded, it may also be in PMC.
- Upload the PDFs to the session.

## 4. Curated judgements awaiting human review

The AI agent drafted these. They are not scored until approved:

- **Priority statements:**
  - `gap-lake-connection`: Horgan "critical for evaluating the astrobiological
    potential".
  - `gap-formation-unknown`: NASA "pivotal role in selecting Jezero".
- **Task–gap links:** 8 links across 4 tasks, each with a written rationale.
  Three links cite sources.
- **Discrimination assessment:** `da-core-detrital-carbonate`, visible from
  2025-05-06. Its premise is quoted from PDS. Mapping "detrital carbonate" to
  "favors sedimentary" is an inference that needs expert review.

To approve one, set its `review` to
`{ "draftedBy": "ai-agent", "status": "approved", "reviewedBy": "<name>", "reviewedOn": "<date>" }`,
or tell the agent which items to approve.

## 5. Sample coordinates (optional item)

PDS Initial Reports Vol. 4 lists coring coordinates, e.g. Pelican Point
"Latitude (N), Longitude (E), Elevation: 18.48344692°, 77.35065098°". The
report does not state the coordinate convention: planetocentric or
planetographic, or the reference body or datum. Per the M3 instructions, **no
sample markers were added**. This needs the PDS label or the dossier
documentation that defines the convention.
