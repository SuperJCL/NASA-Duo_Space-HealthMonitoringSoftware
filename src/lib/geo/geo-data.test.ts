import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import geoJson from "@/data/geo/jezero-geo.json";
import traverseJson from "@/data/geo/perseverance-traverse.json";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { TREK_LAYERS } from "@/lib/map/trek-layers";
import { allFeatures, finalSegment, roverLastPositionFeature, toGeoJson, traverseFeatures } from "./features";
import { bboxContains, distanceToPolylinesM, polylineLengthM } from "./geometry";
import { checkGeoIntegrity, parsePdsSampleQuote } from "./integrity";
import { loadJezeroGeo, parseGeoBundle } from "./repository";
import type { GeoCatalog, ProductExtent, SampleSite, Traverse } from "./schema";

/** Guards on the committed geographic data (MF-0). */
const geo = loadJezeroGeo();
const { scenario, sources } = loadJezeroMarginScenario();
const samples = geo.catalog.records.filter((r): r is SampleSite => r.kind === "sample-site");
const extents = geo.catalog.records.filter((r): r is ProductExtent => r.kind === "product-extent");
const extent = (id: string) => {
  const e = extents.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e;
};
const allLines = geo.traverse.segments.flatMap((s) => s.lines);
const clone = <T>(x: T): T => structuredClone(x);

describe("geo catalog content", () => {
  it("has the three PDS volume-4 margin samples, the crater centre and four product extents", () => {
    expect(samples.map((s) => s.designation).sort()).toEqual([
      "M2020-1088-27 Comet Geyser",
      "M2020-923-25 Pelican Point",
      "M2020-949-26 Lefroy Bay",
    ]);
    expect(geo.catalog.records.filter((r) => r.kind === "crater-centre")).toHaveLength(1);
    expect(extents.map((e) => e.id).sort()).toEqual(["extent-ctx-dtm", "extent-ctx-ortho", "extent-hirise-dtm", "extent-hirise-ortho"]);
  });

  it("parses every sample's position, elevation, sol and date from its verbatim PDS quote", () => {
    for (const s of samples) {
      const parsed = s.citations.map((c) => parsePdsSampleQuote(c.quote)).find(Boolean);
      expect(parsed).toEqual({ lat: s.position[1], lon: s.position[0], elevationM: s.elevationM, sol: s.sealingSol, coringDate: s.coringDate });
    }
  });

  it("labels the PDS convention as inferred by cross-validation, not stated", () => {
    const pds = geo.catalog.conventions.find((c) => c.id === "pds-sample-north-east");
    expect(pds?.basis).toBe("inferred-cross-validation");
    expect(pds?.note).toMatch(/INFERRED/);
    expect(pds?.note).toMatch(/not confirmed by complete authoritative CRS metadata/);
    for (const s of samples) expect(s.conventionId).toBe("pds-sample-north-east");
  });

  it("keeps the Trek extents identical to the existing map-layer extents", () => {
    expect(extent("extent-ctx-ortho").bbox).toEqual([...TREK_LAYERS.jezeroCtx.extent]);
    expect(extent("extent-hirise-ortho").bbox).toEqual([...TREK_LAYERS.jezeroHirise.extent]);
  });

  it("records the DTMs as download-only and the orthoimages as WMTS tiles (verified 2026-11-05)", () => {
    expect(extents.filter((e) => e.product === "elevation-model").every((e) => e.servedAs === "download-only")).toBe(true);
    expect(extents.filter((e) => e.product === "orthoimage").every((e) => e.servedAs === "wmts-tiles")).toBe(true);
  });

  it("places every sample inside the HiRISE DTM extent and the Jezero crater", () => {
    const centre = geo.catalog.records.find((r) => r.kind === "crater-centre");
    if (centre?.kind !== "crater-centre") throw new Error("no centre");
    for (const s of samples) {
      expect(bboxContains(extent("extent-hirise-dtm").bbox, s.position)).toBe(true);
      // Within the crater radius of the Gazetteer centre.
      expect(distanceToPolylinesM(s.position, [[centre.position, centre.position]])).toBeLessThan((centre.diameterKm * 1000) / 2);
    }
  });
});

describe("coordinate-convention cross-validation (reproducible part)", () => {
  it("puts every PDS sample site within 5 m of the Trek traverse", () => {
    for (const s of samples) expect(distanceToPolylinesM(s.position, allLines)).toBeLessThan(5);
  });

  it("would fail if the latitude were planetographic (≈ 0.2° shift at 18.5° N)", () => {
    // Planetographic latitude on the Mars 2000 ellipsoid (a/b = 3396.19/3376.20).
    const k = (3396.19 / 3376.2) ** 2;
    for (const s of samples) {
      const lat = (Math.atan(k * Math.tan((s.position[1] * Math.PI) / 180)) * 180) / Math.PI;
      expect(distanceToPolylinesM([s.position[0], lat], allLines)).toBeGreaterThan(5000);
    }
  });
});

describe("traverse", () => {
  const t = geo.traverse;

  it("covers sols 14–1176 in 332 segments, as served by Trek", () => {
    expect(t.segmentCount).toBe(332);
    expect(t.solRange).toEqual([14, 1176]);
    expect(t.sourceId).toBe("trek-perseverance-traverse");
    expect(t.crs.conventionBasis).toBe("inferred-cross-validation");
    expect(t.crs.geojsonLabel).toBe("EPSG:4326"); // documented mislabel; coordinates are Mars degrees
  });

  it("stays inside the catalog bbox of the traverse product", () => {
    // "bbox":"77.303808,18.427253,77.463133,18.499663" in the Mars Trek catalog record
    // (source trek-perseverance-traverse; re-checked live by `npm run verify:geo`).
    const bbox: [number, number, number, number] = [77.303808, 18.427253, 77.463133, 18.499663];
    for (const line of allLines) for (const p of line) expect(bboxContains(bbox, p)).toBe(true);
  });

  it("has a length attribute in metres: the source geometry matches it within 0.5%", () => {
    const attr = t.segments.reduce((s, x) => s + x.length, 0);
    expect(Math.abs(attr - t.lengthCheck.sumOfLengthAttribute)).toBeLessThan(0.1);
    expect(Math.abs(t.lengthCheck.geometricLengthOfSourceM - attr) / attr).toBeLessThan(0.005);
  });

  it("documents that the simplified line is slightly shorter (use the attribute for distances)", () => {
    const attr = t.segments.reduce((s, x) => s + x.length, 0);
    const geom = allLines.reduce((s, l) => s + polylineLengthM(l), 0);
    expect(Math.abs(geom - t.lengthCheck.geometricLengthOfSimplifiedM)).toBeLessThan(1);
    expect(geom).toBeLessThan(attr);
    expect((attr - geom) / attr).toBeLessThan(0.02);
    expect(t.lengthCheck.note).toMatch(/Use the `length` attribute/);
  });

  it("was simplified within its 0.5 m tolerance", () => {
    expect(t.simplification.toleranceM).toBe(0.5);
    expect(t.simplification.maxDeviationM).toBeLessThanOrEqual(0.5);
    expect(t.simplification.vertexCount).toBeLessThan(t.simplification.sourceVertexCount);
  });

  it("identifies one final segment and labels its end point as the last position in the dataset, not a live one", () => {
    expect(finalSegment(t).sol).toBe(1176);
    const f = roverLastPositionFeature(geo);
    expect(f.geometry).toEqual({ type: "Point", coordinates: [77.303809, 18.495677] });
    expect(f.label).toContain("Last position in the available dataset");
    expect(f.label).toContain("sol 1176");
    expect(f.label).toContain("not a live or current position");
    expect(f.label).toMatch(/historical/);
  });
});

describe("adapters", () => {
  it("turns every record, every traverse segment and the last position into features", () => {
    const features = allFeatures(geo);
    expect(features).toHaveLength(geo.catalog.records.length + 332 + 1);
    expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
  });

  it("labels historical rover features as historical and carries provenance", () => {
    for (const f of allFeatures(geo).filter((x) => x.layer === "historical-rover")) {
      expect(f.label).toMatch(/historical/i);
      expect(f.provenance.sourceIds.length).toBeGreaterThan(0);
      expect(f.provenance.conventionBasis).toBe("inferred-cross-validation");
    }
    expect(traverseFeatures(geo).every((f) => f.event?.sol !== undefined)).toBe(true);
  });

  it("produces GeoJSON in Mars degrees with closed extent rings", () => {
    const fc = toGeoJson(allFeatures(geo));
    expect(fc.type).toBe("FeatureCollection");
    const ring = fc.features.find((f) => f.id === "extent-ctx-dtm")?.geometry;
    if (ring?.type !== "Polygon") throw new Error("no polygon");
    expect(ring.coordinates[0][0]).toEqual(ring.coordinates[0][4]);
    const pelican = fc.features.find((f) => f.id === "sample-pelican-point");
    expect(pelican?.geometry).toEqual({ type: "Point", coordinates: [77.35065098, 18.48344692] });
    expect(pelican?.properties.sol).toBe(923);
  });
});

describe("integrity rules reject bad data", () => {
  const raw = () => ({ catalog: clone(geoJson) as unknown as GeoCatalog, traverse: clone(traverseJson) as unknown as Traverse });

  it("accepts the committed data", () => {
    const { catalog, traverse } = raw();
    expect(checkGeoIntegrity(catalog, traverse, scenario, sources)).toEqual([]);
    expect(() => parseGeoBundle(geoJson, traverseJson, scenario, sources)).not.toThrow();
  });

  it("rejects a sample coordinate that differs from its quote", () => {
    const { catalog, traverse } = raw();
    const s = catalog.records.find((r) => r.id === "sample-pelican-point") as SampleSite;
    s.position = [77.3507, s.position[1]];
    expect(checkGeoIntegrity(catalog, traverse, scenario, sources).join()).toMatch(/position differs/);
  });

  it("rejects an availableFrom that is not the cited source's date", () => {
    const { catalog, traverse } = raw();
    catalog.records[0].availableFrom = "2001-01-01";
    expect(checkGeoIntegrity(catalog, traverse, scenario, sources).join()).toMatch(/availableFrom/);
  });

  it("rejects a related observation that does not name the sample", () => {
    const { catalog, traverse } = raw();
    (catalog.records.find((r) => r.id === "sample-pelican-point") as SampleSite).relatedObservationIds = ["obs-first-margin-abrasion"];
    expect(checkGeoIntegrity(catalog, traverse, scenario, sources).join()).toMatch(/does not name "Pelican Point"/);
  });

  it("rejects a bbox that differs from the quoted catalog bbox or the map layer", () => {
    const { catalog, traverse } = raw();
    (catalog.records.find((r) => r.id === "extent-ctx-ortho") as ProductExtent).bbox = [77.16, 18.21, 77.7, 18.72];
    const problems = checkGeoIntegrity(catalog, traverse, scenario, sources).join();
    expect(problems).toMatch(/differs from the quoted catalog bbox/);
    expect(problems).toMatch(/differs from the map layer extent/);
  });

  it("rejects an ambiguous final sol and a broken segment order", () => {
    const { catalog, traverse } = raw();
    traverse.segments.push({ ...clone(traverse.segments[traverse.segments.length - 1]), fid: 9999 });
    traverse.segmentCount = traverse.segments.length;
    const problems = checkGeoIntegrity(catalog, traverse, scenario, sources).join();
    expect(problems).toMatch(/last position is ambiguous/);

    const second = raw();
    second.traverse.segments.reverse();
    expect(checkGeoIntegrity(second.catalog, second.traverse, scenario, sources).join()).toMatch(/not ordered/);
  });
});

describe("separation of geography from the scientific model and simulated tasks", () => {
  it("gives candidate tasks no coordinates", () => {
    const geoKeys = /^(position|coordinates|lat|latitude|lon|lng|longitude|bbox|geometry|location)$/i;
    for (const t of scenario.tasks) expect(Object.keys(t).filter((k) => geoKeys.test(k))).toEqual([]);
  });

  it("never references task or gap ids from geographic records", () => {
    const text = JSON.stringify(geoJson);
    for (const t of scenario.tasks) expect(text).not.toContain(t.id);
    for (const g of scenario.gaps) expect(text).not.toContain(g.id);
  });

  it("keeps lib/decision and lib/evidence production code free of geographic and mission imports", () => {
    const root = join(__dirname, "..");
    for (const dir of ["decision", "evidence"]) {
      for (const file of readdirSync(join(root, dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
        const src = readFileSync(join(root, dir, file), "utf8");
        expect(src, `${dir}/${file}`).not.toMatch(/@\/(lib\/geo|lib\/mission|data\/geo|data\/missions)/);
      }
    }
  });
});
