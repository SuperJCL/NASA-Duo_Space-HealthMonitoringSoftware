import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import scenarioJson from "@/data/prototype/mission-glass.json";
import sources from "@/data/sources.json";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { parseScenario, simulatedTargets } from "@/lib/prototype/mission-glass";
import {
  CAMERA_PRESETS,
  CONTOUR_INTERVAL_M,
  EXAGGERATIONS,
  localRange,
  profileAlong,
  reliefHeadline,
  reliefStatement,
  reliefSummary,
  DEFAULT_EXAGGERATION,
  LEFROY_TERRAIN as m,
  MARS_RADIUS_M,
  gridToLonLat,
  insideCrop,
  lonLatToGrid,
  lonLatToLocal,
  lonLatToUv,
  sampleHeight,
  sourceLine,
} from "./terrain";

const heightsBuf = readFileSync(`public${m.heights.file}`);
const heights = new Float32Array(heightsBuf.buffer, heightsBuf.byteOffset, heightsBuf.byteLength / 4);
const orthoBuf = readFileSync(`public${m.imagery.file}`);
const geo = loadJezeroGeo();
const sites = geo.catalog.records.filter((r) => r.kind === "sample-site");
const { scenario } = loadJezeroMarginScenario();
const targets = simulatedTargets(parseScenario(scenarioJson, scenario, geo.catalog), geo.catalog);

describe("MAP-3A terrain assets are the verified CTX DTM crop", () => {
  it("committed files match their recorded checksums and sizes", () => {
    expect(createHash("sha256").update(heightsBuf).digest("hex")).toBe(m.heights.sha256);
    expect(heights.length).toBe(m.crop.cols * m.crop.rows);
    expect(createHash("sha256").update(orthoBuf).digest("hex")).toBe(m.imagery.sha256);
    // PNG header: the stated width × height, 8-bit greyscale.
    expect([orthoBuf.readUInt32BE(16), orthoBuf.readUInt32BE(20), orthoBuf[24], orthoBuf[25]]).toEqual([m.imagery.width, m.imagery.height, 8, 0]);
  });

  it("cites the registered Trek sources and states resolution, datum and caveats", () => {
    const ids = new Set(sources.map((s: { id: string }) => s.id));
    expect(ids.has(m.dtm.sourceId) && ids.has(m.imagery.sourceId)).toBe(true);
    expect(m.dtm.postSpacingM).toBe(20);
    expect(m.dtm.verticalDatum).toMatch(/areoid/);
    expect(m.caveats.join(" ")).toMatch(/traversability/);
    expect(sourceLine(m)).toBe(
      "CTX DTM 20 m posts (JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0), crop 3.0 × 3.2 km; imagery CTX orthomosaic 6 m (Mars Trek z13)",
    );
  });

  it("contains real elevations only (no no-data, within the recorded range)", () => {
    let min = Infinity;
    let max = -Infinity;
    for (const v of heights) {
      expect(Number.isFinite(v)).toBe(true);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeCloseTo(m.heights.minM, 2);
    expect(max).toBeCloseTo(m.heights.maxM, 2);
    expect(max - min).toBeGreaterThan(100); // relief exists in the crop (≈ 244 m)
  });

  it("agrees with the PDS sample-site elevations within 5 m (recomputed here)", () => {
    for (const s of sites) {
      if (s.kind !== "sample-site") continue;
      const h = sampleHeight(m, heights, s.position)!;
      expect(Math.abs(h - s.elevationM)).toBeLessThan(5);
      const recorded = m.validation.pdsSampleSites.find((p) => p.id === s.id)!;
      expect(h).toBeCloseTo(recorded.dtmElevationM, 1);
    }
  });

  it("reproduces the catalog georeferencing and records an alignment check within 2 posts", () => {
    expect(m.validation.catalogBboxMaxErrorDeg).toBeLessThan(1e-6);
    const ext = geo.catalog.records.find((r) => r.id === "extent-ctx-dtm");
    expect(ext && "bbox" in ext ? ext.bbox : null).toEqual([77.1604655, 18.2110274, 77.6989752, 18.7211945]);
    expect(Math.max(...m.validation.alignment.bestShiftPosts.map(Math.abs))).toBeLessThanOrEqual(2);
  });
});

describe("MAP-3A coordinate transformations", () => {
  it("every verified sample site and simulated target lies inside the crop", () => {
    for (const s of sites) if (s.kind === "sample-site") expect(insideCrop(m, s.position)).toBe(true);
    for (const t of targets) expect(insideCrop(m, t.position)).toBe(true);
  });

  it("grid ↔ lon/lat round-trips, and the crop corners are post edges", () => {
    const [w, s, e, n] = m.crop.bboxDeg;
    expect(gridToLonLat(m, 0, 0)[0]).toBeCloseTo(w, 7);
    expect(gridToLonLat(m, 0, 0)[1]).toBeCloseTo(n, 7);
    expect(gridToLonLat(m, m.crop.cols, m.crop.rows)[0]).toBeCloseTo(e, 7);
    expect(gridToLonLat(m, m.crop.cols, m.crop.rows)[1]).toBeCloseTo(s, 7);
    const p = sites[0].kind === "sample-site" ? sites[0].position : ([0, 0] as const);
    const g = lonLatToGrid(m, p);
    const back = gridToLonLat(m, g.col, g.row);
    expect(back[0]).toBeCloseTo(p[0], 9);
    expect(back[1]).toBeCloseTo(p[1], 9);
  });

  it("local metres match great-circle distances on the Mars sphere (east–west scaled by cos φ)", () => {
    const hav = ([l1, p1]: readonly [number, number], [l2, p2]: readonly [number, number]) => {
      const r = Math.PI / 180;
      const a = Math.sin(((p2 - p1) * r) / 2) ** 2 + Math.cos(p1 * r) * Math.cos(p2 * r) * Math.sin(((l2 - l1) * r) / 2) ** 2;
      return 2 * MARS_RADIUS_M * Math.asin(Math.sqrt(a));
    };
    const pts = [...sites.flatMap((s) => (s.kind === "sample-site" ? [s.position] : [])), ...targets.map((t) => t.position)];
    for (const a of pts)
      for (const b of pts) {
        const [ea, na] = lonLatToLocal(m, a);
        const [eb, nb] = lonLatToLocal(m, b);
        const d = Math.hypot(ea - eb, na - nb);
        expect(Math.abs(d - hav(a, b))).toBeLessThan(Math.max(0.5, 0.002 * hav(a, b)));
      }
    // The scenario's own straight-line target distances are reproduced.
    const lefroy = sites.find((s) => s.id === "sample-lefroy-bay")!;
    for (const t of targets) {
      const [e1, n1] = lonLatToLocal(m, t.position);
      const [e0, n0] = lonLatToLocal(m, lefroy.kind === "sample-site" ? lefroy.position : [0, 0]);
      expect(Math.round(Math.hypot(e1 - e0, n1 - n0))).toBe(t.distanceFromAnchorM);
    }
  });

  it("maps the imagery with the same bounds as the elevations (UV corners and a site)", () => {
    const [w, s, e, n] = m.crop.bboxDeg;
    expect(lonLatToUv(m, [w, n])).toEqual([0, 0]);
    expect(lonLatToUv(m, [e, s])[0]).toBeCloseTo(1, 12);
    expect(lonLatToUv(m, [e, s])[1]).toBeCloseTo(1, 12);
    const lefroy = sites.find((x) => x.id === "sample-lefroy-bay")!;
    const pos = lefroy.kind === "sample-site" ? lefroy.position : ([0, 0] as const);
    const [u, v] = lonLatToUv(m, pos);
    const g = lonLatToGrid(m, pos);
    // The bbox is stored to 1e-7° (≈ 6 mm), so the two agree to well under a centimetre on 3 km.
    expect(Math.abs(u - g.col / m.crop.cols) * m.crop.sizeM.eastWest).toBeLessThan(0.01);
    expect(Math.abs(v - g.row / m.crop.rows) * m.crop.sizeM.northSouth).toBeLessThan(0.01);
  });

  it("defaults to 1× vertical exaggeration", () => {
    expect(DEFAULT_EXAGGERATION).toBe(1);
  });
});

describe("MAP-3A.1 readable relief from the unchanged DTM", () => {
  const pos = (id: string) => {
    const r = sites.find((x) => x.id === id)!;
    return r.kind === "sample-site" ? r.position : ([0, 0] as const);
  };
  const comet = pos("sample-comet-geyser");
  const pelican = pos("sample-pelican-point");
  const lefroy = pos("sample-lefroy-bay");

  it("offers 1× (default), 3× and 5×, and 10 m contours", () => {
    expect([...EXAGGERATIONS]).toEqual([1, 3, 5]);
    expect(DEFAULT_EXAGGERATION).toBe(1);
    expect(CONTOUR_INTERVAL_M).toBe(10);
  });

  it("has low-angle camera presets", () => {
    expect(CAMERA_PRESETS.lowEast.polarDeg).toBeGreaterThanOrEqual(75);
    expect(CAMERA_PRESETS.lowSouth.polarDeg).toBeGreaterThanOrEqual(75);
    expect(CAMERA_PRESETS.overview.polarDeg).toBeLessThan(45);
  });

  it("samples a straight line every 10 m from the DTM, end to end", () => {
    const p = profileAlong(m, heights, comet, pelican)!;
    const R = MARS_RADIUS_M;
    const r = Math.PI / 180;
    const a = Math.sin(((pelican[1] - comet[1]) * r) / 2) ** 2 + Math.cos(comet[1] * r) * Math.cos(pelican[1] * r) * Math.sin(((pelican[0] - comet[0]) * r) / 2) ** 2;
    expect(Math.abs(p.lengthM - 2 * R * Math.asin(Math.sqrt(a)))).toBeLessThan(2);
    expect(p.samples.length).toBe(Math.ceil(p.lengthM / 10) + 1);
    expect(p.samples[1].distanceM).toBeCloseTo(p.lengthM / (p.samples.length - 1), 6);
    expect(p.startM).toBeCloseTo(sampleHeight(m, heights, comet)!, 6);
    expect(p.endM).toBeCloseTo(sampleHeight(m, heights, pelican)!, 6);
    expect(Math.round(p.netChangeM)).toBe(-40); // Comet Geyser is ~40 m above Pelican Point (DTM)
    expect(p.minM).toBeLessThanOrEqual(Math.min(p.startM, p.endM));
    expect(p.maxM).toBeGreaterThanOrEqual(Math.max(p.startM, p.endM));
    expect(profileAlong(m, heights, comet, [0, 0])).toBeNull(); // outside the crop: no invented values
  });

  it("states the real relief from the posts: modest overall, nearly flat around the targets", () => {
    const r = reliefSummary(m, heights, lefroy);
    expect(r.cropMinM).toBeCloseTo(m.heights.minM, 2);
    expect(r.cropMaxM).toBeCloseTo(m.heights.maxM, 2);
    expect(Math.round(r.cropReliefM)).toBe(244);
    expect(r.westMeanM).toBeGreaterThan(r.eastMeanM); // the ground falls to the east
    expect(r.slopeMedianDeg).toBeGreaterThan(2);
    expect(r.slopeMedianDeg).toBeLessThan(6);
    const local = Object.fromEntries(r.local.map((x) => [x.radiusM, Math.round(x.reliefM)]));
    expect(local).toEqual({ 150: 10, 300: 22, 1000: 74 });
    expect(reliefStatement(r, "Lefroy Bay")).toBe(
      "Relief is real but modest: 244 m across this 3 km crop (falling about 72 m from west to east; median slope 3.5°, 90 % below 6.5°). Around Lefroy Bay and the targets it varies by only about 10 m within 150 m and 22 m within 300 m, so at 1× (true scale) it looks nearly flat.",
    );
    expect(reliefHeadline(r, "Lefroy Bay")).toBe("Relief is real but modest: 244 m across the crop, about 22 m within 300 m of Lefroy Bay; nearly flat at 1× near the targets.");
  });

  it("reports the local elevation range from the posts around a point", () => {
    const l = localRange(m, heights, lefroy, 300);
    expect(Math.round(l.reliefM)).toBe(22);
    expect(l.minM).toBeLessThanOrEqual(sampleHeight(m, heights, lefroy)!);
    expect(l.maxM).toBeGreaterThanOrEqual(sampleHeight(m, heights, lefroy)!);
    // A larger radius can only widen the range; the whole crop gives the crop's own extremes.
    expect(localRange(m, heights, lefroy, 1000).reliefM).toBeGreaterThan(l.reliefM);
    const all = localRange(m, heights, lefroy, 10_000);
    expect(all.minM).toBeCloseTo(m.heights.minM, 2); // metadata stores the range rounded to 1 mm
    expect(all.maxM).toBeCloseTo(m.heights.maxM, 2);
  });
});

