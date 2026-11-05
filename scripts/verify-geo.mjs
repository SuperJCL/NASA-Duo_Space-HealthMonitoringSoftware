#!/usr/bin/env node
/**
 * Live cross-checks of the committed geographic data (MF-0).
 *
 *   npm run verify:geo
 *
 * 1. Traverse: re-queries the Mars Trek service and compares segment count,
 *    sols, rover motion counters and lengths with src/data/geo/perseverance-traverse.json.
 * 2. Traverse catalog bbox: every committed vertex lies inside it.
 * 3. Elevation: downloads the CTX DTM (≈ 9.7 MB, float32 GeoTIFF on the Mars
 *    2000 sphere) and compares it with the PDS elevation at each sample site.
 *    Agreement supports the inferred convention (planetocentric latitude,
 *    east longitude, areoid-referenced elevation); see docs/GEO_DATA.md.
 *
 * Exit code 1 on any failed check. Uses curl, which honours the HTTPS proxy.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const geo = JSON.parse(readFileSync(join(root, "src/data/geo/jezero-geo.json"), "utf8"));
const traverse = JSON.parse(readFileSync(join(root, "src/data/geo/perseverance-traverse.json"), "utf8"));

const R = 3396190; // IAU 2000 Mars sphere, as in src/lib/map/mars-geodesy.ts
const M_PER_DEG = (2 * Math.PI * R) / 360;
const DTM_LABEL = "JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0";
const ELEVATION_TOLERANCE_M = 10;

let failures = 0;
const check = (ok, message) => {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"}  ${message}`);
};
const get = (url, file) =>
  execFileSync("curl", ["-sSf", "--max-time", "300", ...(file ? ["-o", file] : []), url], { maxBuffer: 1 << 28 });

// 1. Traverse attributes
const query = new URLSearchParams({ where: "1=1", outFields: "FID,sol,fromRMC,toRMC,length", returnGeometry: "false", f: "json" });
const live = JSON.parse(get(`${traverse.service}/query?${query}`).toString()).features.map((f) => f.attributes);
check(live.length === traverse.segmentCount, `traverse segment count: live ${live.length}, committed ${traverse.segmentCount}`);
const byFid = new Map(live.map((a) => [a.FID, a]));
const mismatched = traverse.segments.filter((s) => {
  const a = byFid.get(s.fid);
  return !a || a.sol !== s.sol || a.fromRMC !== s.fromRMC || a.toRMC !== s.toRMC || a.length !== s.length;
});
check(mismatched.length === 0, `traverse attributes match per segment (${mismatched.length} mismatch(es))`);
const liveSols = live.map((a) => a.sol);
check(
  Math.min(...liveSols) === traverse.solRange[0] && Math.max(...liveSols) === traverse.solRange[1],
  `traverse sol range: live ${Math.min(...liveSols)}–${Math.max(...liveSols)}, committed ${traverse.solRange.join("–")}`,
);

// 2. Catalog bbox of the traverse product
const item = get(`https://trek.nasa.gov/mars/TrekServices/ws/index/eq/getItem?productLabel=Perseverance_Traverse_Path`).toString();
const bbox = /"bbox":"([^"]+)"/.exec(item)?.[1]?.split(",").map(Number);
check(Boolean(bbox), `traverse catalog bbox found: ${bbox?.join(", ")}`);
if (bbox) {
  const [w, s, e, n] = bbox;
  const outside = traverse.segments.flatMap((x) => x.lines.flat()).filter(([lon, lat]) => lon < w || lon > e || lat < s || lat > n);
  check(outside.length === 0, `all committed traverse vertices inside the catalog bbox (${outside.length} outside)`);
}

// 3. CTX DTM elevation at the PDS sample sites
/** Minimal reader for an uncompressed, stripped, single-band float32 little-endian GeoTIFF. */
function readFloatTiff(buf) {
  if (buf.toString("latin1", 0, 2) !== "II" || buf.readUInt16LE(2) !== 42) throw new Error("not a little-endian classic TIFF");
  const ifd = buf.readUInt32LE(4);
  const n = buf.readUInt16LE(ifd);
  const tags = new Map();
  const size = { 3: 2, 4: 4, 12: 8 };
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = buf.readUInt16LE(e), type = buf.readUInt16LE(e + 2), count = buf.readUInt32LE(e + 4);
    const bytes = (size[type] ?? 1) * count;
    const at = bytes <= 4 ? e + 8 : buf.readUInt32LE(e + 8);
    const read = (k) => (type === 3 ? buf.readUInt16LE(at + 2 * k) : type === 4 ? buf.readUInt32LE(at + 4 * k) : type === 12 ? buf.readDoubleLE(at + 8 * k) : NaN);
    tags.set(tag, Array.from({ length: Math.min(count, 1 << 20) }, (_, k) => read(k)));
  }
  const one = (t) => tags.get(t)?.[0];
  if (one(259) !== 1 || one(258) !== 32 || one(339) !== 3 || (one(277) ?? 1) !== 1 || tags.has(322)) throw new Error("unsupported TIFF layout");
  return { width: one(256), height: one(257), rowsPerStrip: one(278) ?? one(257), stripOffsets: tags.get(273), scale: tags.get(33550), tie: tags.get(33922) };
}

const work = mkdtempSync(join(tmpdir(), "mdi-geo-"));
try {
  const file = join(work, "ctx-dtm.tif");
  get(`https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=${DTM_LABEL}`, file);
  const buf = readFileSync(file);
  const t = readFloatTiff(buf);
  const dtmExtent = geo.records.find((r) => r.id === "extent-ctx-dtm").bbox;
  const [x0, y0] = [t.tie[3], t.tie[4]];
  const west = x0 / M_PER_DEG, north = y0 / M_PER_DEG;
  check(
    Math.abs(west - dtmExtent[0]) < 1e-5 && Math.abs(north - dtmExtent[3]) < 1e-5,
    `CTX DTM georeference matches the catalog extent (west ${west.toFixed(7)}, north ${north.toFixed(7)})`,
  );
  const elevationAt = (lon, lat) => {
    const col = Math.floor((lon * M_PER_DEG - x0) / t.scale[0]);
    const row = Math.floor((y0 - lat * M_PER_DEG) / t.scale[1]);
    const strip = Math.floor(row / t.rowsPerStrip);
    return buf.readFloatLE(t.stripOffsets[strip] + ((row % t.rowsPerStrip) * t.width + col) * 4);
  };
  for (const s of geo.records.filter((r) => r.kind === "sample-site")) {
    const z = elevationAt(s.position[0], s.position[1]);
    const d = s.elevationM - z;
    check(Math.abs(d) <= ELEVATION_TOLERANCE_M, `${s.name}: PDS ${s.elevationM.toFixed(1)} m, CTX DTM ${z.toFixed(1)} m, difference ${d >= 0 ? "+" : ""}${d.toFixed(1)} m`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${failures} problem(s).`);
process.exit(failures ? 1 : 0);
