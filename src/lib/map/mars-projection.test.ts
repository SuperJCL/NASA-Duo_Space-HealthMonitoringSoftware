import { describe, expect, it } from "vitest";
import { getPointResolution } from "ol/proj";

import { createTrekTileGrid } from "./create-trek-source";
import { MARS_METERS_PER_DEGREE } from "./mars-geodesy";
import { MARS_PROJECTION_CODE, getMarsProjection } from "./mars-projection";
import { TREK_LAYERS } from "./trek-layers";

describe("getMarsProjection", () => {
  it("is registered once and reused", () => {
    expect(getMarsProjection()).toBe(getMarsProjection());
    expect(getMarsProjection().getCode()).toBe(MARS_PROJECTION_CODE);
  });

  it("uses Mars metres per degree", () => {
    expect(getMarsProjection().getMetersPerUnit()).toBeCloseTo(MARS_METERS_PER_DEGREE, 6);
  });

  it("makes OpenLayers report Mars (not Earth) east-west ground distances", () => {
    const projection = getMarsProjection();
    const degreesPerPixel = 0.001;
    const latitude = 18.4;
    const metresPerPixel = getPointResolution(projection, degreesPerPixel, [77.4, latitude], "m");
    const expected = degreesPerPixel * MARS_METERS_PER_DEGREE * Math.cos((latitude * Math.PI) / 180);
    expect(metresPerPixel).toBeCloseTo(expected, 6);

    // EPSG:4326 (Earth) would give ~111 m/px here; Mars is ~56 m/px.
    expect(metresPerPixel).toBeGreaterThan(50);
    expect(metresPerPixel).toBeLessThan(60);
  });
});

describe("createTrekTileGrid", () => {
  it("limits Jezero CTX tile requests to the mosaic's bounding box", () => {
    const grid = createTrekTileGrid(TREK_LAYERS.jezeroCtx);
    expect(grid.getMaxZoom()).toBe(13);
    // Tile 10/406/1464 was fetched successfully from Trek on 2026-11-04.
    const range = grid.getFullTileRange(10);
    expect(range).toBeDefined();
    expect(range!.containsXY(1464, 406)).toBe(true);
    // A tile far outside Jezero (Trek returned 404) must not be in range.
    expect(range!.containsXY(100, 100)).toBe(false);
  });

  it("matches the default028mm grid at level 0 for global layers", () => {
    const grid = createTrekTileGrid(TREK_LAYERS.viking);
    const range = grid.getFullTileRange(0)!;
    expect([range.minX, range.maxX, range.minY, range.maxY]).toEqual([0, 1, 0, 0]);
    expect(grid.getOrigin(0)).toEqual([-180, 90]);
  });
});
