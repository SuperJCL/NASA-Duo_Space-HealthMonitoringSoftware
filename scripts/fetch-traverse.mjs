#!/usr/bin/env node
/**
 * Regenerate src/data/geo/perseverance-traverse.json from the NASA Mars Trek
 * "Perseverance (Mars 2020) Path" product (ArcGIS MapServer layer 0).
 *
 *   node scripts/fetch-traverse.mjs
 *
 * What it does:
 *  - queries every segment with its attributes (FID, sol, fromRMC, toRMC,
 *    length) as GeoJSON;
 *  - drops the z and m vertex values. The z values are undocumented and are
 *    not surface elevations: on 2026-11-05 they ranged from -3989 to +2559 m,
 *    while the Jezero DTMs span about -2711 to -1516 m. The m values are null;
 *  - simplifies each line with Douglas–Peucker in a local tangent plane on
 *    the Mars 2000 sphere, with a 0.5 m tolerance;
 *  - writes provenance and simplification metadata next to the data.
 *
 * Coordinates are NOT reprojected. ArcGIS labels its GeoJSON output
 * "EPSG:4326", but the service's spatial reference is wkid 104905
 * (GCS_Mars_2000): the values are Mars longitude/latitude in degrees.
 *
 * Uses curl, which honours the environment's HTTPS proxy.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "src/data/geo/perseverance-traverse.json");

const SERVICE = "https://trek.nasa.gov/mars/trekarcgis/rest/services/Perseverance_Traverse_Path/MapServer/0";
const TOLERANCE_M = 0.5;
// Same constant as src/lib/map/mars-geodesy.ts (IAU 2000 Mars sphere).
const R = 3396190;
const M_PER_DEG = (2 * Math.PI * R) / 360;

const get = (url) => execFileSync("curl", ["-sSf", "--max-time", "120", url], { maxBuffer: 1 << 28 }).toString();

const meta = JSON.parse(get(`${SERVICE.replace(/\/0$/, "")}?f=json`));
const query = new URLSearchParams({
  where: "1=1",
  outFields: "FID,sol,fromRMC,toRMC,length",
  returnGeometry: "true",
  orderByFields: "sol ASC, FID ASC",
  f: "geojson",
});
const fc = JSON.parse(get(`${SERVICE}/query?${query}`));
if (fc.exceededTransferLimit || fc.properties?.exceededTransferLimit) throw new Error("Transfer limit exceeded; paginate.");

/** Perpendicular distance (m) of p from segment a–b, in a plane tangent at latitude lat0. */
function deviation(p, a, b, k) {
  const ax = a[0] * k, ay = a[1] * M_PER_DEG, bx = b[0] * k, by = b[1] * M_PER_DEG, px = p[0] * k, py = p[1] * M_PER_DEG;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function simplify(points, k) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let max = -1, idx = -1;
    for (let n = i + 1; n < j; n++) {
      const d = deviation(points[n], points[i], points[j], k);
      if (d > max) { max = d; idx = n; }
    }
    if (max > TOLERANCE_M) { keep[idx] = 1; stack.push([i, idx], [idx, j]); }
  }
  return points.filter((_, n) => keep[n]);
}

/** Maximum distance (m) of the original vertices from the simplified line. */
function maxDeviation(original, simplified, k) {
  let worst = 0;
  for (const p of original) {
    let best = Infinity;
    for (let n = 0; n + 1 < simplified.length; n++) best = Math.min(best, deviation(p, simplified[n], simplified[n + 1], k));
    if (simplified.length === 1) best = deviation(p, simplified[0], simplified[0], k);
    worst = Math.max(worst, best);
  }
  return worst;
}

const lengthM = (line, k) =>
  line.slice(1).reduce((s, p, n) => s + Math.hypot((p[0] - line[n][0]) * k, (p[1] - line[n][1]) * M_PER_DEG), 0);

let sourceVertices = 0, keptVertices = 0, worst = 0, attrLength = 0, sourceGeomLength = 0, keptGeomLength = 0;
// orderByFields is not honoured for f=geojson, so sort here: by sol, then FID.
const features = [...fc.features].sort((a, b) => a.properties.sol - b.properties.sol || a.properties.FID - b.properties.FID);
const segments = features.map((f) => {
  const g = f.geometry;
  const lines = (g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : null);
  if (!lines) throw new Error(`Unexpected geometry ${g.type} in FID ${f.properties.FID}`);
  const out = lines.map((line) => {
    const pts = line.map((c) => [c[0], c[1]]);
    const k = M_PER_DEG * Math.cos((pts[0][1] * Math.PI) / 180);
    sourceVertices += pts.length;
    sourceGeomLength += lengthM(pts, k);
    const s = simplify(pts, k);
    keptVertices += s.length;
    keptGeomLength += lengthM(s, k);
    worst = Math.max(worst, maxDeviation(pts, s, k));
    return s;
  });
  attrLength += f.properties.length;
  const { FID, sol, fromRMC, toRMC, length } = f.properties;
  return { fid: FID, sol, fromRMC, toRMC, length, lines: out };
});

const sols = segments.map((s) => s.sol);
const data = {
  id: "perseverance-traverse",
  sourceId: "trek-perseverance-traverse",
  service: SERVICE,
  retrievedOn: new Date().toISOString().slice(0, 10),
  crs: {
    serviceSpatialReference: `wkid ${meta.spatialReference?.wkid ?? "unknown"}`,
    geojsonLabel: fc.crs?.properties?.name ?? null,
    interpretation:
      "Mars 2000 longitude/latitude in degrees, east-positive longitude, planetocentric latitude. The service states the Mars 2000 geographic CRS but not the latitude type; planetocentric is inferred by cross-validation (docs/GEO_DATA.md).",
    conventionBasis: "inferred-cross-validation",
  },
  attributes: {
    kept: ["FID (as fid)", "sol", "fromRMC", "toRMC", "length"],
    dropped: ["SCLK_START", "SCLK_END", "z vertex values (undocumented; not surface elevations)", "m vertex values (null)"],
    lengthUnit:
      "Not stated by the service. Metres is inferred: the sum of `length` matches the geometric length computed on the Mars sphere (see lengthCheck).",
  },
  lengthCheck: {
    sumOfLengthAttribute: Math.round(attrLength * 10) / 10,
    geometricLengthOfSourceM: Math.round(sourceGeomLength * 10) / 10,
    geometricLengthOfSimplifiedM: Math.round(keptGeomLength * 10) / 10,
    note: "Simplification removes small wiggles, so the simplified line is slightly shorter. Use the `length` attribute for driven distances, never the simplified geometry.",
  },
  simplification: {
    method: "Douglas–Peucker per line, local tangent plane on the Mars 2000 sphere (R = 3,396,190 m)",
    toleranceM: TOLERANCE_M,
    maxDeviationM: Math.round(worst * 1000) / 1000,
    sourceVertexCount: sourceVertices,
    vertexCount: keptVertices,
  },
  segmentCount: segments.length,
  solRange: [Math.min(...sols), Math.max(...sols)],
  segments,
};

writeFileSync(out, JSON.stringify(data) + "\n");
console.log(
  `Wrote ${out}\n  segments ${segments.length}, sols ${data.solRange.join("–")}, vertices ${sourceVertices} → ${keptVertices}, ` +
    `max deviation ${data.simplification.maxDeviationM} m, length attr ${data.lengthCheck.sumOfLengthAttribute} m vs geometry ${data.lengthCheck.geometricLengthOfSourceM} m`,
);
