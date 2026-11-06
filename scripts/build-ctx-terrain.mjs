#!/usr/bin/env node
/**
 * MAP-3A: build a bounded, browser-ready crop of the verified Jezero CTX DTM
 * and the matching CTX orthomosaic, with provenance and validation metadata.
 *
 *   node scripts/build-ctx-terrain.mjs                 # download from Mars Trek
 *   node scripts/build-ctx-terrain.mjs --dtm path.tif  # use a local copy (checksum still verified)
 *   node scripts/build-ctx-terrain.mjs --verify        # rebuild from the live sources into a temporary
 *                                                      # folder and compare with the committed outputs
 *
 * Inputs (both NASA Mars Trek, products JEZ_ctx_B_soc_008):
 *   - DTM:   https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0
 *            float32 GeoTIFF, 20 m posts, equirectangular, Mars 2000 sphere (R = 3,396,190 m)
 *   - Ortho: https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/default/default028mm/{z}/{y}/{x}.png
 *
 * Outputs:
 *   - public/terrain/ctx-lefroy-bay/heights.f32  (float32 LE, row-major north→south, west→east; post centres)
 *   - public/terrain/ctx-lefroy-bay/ortho.png    (8-bit greyscale, exactly the crop's bounds)
 *   - src/data/terrain/ctx-lefroy-bay.json       (source, grid, crop, checksums, validation)
 *
 * Elevations are copied unchanged from the DTM (no resampling, no
 * quantisation, nothing invented). The build fails if the georeferencing does
 * not match the Trek catalog, if the crop contains no-data, or if the DTM
 * disagrees with the PDS sample-site elevations by more than 5 m.
 * Downloads use curl (it honours the HTTPS proxy, like the verify scripts).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const R = 3396190; // Mars 2000 sphere radius, from the DTM's GeoDoubleParams (verified below)
const DEG = 180 / Math.PI;
const DTM_LABEL = "JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0";
const DTM_URL = `https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=${DTM_LABEL}`;
const DTM_META_URL = `https://trek.nasa.gov/mars/TrekWS/rest/cat/metadata/stream?label=${DTM_LABEL}`;
const DTM_SHA256 = "46fb2e1e9f9c1fdd02939c2a96f3e173a8731bd146fbeb969b2060e0a3c8e97e"; // downloaded 2026-11-05 and 2026-11-06, identical
const ORTHO_LAYER = "JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0";
const ORTHO_ZOOM = 13; // the layer's highest native TileMatrix (src/lib/map/trek-layers.ts)
const TILE = 256;
const DEG_PER_PX = 180 / TILE / 2 ** ORTHO_ZOOM;
const CROP_POSTS = 160; // 160 × 20 m = 3.2 km square
const VERIFY = process.argv.includes("--verify");
const COMMITTED_PUBLIC = "public/terrain/ctx-lefroy-bay";
const COMMITTED_META = "src/data/terrain/ctx-lefroy-bay.json";
const VERIFY_DIR = VERIFY ? mkdtempSync(join(tmpdir(), "ctx-terrain-verify-")) : "";
const OUT_PUBLIC = VERIFY ? join(VERIFY_DIR, "public") : COMMITTED_PUBLIC;
const OUT_META = VERIFY ? join(VERIFY_DIR, "ctx-lefroy-bay.json") : COMMITTED_META;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const curl = (url, out) => execFileSync("curl", ["-sS", "-L", "--fail", "--retry", "3", "-o", out, url], { stdio: ["ignore", "ignore", "inherit"] });
const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
};

// ── 1. DTM: download (or read), verify checksum and GeoTIFF tags ──
const work = mkdtempSync(join(tmpdir(), "ctx-terrain-"));
const dtmArg = process.argv.indexOf("--dtm");
const dtmPath = dtmArg > 0 ? process.argv[dtmArg + 1] : join(work, "ctx_dtm.tif");
if (dtmArg < 0) curl(DTM_URL, dtmPath);
const dtm = readFileSync(dtmPath);
if (sha256(dtm) !== DTM_SHA256) fail(`DTM checksum ${sha256(dtm)} differs from the verified ${DTM_SHA256}`);

function readTiff(b) {
  if (b.toString("latin1", 0, 2) !== "II") fail("expected a little-endian TIFF");
  const TYPES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
  const off = b.readUInt32LE(4);
  const n = b.readUInt16LE(off);
  const tags = {};
  for (let i = 0; i < n; i++) {
    const e = off + 2 + 12 * i;
    const tag = b.readUInt16LE(e);
    const type = b.readUInt16LE(e + 2);
    const count = b.readUInt32LE(e + 4);
    const size = TYPES[type] * count;
    const at = size <= 4 ? e + 8 : b.readUInt32LE(e + 8);
    const vals = [];
    for (let k = 0; k < count; k++) {
      if (type === 2) break;
      if (type === 3) vals.push(b.readUInt16LE(at + 2 * k));
      else if (type === 4) vals.push(b.readUInt32LE(at + 4 * k));
      else if (type === 12) vals.push(b.readDoubleLE(at + 8 * k));
      else if (type === 11) vals.push(b.readFloatLE(at + 4 * k));
    }
    tags[tag] = type === 2 ? b.toString("latin1", at, at + count).replace(/\0+$/, "") : vals;
  }
  return tags;
}
const t = readTiff(dtm);
const W = t[256][0];
const H = t[257][0];
const checks = [
  [t[258][0] === 32 && t[339][0] === 3, "float32 samples"],
  [t[259][0] === 1, "uncompressed"],
  [t[277][0] === 1, "one band"],
  [t[33550][0] === 20 && t[33550][1] === 20, "20 m pixel scale"],
  [t[34736][5] === R && t[34736][6] === R, "Mars 2000 sphere radius 3,396,190 m"],
  [/Equirectangular Mars 2000 Sphere IAU/.test(t[34737]), "equirectangular Mars 2000 sphere CRS"],
  [t[34736][0] === 0 && t[34736][1] === 0, "standard parallel 0, central meridian 0"],
];
for (const [ok, what] of checks) if (!ok) fail(`DTM tag check: ${what}`);
const nodata = Number(t[42113]);
const [, , , X0, Y0] = t[33922];
// The georeferencing must reproduce the Trek catalog bbox (src/data/geo/jezero-geo.json, extent-ctx-dtm).
const geo = JSON.parse(readFileSync("src/data/geo/jezero-geo.json", "utf8"));
const catalog = geo.records.find((r) => r.id === "extent-ctx-dtm").bbox;
const scene = [(X0 / R) * DEG, ((Y0 - H * 20) / R) * DEG, ((X0 + W * 20) / R) * DEG, (Y0 / R) * DEG];
const bboxErr = Math.max(...scene.map((v, i) => Math.abs(v - catalog[i])));
if (bboxErr > 1e-6) fail(`DTM corners ${scene} differ from the catalog bbox ${catalog} by ${bboxErr}°`);

// Read one float32 post (strips of one row each).
const strips = t[273];
const heightAt = (col, row) => dtm.readFloatLE(strips[row] + 4 * col);

// ── 2. Crop: a square around the Lefroy Bay area that contains every verified
//    sample site in this margin set and every scenario-defined target. ──
const sites = geo.records.filter((r) => r.kind === "sample-site");
const scenario = JSON.parse(readFileSync("src/data/prototype/mission-glass.json", "utf8"));
const anchor = sites.find((s) => s.id === "sample-lefroy-bay").position;
const MPD = R / DEG;
const targets = scenario.targets.map((tg) => [anchor[0] + tg.offsetM.east / (MPD * Math.cos(anchor[1] / DEG)), anchor[1] + tg.offsetM.north / MPD]);
const pts = [...sites.map((s) => s.position), ...targets];
const lonC = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
const latC = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
const colC = ((lonC / DEG) * R - X0) / 20;
const rowC = (Y0 - (latC / DEG) * R) / 20;
const col0 = Math.round(colC - CROP_POSTS / 2);
const row0 = Math.round(rowC - CROP_POSTS / 2);
if (col0 < 0 || row0 < 0 || col0 + CROP_POSTS > W || row0 + CROP_POSTS > H) fail("crop outside the DTM");
const heights = new Float32Array(CROP_POSTS * CROP_POSTS);
let min = Infinity;
let max = -Infinity;
for (let r = 0; r < CROP_POSTS; r++)
  for (let c = 0; c < CROP_POSTS; c++) {
    const v = heightAt(col0 + c, row0 + r);
    if (!Number.isFinite(v) || v <= nodata / 2) fail(`no-data in the crop at ${c},${r}`);
    heights[r * CROP_POSTS + c] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
const west = ((X0 + col0 * 20) / R) * DEG;
const north = ((Y0 - row0 * 20) / R) * DEG;
const east = ((X0 + (col0 + CROP_POSTS) * 20) / R) * DEG;
const south = ((Y0 - (row0 + CROP_POSTS) * 20) / R) * DEG;
for (const [i, p] of pts.entries())
  if (p[0] <= west || p[0] >= east || p[1] <= south || p[1] >= north) fail(`point ${i} ${p} is outside the crop`);

// Bilinear sample at post centres (value of post (c, r) sits at its centre).
const sample = (lon, lat) => {
  const fc = ((lon / DEG) * R - X0) / 20 - col0 - 0.5;
  const fr = (Y0 - (lat / DEG) * R) / 20 - row0 - 0.5;
  const c = Math.floor(fc);
  const r = Math.floor(fr);
  const dx = fc - c;
  const dy = fr - r;
  const h = (cc, rr) => heights[rr * CROP_POSTS + cc];
  return h(c, r) * (1 - dx) * (1 - dy) + h(c + 1, r) * dx * (1 - dy) + h(c, r + 1) * (1 - dx) * dy + h(c + 1, r + 1) * dx * dy;
};
const pds = sites.map((s) => {
  const dtmM = sample(s.position[0], s.position[1]);
  return { id: s.id, pdsElevationM: s.elevationM, dtmElevationM: Math.round(dtmM * 100) / 100, differenceM: Math.round((dtmM - s.elevationM) * 100) / 100 };
});
for (const p of pds) if (Math.abs(p.differenceM) > 5) fail(`DTM vs PDS at ${p.id}: ${p.differenceM} m`);

// ── 3. Orthoimage: Trek tiles at z13 → mosaic → exact crop bounds (bilinear) ──
function decodePng(buf) {
  let i = 8;
  let w, h, ct, bd;
  const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bd = data[8];
      ct = data[9];
      if (bd !== 8 || data[12] !== 0) fail(`unsupported PNG (bit depth ${bd}, interlace ${data[12]})`);
    } else if (type === "IDAT") idat.push(data);
    i += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  if (!ch) fail(`unsupported PNG colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      out[y * stride + x] = (v + [0, a, b, (a + b) >> 1, pr][f]) & 255;
    }
  }
  // Grey value and alpha per pixel.
  const grey = new Uint8Array(w * h);
  const alpha = new Uint8Array(w * h).fill(255);
  for (let k = 0; k < w * h; k++) {
    grey[k] = ch >= 3 ? Math.round((out[k * ch] + out[k * ch + 1] + out[k * ch + 2]) / 3) : out[k * ch];
    if (ch === 2) alpha[k] = out[k * ch + 1];
    if (ch === 4) alpha[k] = out[k * ch + 3];
  }
  return { w, h, grey, alpha };
}
function encodeGreyPng(w, h, px) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = px[y * w + x];
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const tileSpan = TILE * DEG_PER_PX;
const tc0 = Math.floor((west + 180) / tileSpan);
const tc1 = Math.floor((east + 180) / tileSpan);
const tr0 = Math.floor((90 - north) / tileSpan);
const tr1 = Math.floor((90 - south) / tileSpan);
const mw = (tc1 - tc0 + 1) * TILE;
const mh = (tr1 - tr0 + 1) * TILE;
const mosaic = new Uint8Array(mw * mh);
const mAlpha = new Uint8Array(mw * mh);
let tiles = 0;
for (let tr = tr0; tr <= tr1; tr++)
  for (let tcol = tc0; tcol <= tc1; tcol++) {
    const p = join(work, `t_${tr}_${tcol}.png`);
    curl(`https://trek.nasa.gov/tiles/Mars/EQ/${ORTHO_LAYER}/1.0.0/default/default028mm/${ORTHO_ZOOM}/${tr}/${tcol}.png`, p);
    const img = decodePng(readFileSync(p));
    if (img.w !== TILE || img.h !== TILE) fail("unexpected tile size");
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const k = ((tr - tr0) * TILE + y) * mw + (tcol - tc0) * TILE + x;
        mosaic[k] = img.grey[y * TILE + x];
        mAlpha[k] = img.alpha[y * TILE + x];
      }
    tiles++;
  }
const ow = Math.round((east - west) / DEG_PER_PX);
const oh = Math.round((north - south) / DEG_PER_PX);
const ortho = new Uint8Array(ow * oh);
let transparent = 0;
// Mosaic pixel (x, y) covers lon [-180 + (tc0*TILE + x)*d, +d); sample at output pixel centres.
for (let y = 0; y < oh; y++)
  for (let x = 0; x < ow; x++) {
    const lon = west + ((x + 0.5) * (east - west)) / ow;
    const lat = north - ((y + 0.5) * (north - south)) / oh;
    const fx = (lon + 180) / DEG_PER_PX - tc0 * TILE - 0.5;
    const fy = (90 - lat) / DEG_PER_PX - tr0 * TILE - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const g = (xx, yy) => mosaic[yy * mw + xx];
    ortho[y * ow + x] = Math.round(g(x0, y0) * (1 - ax) * (1 - ay) + g(x0 + 1, y0) * ax * (1 - ay) + g(x0, y0 + 1) * (1 - ax) * ay + g(x0 + 1, y0 + 1) * ax * ay);
    if (mAlpha[Math.round(fy) * mw + Math.round(fx)] < 255) transparent++;
  }
if (transparent) fail(`${transparent} ortho pixels in the crop are transparent (outside the mosaic)`);

// ── 4. Alignment check: topographic shading vs DTM slope, on the 20 m grid ──
// Image brightness (high-passed to remove broad albedo) is correlated with the
// DTM slope along a fitted illumination azimuth, for shifts of ±4 posts. A
// gross misregistration (≥ 2 posts) would move the correlation peak. The
// correlation is modest because albedo also varies, so this rules out gross
// offsets but does not prove sub-post registration.
const N = CROP_POSTS;
const img20 = new Float64Array(N * N);
for (let r = 0; r < N; r++)
  for (let c = 0; c < N; c++) {
    let s = 0;
    let k = 0;
    for (let y = Math.floor((r * oh) / N); y < Math.floor(((r + 1) * oh) / N); y++)
      for (let x = Math.floor((c * ow) / N); x < Math.floor(((c + 1) * ow) / N); x++) {
        s += ortho[y * ow + x];
        k++;
      }
    img20[r * N + c] = s / k;
  }
const K = 4;
const hp = new Float64Array(N * N);
for (let r = K; r < N - K; r++)
  for (let c = K; c < N - K; c++) {
    let s = 0;
    for (let y = -K; y <= K; y++) for (let x = -K; x <= K; x++) s += img20[(r + y) * N + c + x];
    hp[r * N + c] = img20[r * N + c] - s / (2 * K + 1) ** 2;
  }
const gx = new Float64Array(N * N);
const gy = new Float64Array(N * N);
for (let r = 1; r < N - 1; r++)
  for (let c = 1; c < N - 1; c++) {
    gx[r * N + c] = heights[r * N + c + 1] - heights[r * N + c - 1];
    gy[r * N + c] = heights[(r - 1) * N + c] - heights[(r + 1) * N + c];
  }
const SHIFT = 4;
const B = K + SHIFT + 2;
const ncc = (azDeg, dx, dy) => {
  const sn = Math.sin(azDeg / DEG);
  const cs = Math.cos(azDeg / DEG);
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let r = B; r < N - B; r++)
    for (let c = B; c < N - B; c++) {
      const a = gx[r * N + c] * sn + gy[r * N + c] * cs;
      const b = hp[(r + dy) * N + c + dx];
      n++;
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
  return (sab - (sa * sb) / n) / Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n));
};
// Fit the illumination azimuth at zero shift (0–175°; the sign of the correlation covers the opposite direction).
let az = { d: 0, v: 0 };
for (let d = 0; d < 180; d += 5) {
  const v = ncc(d, 0, 0);
  if (Math.abs(v) > Math.abs(az.v)) az = { d, v };
}
const sgn = Math.sign(az.v);
let best = { dx: 0, dy: 0, v: -Infinity };
for (let dy = -SHIFT; dy <= SHIFT; dy++)
  for (let dx = -SHIFT; dx <= SHIFT; dx++) {
    const v = sgn * ncc(az.d, dx, dy);
    if (v > best.v) best = { dx, dy, v };
  }
if (Math.max(Math.abs(best.dx), Math.abs(best.dy)) > 2) fail(`orthoimage vs DTM shading peak at ${best.dx},${best.dy} posts: possible misregistration`);

// ── 5. Write outputs ──
mkdirSync(OUT_PUBLIC, { recursive: true });
if (!VERIFY) mkdirSync("src/data/terrain", { recursive: true });
const hBuf = Buffer.from(heights.buffer);
const oBuf = encodeGreyPng(ow, oh, ortho);
writeFileSync(join(OUT_PUBLIC, "heights.f32"), hBuf);
writeFileSync(join(OUT_PUBLIC, "ortho.png"), oBuf);
const round = (v, d = 7) => Math.round(v * 10 ** d) / 10 ** d;
const meta = {
  id: "ctx-lefroy-bay",
  title: "Lefroy Bay area, CTX DTM 20 m (bounded crop)",
  builtBy: "scripts/build-ctx-terrain.mjs",
  retrievedOn: new Date().toISOString().slice(0, 10),
  dtm: {
    sourceId: "trek-jezero-ctx-dtm",
    productLabel: DTM_LABEL,
    downloadUrl: DTM_URL,
    metadataUrl: DTM_META_URL,
    sha256: DTM_SHA256,
    bytes: dtm.length,
    format: "GeoTIFF, float32, uncompressed, 1 band",
    crs: "Equirectangular (standard parallel 0°, central meridian 0°), Mars 2000 sphere R = 3,396,190 m; planetocentric latitude, east-positive longitude",
    verticalDatum: "Heights in metres relative to the Mars areoid (product label: MOLAtopography_DeltaGeoid)",
    postSpacingM: 20,
    scene: { cols: W, rows: H, tiePointM: [X0, Y0], bboxDeg: scene.map((v) => round(v)) },
    noDataValue: nodata,
  },
  crop: {
    col0,
    row0,
    cols: CROP_POSTS,
    rows: CROP_POSTS,
    bboxDeg: [round(west), round(south), round(east), round(north)],
    sizeM: { eastWest: round(CROP_POSTS * 20 * Math.cos(((north + south) / 2) / DEG), 1), northSouth: CROP_POSTS * 20 },
    rationale: "Square 3.2 km crop centred on the verified Margin sample sites (Pelican Point, Lefroy Bay, Comet Geyser) and the scenario-defined targets A–C, which all lie inside it.",
  },
  heights: {
    file: "/terrain/ctx-lefroy-bay/heights.f32",
    encoding: "float32 little-endian, row-major from north to south, west to east; each value is the DTM post at its post centre; copied unchanged",
    minM: round(min, 3),
    maxM: round(max, 3),
    sha256: sha256(hBuf),
  },
  imagery: {
    sourceId: "trek-jezero-ctx-ortho",
    layer: ORTHO_LAYER,
    tileUrlTemplate: `https://trek.nasa.gov/tiles/Mars/EQ/${ORTHO_LAYER}/1.0.0/default/default028mm/{z}/{y}/{x}.png`,
    zoom: ORTHO_ZOOM,
    degPerPx: DEG_PER_PX,
    tiles,
    file: "/terrain/ctx-lefroy-bay/ortho.png",
    width: ow,
    height: oh,
    resampling: "bilinear from the z13 tile mosaic onto the crop's exact bounds; greyscale",
    sha256: sha256(oBuf),
  },
  validation: {
    catalogBboxMaxErrorDeg: bboxErr,
    pdsSampleSites: pds,
    alignment: {
      method:
        "Topographic shading: normalised cross-correlation between the high-passed orthoimage brightness and the DTM slope along a fitted illumination azimuth, on the 20 m grid, for shifts of ±4 posts. The build fails if the peak is more than 2 posts from zero.",
      fittedAzimuthDeg: sgn > 0 ? az.d : az.d + 180,
      bestShiftPosts: [best.dx, best.dy],
      nccAtBest: round(best.v, 4),
      nccAtZero: round(sgn * ncc(az.d, 0, 0), 4),
      interpretation: "Rules out a gross offset (2 posts, 40 m, or more) between imagery and elevations. The correlation is modest because albedo also varies, so sub-post (< 20 m) registration is not demonstrated.",
    },
  },
  caveats: [
    "CTX DTM posts are 20 m apart; the effective resolution is coarser (a few posts). Features smaller than about 60–100 m are not resolved, and nothing here shows rocks or traversability.",
    "Elevations are relative to the areoid, not to the surface of a reference ellipsoid.",
    "The scenario-defined targets are simulated positions; their elevations are read from the DTM only to place them on the surface.",
  ],
};
writeFileSync(OUT_META, `${JSON.stringify(meta, null, 2)}\n`);
console.log(`crop ${CROP_POSTS}×${CROP_POSTS} at col ${col0}, row ${row0}; bbox ${meta.crop.bboxDeg.join(", ")}`);
console.log(`elevation ${min.toFixed(1)} … ${max.toFixed(1)} m; ortho ${ow}×${oh} from ${tiles} tiles`);
for (const p of pds) console.log(`PDS ${p.id}: PDS ${p.pdsElevationM.toFixed(1)} m, DTM ${p.dtmElevationM} m, Δ ${p.differenceM} m`);
console.log(`alignment (shading, azimuth ${meta.validation.alignment.fittedAzimuthDeg}°): best shift ${best.dx},${best.dy} posts (NCC ${best.v.toFixed(3)}; at 0,0: ${meta.validation.alignment.nccAtZero})`);

if (VERIFY) {
  // Everything except the retrieval date must be identical to what is committed.
  const committed = JSON.parse(readFileSync(COMMITTED_META, "utf8"));
  const strip = (m) => JSON.stringify({ ...m, retrievedOn: undefined });
  const problems = [];
  if (sha256(readFileSync(join(COMMITTED_PUBLIC, "heights.f32"))) !== meta.heights.sha256) problems.push("heights.f32 differs from a fresh build");
  if (sha256(readFileSync(join(COMMITTED_PUBLIC, "ortho.png"))) !== meta.imagery.sha256) problems.push("ortho.png differs from a fresh build (Trek tiles changed?)");
  if (strip(committed) !== strip(meta)) problems.push("metadata differs from a fresh build");
  for (const p of problems) console.error(`FAIL  ${p}`);
  if (problems.length) process.exit(1);
  console.log("verify: committed terrain assets match a fresh build from the live sources");
}
