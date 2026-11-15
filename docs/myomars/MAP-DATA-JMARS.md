# Mission Map data: JMARS and better terrain for the Lefroy Bay crop

Investigation of 2026-11-15 (all checks below were made on that date from the
cloud container, through its HTTPS proxy). Nothing in the app was changed.

- **[V]** means *verified by request in this environment*.
- **[D]** means *stated by documentation or metadata* (not independently verified).

## 1. What the map uses today

| Use | Product | Resolution | Notes |
|---|---|---|---|
| 3D heights | Trek `JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0` | 20 m posts (effective ≈ 60–100 m) | 160 × 160 crop, bbox 77.31196–77.36595° E, 18.46071–18.51470° N; PDS check −1.7 / −3.2 / −2.6 m (`docs/TERRAIN_3D.md`, `src/data/terrain/ctx-lefroy-bay.json`) |
| 3D drape | Trek `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0`, WMTS z13 | ≈ 5 m/px | 629 × 629 grey PNG |
| 2D basemaps | Viking MDIM 2.1 colour (z0–7), MOLA colour hillshade (z0–7) | 232 m, 463 m | `src/lib/map/trek-layers.ts` |
| 2D overlays | CTX Jezero mosaic (z13); **HiRISE Jezero mosaic `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` (z17)** | 6 m; 25 cm | The HiRISE orthomosaic is already a 2D layer; only the 3D view is CTX-only |

## 2. JMARS

**What it is [D].** JMARS (Java Mission-planning and Analysis for Remote
Sensing) is a **desktop Java GIS** from ASU's Mars Space Flight Facility,
distributed as installers for Windows, macOS and Linux (`jmars_5_public.sh`,
159,653,407 bytes [V]). Release 5.7.5 is dated 2026-11-06. It is open source
(GPL); the source is in Subversion at `oss.mars.asu.edu`.
Sources: https://jmars.asu.edu/, https://jmars.asu.edu/download,
https://jmars.asu.edu/open_source.

**Mars data it offers [D]** (https://jmars.asu.edu/getting-started):
- footprints and rasters from THEMIS, MOC, CTX, HiRISE, CRISM, Viking, HRSC
  and OMEGA;
- mosaics from THEMIS, Viking and CTX;
- MOLA topography;
- TES and GRS/HEND maps.

It has a HiRISE DTM stamp layer, which lists the HiRISE team's DTM products
and shows a shaded relief
(https://jmars.asu.edu/high-resolution-imaging-science-experiment-hirise-dtm-stamp-layer).
JMARS says its datasets come from the instrument teams and the PDS. It hosts
copies; it does not produce new terrain.

**How its data can be reached:**

| Route | Result |
|---|---|
| Desktop client | Needs outbound ports 80 and 443 to `*.mars.asu.edu` [D] (https://jmars.asu.edu/faq). Every `*.mars.asu.edu` host tried here is **refused by the egress proxy (CONNECT 403)** [V]: `jmars.mars.asu.edu`, `cmapsrv.mars.asu.edu`, `www.mars.asu.edu`. `oss.mars.asu.edu` does not resolve [V]. Only `jmars.asu.edu` (the website) is open. |
| Public WMS or download URLs | None is documented on jmars.asu.edu [V: pages read]. `https://jmars.asu.edu/maps?SERVICE=WMS&REQUEST=GetCapabilities` only redirects (301) to plain http on the website host [V]. The map server's address is inside the client's configuration, not published. |
| Export | Manual, from the desktop app: georeferenced image export (the tutorial is on `jmars.mars.asu.edu`, blocked here) and "Save 3D Printer File" (STL) in the 3D layer [D] (https://jmars.asu.edu/3d-layer, https://jmars.asu.edu/node/2926) |
| Login | Not determined. The pages read do not say whether a login is required for the public data, and the client could not be run here. |
| Jezero sources inside JMARS | Could not be listed: the layer catalogue is served from `*.mars.asu.edu` (blocked). |

**Verdict: blocked** for this project. JMARS needs the desktop app, and its
data hosts are blocked by the proxy. Exports would be manual and not
reproducible by a build script. Its Jezero terrain comes from the same
original archives (HiRISE team/PDS, USGS), and those can be reached directly
(section 3).

## 3. Candidate datasets for the bbox

### 3a. HiRISE DTM mosaic (Mars 2020 TRN, USGS): **feasible now**

**Product and access**

| Fact | Value |
|---|---|
| Label (Trek) | `JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40`, "MRO HiRISE, Jezero DEM, Controlled" [V: Trek `searchItems` and `metadata/stream`] |
| Producer | USGS Astrogeology, for Mars 2020 Terrain Relative Navigation. DOI https://doi.org/10.5066/P9REJ9JN, published 2020-07-24 [D: https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic]. Reference: Fergason et al. 2020, LPSC 51, https://www.hou.usra.edu/meetings/lpsc2020/pdf/2020.pdf |
| Coverage | Catalog bbox 77.2229331–77.583964° E, 18.3067994–18.669315° N, which contains the crop. The GeoTIFF corners reproduce the catalog bbox within 5 × 10⁻⁸° [V]. **0 no-data posts in the 3201 × 3201 crop** [V] |
| Grid | 21,400 × 21,488 posts, 1 m. float32, uncompressed, one row per strip [V: tags] |
| CRS | Equirectangular, standard parallel 0°, central meridian 0°, Mars 2000 sphere R = 3,396,190 m. Tie point (4,577,366, 1,106,618) m [V: GeoTIFF tags; S3 ISIS label] |
| Longitude convention | Planetocentric, east-positive, domain 180 [V: S3 `.lbl`]. Same convention as the app |
| Units | Horizontal metres (projected). Note: east–west ground spacing is cos 18.5° ≈ 0.948 m. Vertical: metres relative to the areoid ("MOLAtopography_DeltaGeoid"), the same convention as the CTX DTM [D: label name] |
| No-data value | −3.40282265508890445e+38 (GDAL_NODATA) [V] |
| Accuracy | Controlled to the CTX DTM (the LVS map). Median vertical offset from the CTX DTM mosaic is about 0.4 m. Ortho co-registration is better than 3 m at the 99th percentile [D: USGS FGDC metadata `.xml` on S3] |
| Licence / credit | Metadata: access and use constraints "None" [D]. Credit: USGS Astrogeology Science Center; data source MRO HiRISE (NASA/JPL/University of Arizona); cite the DOI above |
| Trek download | `https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=…blend40`. 1,839,718,122 B, SHA-256 `8be70f1a933a50878ad0e8ae2fa8665f0c11a84b3b77506f5a927e3fd1f34559` [V]. Took 112 s at 16.4 MB/s. **Range is ignored** (200, not 206) and the TIFF directory is at the end, so the whole file must be downloaded [V] |
| USGS S3 copy (recommended) | `https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif`. 1,839,545,409 B, ETag `"50aff29b9a8b2355e780149fbccbcc24-220"`, Last-Modified 2022-11-10 [V]. **Supports Range (206)** [V]. The directory is at offset 8. Rows are contiguous: data starts at byte 172,609, each row is 85,600 B. The georeferencing tags are identical to Trek's [V] |
| USGS product-page download | `planetarymaps.usgs.gov/...` is **blocked by the proxy (403)** here [V]. The S3 bucket above is the "Individual images, DTMs, and metadata" location named on the USGS page |

**Subset fetch and validation [V]**

- **Fetching the crop.** For the crop (columns 5277–8477, rows 9164–12364;
  3201 × 3201 posts covering the CTX crop bbox), I made 3,201 row-range
  requests to S3: 41.0 MB in 12 s.
- **Identical to the Trek file.** The crop is byte-identical to the same crop
  cut from the full Trek download. Crop SHA-256:
  `d8195d8d68474e065a745068d5fcb6a6f22ca40f6c3366ad5f0478de96f93461`.
- **Elevation range of the crop:** −2,468.56 to −2,225.63 m. The CTX crop
  gives −2,466.80 to −2,222.89 m.

Elevations at the PDS sample sites. Values are bilinear at post centres, using
the same method as `build-ctx-terrain.mjs`:

| Site | PDS (m) | HiRISE 1 m (m) | HiRISE − PDS | CTX − PDS (committed) | HiRISE − CTX |
|---|---|---|---|---|---|
| Pelican Point | −2,423.10 | −2,423.24 | **−0.14** | −1.73 | +1.59 |
| Lefroy Bay | −2,407.64 | −2,407.73 | **−0.09** | −3.15 | +3.06 |
| Comet Geyser | −2,382.43 | −2,383.50 | **−1.07** | −2.56 | +1.49 |

**Whole crop compared with CTX.** I took the mean of the 1 m posts inside
each 20 m CTX post and subtracted the CTX value, over all 160 × 160 posts.
The two grids are offset by 0.75 m, so the block bounds are approximate to
within 1 m. Results:
- mean −0.22 m, median −0.30 m, RMS 3.22 m;
- 5th and 95th percentiles −5.25 and +4.95 m;
- maximum |Δ| 17.25 m.

This is consistent with the 0.4 m median offset that USGS states. The two
DTMs agree, but HiRISE resolves the relief that CTX smooths.

**Caveat.** The PDS sample elevations may themselves derive from rover
localisation on HiRISE-based maps. If so, the sub-metre agreement is not a
fully independent check. This was not verified.

### 3b. HiRISE orthomosaic tiles (Trek WMTS): **feasible now**

- **Layer:** `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd`,
  the layer the 2D map already uses.
- **Zoom levels:** the capabilities list TileMatrix 0–17 [V]:
  - z17 is 0.318 m/px. The tile `17/52072/187394` over Lefroy Bay returned
    200 (256², grey and alpha) [V].
  - z18 returns 404 [V].
- **Coverage at z14** (2.54 m/px) [V]:
  - the bbox needs 36 tiles (x 23421–23426, y 6506–6511; 2,150,581 B);
  - 1,582,564 pixels inside the bbox, **0 non-opaque** (no gaps).
- **Full file:** 9,822,748,524 B on Trek and S3, so the tiles are the
  practical route [V: catalog `fileSize`, S3 listing].
- **Other version:** a JPL surface-operations version also exists on S3,
  `JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif` (3.4 GB, LZW). It
  uses an **orthographic** projection centred on 77.4298° E, 18.4663° N [D]
  and is not in Trek.

### 3c. Labels that do not exist

The Trek metadata endpoint returns HTTP 500 (NullPointerException) for these
labels, which means they are not in the catalog [V]:
- `JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0` (no `_blend40`);
- `JEZ_hirise_soc_007_orthoMosaic_25cm_Eqc_latTs0_lon0`.

The working labels are the `_blend40` DTM and the `_first_dd` orthomosaic.

### 3d. Individual HiRISE DTMs (University of Arizona, PDS): **no coverage**

**USGS Analysis Ready Data** (`astrogeo-ard` S3 bucket, STAC items, Cloud
Optimized GeoTIFFs, licence CC0-1.0 [V: STAC item]):
- 981 controlled HiRISE DTMs are listed. Only
  `DTEEC_002387_1985_003798_1985_A01` intersects the bbox ("Depositional fan
  in Jezero Crater", UA).
- Its footprint polygon runs from 77.3441 to 77.4661° E. At 18.48° N its west
  edge is ≈ 77.357° E, which is east of all three sample sites. It does
  **not** cover the crop.

`uahirise.org` and `hirise-pds.lpl.arizona.edu` are blocked by the proxy
(403), so the UA site could not be checked directly.

**TRN component DTMs.** The seven TRN component DTMs on S3 (`Jezero_C`,
`DL`, `E`, `N`, `W`, `CR_NORTH`, `CR_SOUTH`; 1 m, 72–132 MB each) are the
inputs of the mosaic in 3a. Use the mosaic instead.

## 4. Is HiRISE actually better for a 3 km view about 1400 px wide?

**Elevation**

- **CTX:** 20 m posts (160² across the crop). Its effective resolution is
  60–100 m, which is coarser than one screen pixel group at this size.
- **HiRISE 1 m:** 3201² posts = 41 MB float32. That is too large for the
  browser and finer than the screen: about 2.2 m per screen pixel.
- **Recommended: 5 m posts** (640² = 1.64 MB float32, about 410 k vertices).
  The posts are 4× finer than CTX, at a mesh size WebGL handles. The
  alternative is 4 m (800², 2.56 MB).
- **Downsampling method:** each output post is the **mean of the 5 × 5 real
  1 m posts** in its block. Nothing is interpolated or invented, and the
  build fails on any no-data post.
- **Block grid:** snap the crop to the HiRISE grid (integer metres from the
  tie point), not to the CTX grid.
- **Effective resolution:** HiRISE DTMs are commonly quoted as a few posts,
  so about 3–5 m [D, general]. At 5 m posts the view shows real relief at
  roughly 10–20 m scale, against roughly 100 m for CTX.

**Imagery**

- **Current drape:** CTX z13 at 5.1 m/px, with a native 6 m blur.
- **HiRISE z14:** 2.54 m/px, ≈ 1,190 px across the 3.03 km crop. This
  roughly matches a 1400 px view: 36 tiles, 2.2 MB of tiles.
- **HiRISE z15:** 1.27 m/px, ≈ 2,400 px. It is sharper when zoomed in but
  needs about 4× the tiles. The texture would be about 2048².
- **Native z17:** 0.32 m/px is unnecessary at this view size.

## 5. Verdicts

| Candidate | Verdict | Reason |
|---|---|---|
| JMARS (any layer) | **Blocked** | Desktop Java client. Data hosts `*.mars.asu.edu` are refused by the proxy (403). No published WMS or download API. Exports are manual. Login status unknown |
| Trek HiRISE DTM `…_blend40` via `TrekWS/rest/cat/data/stream` | Feasible but heavy | Full 1.84 GB per build (no Range), 2 min here. Verified identical data |
| **USGS S3 HiRISE DTM `…_blend40.tif` with Range requests** | **Feasible now** | 41 MB subset in 12 s, full coverage, no no-data, PDS within −0.14 / −0.09 / −1.07 m |
| **Trek WMTS HiRISE orthomosaic `…_first_dd` (z14 or z15)** | **Feasible now** | Already a 2D layer. Bbox fully opaque at z14 |
| USGS ARD single UA HiRISE DTM (`DTEEC_002387_1985_003798_1985_A01`) | No coverage | Footprint east of the sample sites |
| USGS product-page links (`planetarymaps.usgs.gov`), uahirise.org, HiRISE PDS | Blocked here | Proxy CONNECT 403 |
| JPL `soc_007 … Ortho_blend120` orthomosaic | Not recommended | Orthographic projection, 3.4 GB, not tiled on Trek |

## 6. Recommendation

1. **Adopt now:** a HiRISE 3D terrain built from the USGS S3 copy of the
   `…_blend40` DTM.
   - Fetch it with Range requests: header, strip offsets, then the rows of the
     crop.
   - Verify:
     - the georeferencing tags against the Trek catalog bbox;
     - the crop SHA-256 (`d8195d8d…3461` for the crop in section 3a);
     - 0 no-data posts;
     - PDS agreement at the three sites (keep the ±5 m gate; it now passes
       with a wide margin).
   - Block-average to 5 m.
   - Record the Trek label, S3 URL, ETag, DOI and credit in the metadata.
   - Keep the CTX crop as a fallback and for the alignment test.
2. **Adopt now:** the HiRISE orthomosaic tiles at z14 (or z15) as the 3D
   drape, with the same transparency check. Re-run the alignment check
   against the HiRISE DTM.
3. **Leave:**
   - JMARS (blocked and manual);
   - the full Trek 1.84 GB download per build (unnecessary now that S3 serves
     ranges);
   - the individual UA DTMs (no coverage);
   - the orthographic JPL mosaic.
4. **Update the UI and docs.** The source line and caveats must change
   ("HiRISE DTM, 1 m posts averaged to 5 m"). The "differences under 5 m are
   not meaningful" threshold can be revisited, but only with a stated basis.

## 6a. What was adopted (2026-11-15)

**3D view (`scripts/build-hirise-terrain.mjs`)** — implemented as recommended, with one deliberate
difference: **decimation, not block averaging**.
- The project rule for terrain assets is "elevations copied unchanged, never smoothed". So each
  5 m output post is the 1 m post at the centre of its 5 × 5 block (`col0 + 5k + 2`), unchanged.
  Only 640 of the 3,200 rows are fetched with HTTP Range: 8.2 MB in about 10 s.
- **Checks in the build:**
  - S3 size and ETag;
  - TIFF tags;
  - catalog bbox, max error 5 × 10⁻⁸°;
  - no-data scan;
  - PDS sample sites: −0.15 / −0.12 / −1.15 m;
  - mean difference vs the committed CTX crop: −0.19 m (RMS 3.23 m);
  - shading / slope alignment: best shift 1 cell of 20 m, NCC 0.50 against 0.23 for CTX.
- `--verify` rebuilds from the live sources byte-identically.
- **Assets:**
  - `public/terrain/hirise-lefroy-bay/heights.f32` (640², 1.64 MB);
  - `ortho.png` (1258², z14 HiRISE, 1.17 MB);
  - `src/data/terrain/hirise-lefroy-bay.json`.

**Where it is used**
- **The Mars Base Mission Map's 3D view:** default model "HiRISE 5 m mesh", with "CTX 20 m DTM"
  selectable.
- **The standalone `/legacy/mission-glass` page:** keeps CTX. Its checks and statements are pinned
  to it.
- **The EVA route grid and the plan-sequence profiles:** keep the CTX crop. The route model was
  built and tested on it.
- **The 2D map:** the same HiRISE crop is drawn under the live Trek tiles as an offline copy of
  the mission area, so the area still shows when the network is down.

**Not changed:** heights are never derived from imagery; 1× stays the default exaggeration. The
"differences under N m are not meaningful" statement uses 2 m for HiRISE (measured PDS differences
up to 1.15 m) and 5 m for CTX (up to 3.2 m).

## 7. Reproduction

- **Scripts** (scratchpad, read-only checks):
  - `hirise-dtm-check.mjs`: TIFF tags, crop, no-data, PDS and CTX comparison;
  - `s3-subset.mjs`: Range fetch;
  - `tilecov.py`: tile coverage.
- **Outputs:** in the session scratchpad `ux/jmars/`. The 1.84 GB full file
  was deleted after the check; its SHA-256 is recorded above.
