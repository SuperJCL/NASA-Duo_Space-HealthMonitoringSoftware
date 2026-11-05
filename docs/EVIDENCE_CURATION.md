# Evidence curation — Jezero Margin Unit scenario

Data files:
- `src/data/sources.json` (bibliography)
- `src/data/scenarios/jezero-margin-unit.json` (records)

Schemas live in `src/lib/evidence/schema.ts`; integrity rules in
`src/lib/evidence/integrity.ts`.

## Rules

1. **Verbatim quotes only.** Every observation, interpretation and cited gap
   carries at least one quote copied exactly from its source. Each record's
   `statement`/`claim` is a plain-language summary that stays within its quotes.
2. **Separate epistemic categories.**
   - **Observations** describe what an instrument detected, measured or
     imaged, as the source reports it.
   - **Interpretations** are attributed to their authors.
   - **Assumptions and simulated resources** are written by the MDI team and
     labelled in the UI.
3. **Dates.**
   - `availableFrom` equals the `publishedOn` of the latest source a record
     cites. This is enforced, so no quote is ever shown before it was
     published.
   - When a source's own date is unclear, the later plausible date is used.
     Visibility is delayed rather than risking leakage.
4. **Curation choices are visible.** Links that MDI makes and the sources do
   not state are recorded in `curationNote` and shown in the UI. Examples:
   treating SIM 3464 unit Nue as relevant to the margin carbonates; which
   observations address a gap.
5. **Allowed hosts only.** Every source must be readable from the build
   environment. `jezero-data.test.ts` enforces a host allowlist.

6. **Relevance (M3).**
   - `local` means the source explicitly places the record in the margin
     unit (Marginal Carbonates).
   - Anything crater-wide or regional is `regional-context`. It is shown
     separately and never used as local support, as a competing hypothesis,
     or in gap coverage.
7. **Stance (M3).** `hypothesis` marks candidate explanations ("may",
   "alternative hypothesis", "could be"); `interpretation` marks authors'
   conclusions.
8. **Review (M3).** Curated judgements carry a `review`. AI-drafted items stay
   `pending` until a human approves them, and pending items are not scored.

M3 data changes and their reasoning are in `docs/SCIENTIFIC_REVIEW_M3.md`.
After M3 the dataset has 37 verbatim citations (live-verified 2026-11-05).

## Verification performed (2026-11-04)

- **Saved-copy check.** Two research subagents fetched and saved each source,
  and checked their quotes by script. The lead agent then independently
  re-checked every quote in the dataset against those saved copies, with
  whitespace and Unicode normalised: 23 of 23 matched.
- **Live check.** `npm run verify:citations` re-fetched every source from the
  live sites (HTML, plus PDFs via `pdftotext`) and matched all 23 quotes. It
  takes about 80 s, most of it the 190 MB PDS PDF. Re-run it after any data
  edit.
- **PDS quote placement.** Each PDS quote was confirmed to sit in the correct
  sample's section (Pelican Point or Comet Geyser).
- **Ranking check.** Totals at the default snapshot and with all evidence were
  computed by hand and are locked in a regression test.

## Sources used

| id | What | Date used | Notes |
|---|---|---|---|
| `usgs-gazetteer-jezero` | USGS Gazetteer, Jezero | 2010-11-17 | Planetocentric, +East. MDIM 2.1: 18.41° N, 77.69° E, 47.52 km |
| `horgan-2020` | Horgan et al., Icarus 339 (USGS Pubs Warehouse record) | 2019-11-11 | Date is the record's public date. The journal page is not reachable |
| `nasa-pia23380` | NASA Photojournal PIA23380 | 2019-11-12 | |
| `usgs-sim3464` | Sun & Stack, USGS SIM 3464 | 2020-12-02 | The map does not use the term "margin unit". See curation notes |
| `nasa-blog-reading-the-rocks` | NASA blog (Gibbons) | 2023-09-07 | Mineral-carbonation alternative |
| `nasa-blog-within-the-margin` | NASA blog (Buckner) | 2023-09-19 | First margin-unit abrasion, Sol 915 |
| `nasa-meet-lefroy-bay` | NASA "Meet the Mars Samples" #23 | 2023-12-13 | |
| `nasa-blog-comet-geyser` | NASA blog (Broz) | 2024-04-16 | |
| `nasa-blog-science-team-2024` | NASA blog (Stack Morgan) | 2024-08-30 | Three working hypotheses |
| `pds-m2020-initial-reports-vol4` | PDS Mars 2020 Initial Reports Vol. 4 | 2025-05-06 | v1.0 is dated 2024-09-01, but only v2.0 text was verified, so the later date is used |

## Not included

**Unverified leads.** These were seen only in search snippets and not read:
- Zastrow & Glotch 2021 (JGR Planets)
- Tarnas 2021
- Kremer 2019
- Brown 2020
- Williford et al., *Science* (online Dec 2025), "Carbonated ultramafic igneous
  rocks in Jezero crater"
- the NASA/JPL press release on Bunsen Peak, including its "~75% carbonate"
  figure

**Blocked from this environment.**
- Proxy policy: `doi.org`, `www.nasa.gov`, `jpl.nasa.gov`, NCBI/PMC, arXiv.
- Site-level bot protection: `science.org`, `agupubs.onlinelibrary.wiley.com`,
  `hou.usra.edu`, `lpi.usra.edu`, `ui.adsabs.harvard.edu`.

**Margin Unit footprint.** No machine-readable published outline was found.
The Gazetteer does provide a crater-outline WKT polygon, which is a candidate
map layer for M3.

## Known caveats

- Sample numbering differs between NASA pages and PDS. Comet Geyser is NASA
  sample 24, the "21st rock core", and PDS N=27.
- The PDS preface says the rover traversed the unit "Between November 2023 and
  August 2024". NASA blogs report the first margin-unit abrasion on
  2023-09-16. The dataset uses the blog dates for the blog records only.

## Outstanding research tasks (owner decision 7, 2026-11-05)

These are **research tasks, not evidence**. Nothing from them is in the
dataset, and nothing may be cited from them until they have been read and
verified.

| Task | Source | Blocker | To unblock |
|---|---|---|---|
| R1 | Zastrow & Glotch (2021), https://pmc.ncbi.nlm.nih.gov/articles/PMC8243932/ | `pmc.ncbi.nlm.nih.gov` is proxy-denied (not in the allowed domains) | Allow the domain, or upload the PDF |
| R2 | Moreland et al. (2025), https://doi.org/10.1029/2024JE008797 | DOI resolves to agupubs, which returns a Cloudflare bot challenge; `api.crossref.org` is proxy-denied | Upload the PDF (or a PMC copy, if one exists) |
| R3 | PDS sample coring-coordinate convention | Not stated in Initial Reports Vol. 4 or its label | Locate the PDS dossier documentation that defines it |
