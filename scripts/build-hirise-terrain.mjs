#!/usr/bin/env node
/**
 * Build a browser-ready crop of the HiRISE DTM mosaic of Jezero (Mars 2020 TRN, USGS) and the
 * matching HiRISE orthomosaic over the SAME area as the CTX crop (Lefroy Bay), with provenance
 * and validation metadata. It is the default elevation model of the Mission Map's 3D view; the
 * CTX crop (scripts/build-ctx-terrain.mjs) stays for the EVA route grid and as the alternative.
 *
 *   node scripts/build-hirise-terrain.mjs            # fetch the needed rows and tiles, write assets
 *   node scripts/build-hirise-terrain.mjs --verify   # rebuild into a temporary folder and compare
 *
 * Inputs:
 *   - DTM: USGS Astrogeology copy (S3, supports HTTP Range) of the Mars Trek product
 *     JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40
 *     (float32 GeoTIFF, 1 m posts, one row per strip, equirectangular, Mars 2000 sphere,
 *     heights in metres relative to the areoid). DOI https://doi.org/10.5066/P9REJ9JN.
 *     Only the needed rows are fetched (byte ranges); the whole file is 1.84 GB.
 *   - Ortho: Mars Trek WMTS JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd at z14
 *     (≈ 2.5 m/px), mosaicked and resampled (bilinear) onto the crop's exact bounds.
 *
 * Elevations: every 5th post of the 1 m DTM, copied unchanged (the post at the centre of each
 * 5 × 5 block) → 5 m post spacing. Nothing is averaged, smoothed, interpolated or invented.
 * The build fails if the georeferencing does not reproduce the catalog bbox, on any no-data
 * post, if the DTM differs from a PDS sample-site elevation by more than 5 m, if it disagrees
 * with the committed CTX crop by more than 3 m on average, or on a gross image misregistration.
 * Investigation and sources: docs/myomars/MAP-DATA-JMARS.md. Downloads use curl (proxy-aware).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const R = 3396190;
const DEG = 180 / Math.PI;
const LABEL = "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40";
const DTM_URL = `https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/${LABEL}.tif`;
const TREK_URL = `https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=${LABEL}`;
const META_URL = `https://trek.nasa.gov/mars/TrekWS/rest/cat/metadata/stream?label=${LABEL}`;
const DTM_BYTES = 1839545409; // S3 Content-Length, 2026-11-15
const DTM_ETAG = '"50aff29b9a8b2355e780149fbccbcc24-220"'; // S3 ETag, Last-Modified 2022-11-10
const ORTHO_LAYER = "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd";
const ORTHO_ZOOM = 14;
const TILE = 256;
const DEG_PER_PX = 180 / TILE / 2 ** ORTHO_ZOOM;
const STRIDE = 5; // keep every 5th post → 5 m spacing
const SPAN = 3200; // source posts per side (the CTX crop is 160 × 20 m = 3200 m in grid metres)
const N = SPAN / STRIDE; // 640 output posts per side
const VERIFY = process.argv.includes("--verify");
const COMMITTED_PUBLIC = "public/terrain/hirise-lefroy-bay";
const COMMITTED_META = "src/data/terrain/hirise-lefroy-bay.json";
const VERIFY_DIR = VERIFY ? mkdtempSync(join(tmpdir(), "hirise-terrain-verify-")) : "";
const OUT_PUBLIC = VERIFY ? join(VERIFY_DIR, "public") : COMMITTED_PUBLIC;
const OUT_META = VERIFY ? join(VERIFY_DIR, "hirise-lefroy-bay.json") : COMMITTED_META;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
};
const work = mkdtempSync(join(tmpdir(), "hirise-terrain-"));
const curl = (args) => execFileSync("curl", ["-sS", "-L", "--fail", "--retry", "3", ...args], { stdio: ["ignore", "pipe", "inherit"] });
const range = (a, len) => {
  const f = join(work, `r_${a}`);
  curl(["-r", `${a}-${a + len - 1}`, "-o", f, DTM_URL]);
  const b = readFileSync(f);
  if (b.length !== len) fail(`range ${a}+${len}: got ${b.length} bytes (server ignored Range?)`);
  return b;
};

// ── 1. The remote file: identity (size, ETag) and GeoTIFF tags, read with byte ranges ──
const head = curl(["-I", DTM_URL]).toString();
const len = Number(/content-length:\s*(\d+)/i.exec(head)?.[1]);
const etag = /etag:\s*(\S+)/i.exec(head)?.[1];
if (len !== DTM_BYTES || etag !== DTM_ETAG) fail(`remote DTM changed: ${len} bytes, ETag ${etag} (expected ${DTM_BYTES}, ${DTM_ETAG})`);
const hdr = range(0, 65536);
if (hdr.toString("latin1", 0, 2) !== "II" || hdr.readUInt16LE(2) !== 42) fail("expected a little-endian classic TIFF");
const TYPES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
const ifd = hdr.readUInt32LE(4);
const tags = {};
for (let i = 0; i < hdr.readUInt16LE(ifd); i++) {
  const e = ifd + 2 + 12 * i;
  const tag = hdr.readUInt16LE(e);
  const type = hdr.readUInt16LE(e + 2);
  const count = hdr.readUInt32LE(e + 4);
  const size = TYPES[type] * count;
  const at = size <= 4 ? e + 8 : hdr.readUInt32LE(e + 8);
  const data = at + size <= hdr.length ? hdr.subarray(at, at + size) : range(at, size);
  const vals = [];
  for (let k = 0; k < count && type !== 2; k++) {
    if (type === 3) vals.push(data.readUInt16LE(2 * k));
    else if (type === 4) vals.push(data.readUInt32LE(4 * k));
    else if (type === 12) vals.push(data.readDoubleLE(8 * k));
  }
  tags[tag] = type === 2 ? data.toString("latin1").replace(/\0+$/, "") : vals;
}
const W = tags[256][0];
const H = tags[257][0];
const checks = [
  [tags[258][0] === 32 && tags[339][0] === 3, "float32 samples"],
  [tags[259][0] === 1, "uncompressed"],
  [tags[277][0] === 1, "one band"],
  [tags[278][0] === 1, "one row per strip"],
  [tags[33550][0] === 1 && tags[33550][1] === 1, "1 m pixel scale"],
  [tags[34736].includes(R), "Mars 2000 sphere radius 3,396,190 m"],
  [/Equirectangular/i.test(tags[34737] ?? ""), "equirectangular CRS"],
];
for (const [ok, what] of checks) if (!ok) fail(`DTM tag check: ${what}`);
const nodata = Number(tags[42113]);
const [, , , X0, Y0] = tags[33922];
const geo = JSON.parse(readFileSync("src/data/geo/jezero-geo.json", "utf8"));
const catalog = geo.records.find((r) => r.id === "extent-hirise-dtm").bbox;
const scene = [(X0 / R) * DEG, ((Y0 - H) / R) * DEG, ((X0 + W) / R) * DEG, (Y0 / R) * DEG];
const bboxErr = Math.max(...scene.map((v, i) => Math.abs(v - catalog[i])));
if (bboxErr > 1e-6) fail(`DTM corners ${scene} differ from the catalog bbox ${catalog} by ${bboxErr}°`);
const strips = tags[273];

// ── 2. Crop: the CTX crop's area, snapped to the 1 m grid; keep every 5th post ──
const ctx = JSON.parse(readFileSync("src/data/terrain/ctx-lefroy-bay.json", "utf8"));
const [cw, , , cn] = ctx.crop.bboxDeg;
const col0 = Math.round((cw / DEG) * R - X0);
const row0 = Math.round(Y0 - (cn / DEG) * R);
if (col0 < 0 || row0 < 0 || col0 + SPAN > W || row0 + SPAN > H) fail("crop outside the DTM");
const OFF = Math.floor(STRIDE / 2); // the centre post of each 5 × 5 block
const cfg = [];
for (let j = 0; j < N; j++) {
  const a = strips[row0 + j * STRIDE + OFF] + 4 * col0;
  cfg.push(`url = "${DTM_URL}"\nrange = ${a}-${a + 4 * SPAN - 1}\noutput = "${join(work, `row_${String(j).padStart(4, "0")}`)}"\n`);
}
writeFileSync(join(work, "rows.cfg"), cfg.join("next\n")); // "next": range is per transfer
execFileSync("curl", ["-sS", "--fail", "--retry", "3", "--parallel", "--parallel-max", "16", "-K", join(work, "rows.cfg")], { stdio: ["ignore", "ignore", "inherit"] });
const rowsSha = createHash("sha256");
const heights = new Float32Array(N * N);
let min = Infinity;
let max = -Infinity;
const rowFiles = readdirSync(work).filter((f) => f.startsWith("row_")).sort();
if (rowFiles.length !== N) fail(`expected ${N} rows, got ${rowFiles.length}`);
for (let j = 0; j < N; j++) {
  const b = readFileSync(join(work, rowFiles[j]));
  if (b.length !== 4 * SPAN) fail(`row ${j}: ${b.length} bytes`);
  rowsSha.update(b);
  for (let k = 0; k < N; k++) {
    const v = b.readFloatLE(4 * (k * STRIDE + OFF));
    if (!Number.isFinite(v) || v <= nodata / 2) fail(`no-data at output post ${k},${j}`);
    heights[j * N + k] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
}
const west = ((X0 + col0) / R) * DEG;
const north = ((Y0 - row0) / R) * DEG;
const east = ((X0 + col0 + SPAN) / R) * DEG;
const south = ((Y0 - row0 - SPAN) / R) * DEG;

// Bilinear at the centres of the 5 m posts (post k covers source posts [5k, 5k+5), value at its centre).
const sample = (lon, lat) => {
  const fc = (((lon / DEG) * R - X0 - col0) / STRIDE) - 0.5;
  const fr = ((Y0 - (lat / DEG) * R - row0) / STRIDE) - 0.5;
  const c = Math.min(Math.max(Math.floor(fc), 0), N - 2);
  const r = Math.min(Math.max(Math.floor(fr), 0), N - 2);
  const dx = fc - c;
  const dy = fr - r;
  const h = (cc, rr) => heights[rr * N + cc];
  return h(c, r) * (1 - dx) * (1 - dy) + h(c + 1, r) * dx * (1 - dy) + h(c, r + 1) * (1 - dx) * dy + h(c + 1, r + 1) * dx * dy;
};
const sites = geo.records.filter((r) => r.kind === "sample-site");
const pds = sites.map((s) => {
  const v = sample(s.position[0], s.position[1]);
  return { id: s.id, pdsElevationM: s.elevationM, dtmElevationM: Math.round(v * 100) / 100, differenceM: Math.round((v - s.elevationM) * 100) / 100 };
});
for (const p of pds) if (Math.abs(p.differenceM) > 5) fail(`DTM vs PDS at ${p.id}: ${p.differenceM} m`);

// Agreement with the committed CTX crop at the CTX post centres.
const ctxH = new Float32Array(readFileSync(join("public", ctx.heights.file)).buffer.slice(0));
const [cx0, cy0] = ctx.dtm.scene.tiePointM;
let sd = 0;
let sdd = 0;
let nd = 0;
for (let r = 0; r < ctx.crop.rows; r++)
  for (let c = 0; c < ctx.crop.cols; c++) {
    const lon = (((ctx.crop.col0 + c + 0.5) * 20 + cx0) / R) * DEG;
    const lat = ((cy0 - (ctx.crop.row0 + r + 0.5) * 20) / R) * DEG;
    if (lon <= west || lon >= east || lat <= south || lat >= north) continue;
    const d = sample(lon, lat) - ctxH[r * ctx.crop.cols + c];
    sd += d;
    sdd += d * d;
    nd++;
  }
const vsCtx = { posts: nd, meanM: Math.round((sd / nd) * 100) / 100, rmsM: Math.round(Math.sqrt(sdd / nd) * 100) / 100 };
if (Math.abs(vsCtx.meanM) > 3) fail(`HiRISE − CTX mean ${vsCtx.meanM} m: the two models disagree`);

// ── 3. Orthoimage: Trek HiRISE tiles at z14 → mosaic → exact crop bounds (bilinear, grey) ──
function decodePng(buf) {
  let i = 8;
  let w, h, ct;
  const idat = [];
  while (i < buf.length) {
    const n = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + n);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9];
      if (data[8] !== 8 || data[12] !== 0) fail("unsupported PNG");
    } else if (type === "IDAT") idat.push(data);
    i += 12 + n;
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
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 1; // Sub filter (smaller file)
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (px[y * w + x] - (x ? px[y * w + x - 1] : 0)) & 255;
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
const tcfg = [];
for (let tr = tr0; tr <= tr1; tr++) for (let tcol = tc0; tcol <= tc1; tcol++) tcfg.push(`url = "https://trek.nasa.gov/tiles/Mars/EQ/${ORTHO_LAYER}/1.0.0/default/default028mm/${ORTHO_ZOOM}/${tr}/${tcol}.png"\noutput = "${join(work, `t_${tr}_${tcol}.png`)}"\n`);
writeFileSync(join(work, "tiles.cfg"), tcfg.join(""));
execFileSync("curl", ["-sS", "-L", "--fail", "--retry", "3", "--parallel", "--parallel-max", "8", "-K", join(work, "tiles.cfg")], { stdio: ["ignore", "ignore", "inherit"] });
let tiles = 0;
for (let tr = tr0; tr <= tr1; tr++)
  for (let tcol = tc0; tcol <= tc1; tcol++) {
    const img = decodePng(readFileSync(join(work, `t_${tr}_${tcol}.png`)));
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

// ── 4. Alignment check (as for CTX): high-passed image brightness vs DTM slope along a fitted
//    illumination azimuth, on a 20 m grid (4 × 4 blocks of the 5 m posts), shifts of ±4 cells. ──
const G = N / 4; // 160 cells of 20 m
const img20 = new Float64Array(G * G);
const dem20 = new Float64Array(G * G);
for (let r = 0; r < G; r++)
  for (let c = 0; c < G; c++) {
    let s = 0;
    let k = 0;
    for (let y = Math.floor((r * oh) / G); y < Math.floor(((r + 1) * oh) / G); y++)
      for (let x = Math.floor((c * ow) / G); x < Math.floor(((c + 1) * ow) / G); x++) {
        s += ortho[y * ow + x];
        k++;
      }
    img20[r * G + c] = s / k;
    let hs = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) hs += heights[(r * 4 + y) * N + c * 4 + x];
    dem20[r * G + c] = hs / 16; // used only for this check; never written out
  }
const K = 4;
const hp = new Float64Array(G * G);
for (let r = K; r < G - K; r++)
  for (let c = K; c < G - K; c++) {
    let s = 0;
    for (let y = -K; y <= K; y++) for (let x = -K; x <= K; x++) s += img20[(r + y) * G + c + x];
    hp[r * G + c] = img20[r * G + c] - s / (2 * K + 1) ** 2;
  }
const gx = new Float64Array(G * G);
const gy = new Float64Array(G * G);
for (let r = 1; r < G - 1; r++)
  for (let c = 1; c < G - 1; c++) {
    gx[r * G + c] = dem20[r * G + c + 1] - dem20[r * G + c - 1];
    gy[r * G + c] = dem20[(r - 1) * G + c] - dem20[(r + 1) * G + c];
  }
const SHIFT = 4;
const B = K + SHIFT + 2;
const ncc = (azDeg, dx, dy) => {
  const sn = Math.sin(azDeg / DEG);
  const cs = Math.cos(azDeg / DEG);
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let r = B; r < G - B; r++)
    for (let c = B; c < G - B; c++) {
      const a = gx[r * G + c] * sn + gy[r * G + c] * cs;
      const b = hp[(r + dy) * G + c + dx];
      n++;
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
  return (sab - (sa * sb) / n) / Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n));
};
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
if (Math.max(Math.abs(best.dx), Math.abs(best.dy)) > 2) fail(`orthoimage vs DTM shading peak at ${best.dx},${best.dy} cells: possible misregistration`);

// ── 5. Write outputs ──
mkdirSync(OUT_PUBLIC, { recursive: true });
const hBuf = Buffer.from(heights.buffer);
const oBuf = encodeGreyPng(ow, oh, ortho);
writeFileSync(join(OUT_PUBLIC, "heights.f32"), hBuf);
writeFileSync(join(OUT_PUBLIC, "ortho.png"), oBuf);
const round = (v, d = 7) => Math.round(v * 10 ** d) / 10 ** d;
const meta = {
  id: "hirise-lefroy-bay",
  title: "Lefroy Bay area, HiRISE DTM (every 5th post of the 1 m mosaic; bounded crop)",
  builtBy: "scripts/build-hirise-terrain.mjs",
  retrievedOn: new Date().toISOString().slice(0, 10),
  dtm: {
    sourceId: "trek-jezero-hirise-dtm",
    productLabel: LABEL,
    downloadUrl: DTM_URL,
    metadataUrl: META_URL,
    alsoServedAt: TREK_URL,
    doi: "https://doi.org/10.5066/P9REJ9JN",
    bytes: DTM_BYTES,
    etag: DTM_ETAG,
    fetchedRowsSha256: rowsSha.digest("hex"),
    format: "GeoTIFF, float32, uncompressed, 1 band, one row per strip (read with HTTP byte ranges)",
    crs: "Equirectangular (standard parallel 0°, central meridian 0°), Mars 2000 sphere R = 3,396,190 m; planetocentric latitude, east-positive longitude",
    verticalDatum: "Heights in metres relative to the Mars areoid (product label: MOLAtopography_DeltaGeoid)",
    postSpacingM: 1,
    scene: { cols: W, rows: H, tiePointM: [X0, Y0], bboxDeg: scene.map((v) => round(v)) },
    noDataValue: nodata,
  },
  crop: {
    col0,
    row0,
    cols: N,
    rows: N,
    stride: STRIDE,
    bboxDeg: [round(west), round(south), round(east), round(north)],
    sizeM: { eastWest: round(SPAN * Math.cos(((north + south) / 2) / DEG), 1), northSouth: SPAN },
    rationale: "The area of the CTX crop (Lefroy Bay, the verified Margin sample sites and the scenario-defined targets A–C), snapped to the 1 m HiRISE grid; every 5th post (the centre post of each 5 × 5 block) is kept, unchanged, for a 5 m mesh.",
  },
  heights: {
    file: "/terrain/hirise-lefroy-bay/heights.f32",
    encoding: "float32 little-endian, row-major from north to south, west to east; output post (k, j) is DTM post (col0 + 5k + 2, row0 + 5j + 2), copied unchanged; its value sits at the centre of its 5 m cell",
    minM: round(min, 3),
    maxM: round(max, 3),
    sha256: sha256(hBuf),
  },
  imagery: {
    sourceId: "trek-jezero-hirise-ortho",
    layer: ORTHO_LAYER,
    tileUrlTemplate: `https://trek.nasa.gov/tiles/Mars/EQ/${ORTHO_LAYER}/1.0.0/default/default028mm/{z}/{y}/{x}.png`,
    zoom: ORTHO_ZOOM,
    degPerPx: DEG_PER_PX,
    tiles,
    file: "/terrain/hirise-lefroy-bay/ortho.png",
    width: ow,
    height: oh,
    resampling: "bilinear from the z14 tile mosaic onto the crop's exact bounds; greyscale",
    sha256: sha256(oBuf),
  },
  validation: {
    catalogBboxMaxErrorDeg: bboxErr,
    pdsSampleSites: pds,
    versusCtxCrop: { ...vsCtx, method: "HiRISE (bilinear on the 5 m posts) minus the committed CTX crop, at every CTX post centre inside this crop" },
    alignment: {
      method: "Topographic shading: normalised cross-correlation between the high-passed orthoimage brightness and the DTM slope along a fitted illumination azimuth, on a 20 m check grid (block means used only for this check), for shifts of ±4 cells. The build fails if the peak is more than 2 cells from zero.",
      fittedAzimuthDeg: sgn > 0 ? az.d : az.d + 180,
      bestShiftPosts: [best.dx, best.dy],
      nccAtBest: round(best.v, 4),
      nccAtZero: round(sgn * ncc(az.d, 0, 0), 4),
      interpretation: "Rules out a gross offset (2 cells, 40 m, or more) between imagery and elevations. USGS states the orthomosaic is co-registered to the DTM within 3 m (99th percentile); this check does not demonstrate that.",
    },
  },
  caveats: [
    "The 1 m HiRISE DTM resolves relief of a few metres; the 5 m mesh shows every 5th post, so features smaller than about 10–20 m are not shown, and nothing here shows individual rocks or traversability.",
    "Elevations are relative to the areoid, not to the surface of a reference ellipsoid.",
    "The PDS sample-site elevations may themselves come from HiRISE-based localisation, so the close agreement is not a fully independent check.",
    "The scenario-defined targets are simulated positions; their elevations are read from the DTM only to place them on the surface.",
  ],
};
writeFileSync(OUT_META, `${JSON.stringify(meta, null, 2)}\n`);
console.log(`crop ${N}×${N} (stride ${STRIDE}) at col ${col0}, row ${row0}; bbox ${meta.crop.bboxDeg.join(", ")}`);
console.log(`elevation ${min.toFixed(1)} … ${max.toFixed(1)} m; ortho ${ow}×${oh} from ${tiles} tiles; heights ${hBuf.length} B, ortho ${oBuf.length} B`);
for (const p of pds) console.log(`PDS ${p.id}: PDS ${p.pdsElevationM.toFixed(1)} m, DTM ${p.dtmElevationM} m, Δ ${p.differenceM} m`);
console.log(`vs CTX: mean ${vsCtx.meanM} m, RMS ${vsCtx.rmsM} m over ${vsCtx.posts} posts`);
console.log(`alignment (azimuth ${meta.validation.alignment.fittedAzimuthDeg}°): best shift ${best.dx},${best.dy} (NCC ${best.v.toFixed(3)}; at 0,0: ${meta.validation.alignment.nccAtZero})`);

if (VERIFY) {
  const committed = JSON.parse(readFileSync(COMMITTED_META, "utf8"));
  const strip = (m) => JSON.stringify({ ...m, retrievedOn: undefined });
  const problems = [];
  if (sha256(readFileSync(join(COMMITTED_PUBLIC, "heights.f32"))) !== meta.heights.sha256) problems.push("heights.f32 differs from a fresh build");
  if (sha256(readFileSync(join(COMMITTED_PUBLIC, "ortho.png"))) !== meta.imagery.sha256) problems.push("ortho.png differs from a fresh build (Trek tiles changed?)");
  if (strip(committed) !== strip(meta)) problems.push("metadata differs from a fresh build");
  for (const p of problems) console.error(`FAIL  ${p}`);
  if (problems.length) process.exit(1);
  console.log("verify: committed HiRISE terrain assets match a fresh build from the live sources");
}
