import { describe, expect, it } from "vitest";
import {
  BASEMAP_KEYS,
  DEFAULT_BASEMAP,
  DEFAULT_OVERLAYS,
  OVERLAY_KEYS,
  TREK_EQ_TILE_GRID,
  TREK_LAYERS,
  trekAttribution,
  trekCapabilitiesUrl,
  trekResolutions,
  trekTileUrlTemplate,
} from "./trek-layers";

const layers = Object.values(TREK_LAYERS);

describe("Trek tile grid (default028mm)", () => {
  it("level 0 is 2x1 tiles of 256 px covering 360x180 degrees", () => {
    const [z0] = trekResolutions(0);
    expect(z0).toBe(0.703125);
    expect((360 / (z0 * TREK_EQ_TILE_GRID.tileSize))).toBe(2);
    expect((180 / (z0 * TREK_EQ_TILE_GRID.tileSize))).toBe(1);
  });

  it("halves resolution at each level", () => {
    const res = trekResolutions(13);
    expect(res).toHaveLength(14);
    for (let z = 1; z < res.length; z++) expect(res[z]).toBe(res[z - 1] / 2);
  });
});

describe("TREK_LAYERS catalog", () => {
  it.each(layers.map((l) => [l.id, l] as const))("%s has a well-formed tile URL template", (_id, layer) => {
    expect(trekTileUrlTemplate(layer)).toBe(
      `https://trek.nasa.gov/tiles/Mars/EQ/${layer.id}/1.0.0/default/default028mm/{z}/{y}/{x}.${layer.format}`,
    );
    expect(trekCapabilitiesUrl(layer)).toMatch(/\/1\.0\.0\/WMTSCapabilities\.xml$/);
  });

  it.each(layers.map((l) => [l.id, l] as const))("%s has a valid extent inside the globe", (_id, layer) => {
    const [w, s, e, n] = layer.extent;
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
    expect(w).toBeGreaterThanOrEqual(-180);
    expect(e).toBeLessThanOrEqual(180);
    expect(s).toBeGreaterThanOrEqual(-90);
    expect(n).toBeLessThanOrEqual(90);
  });

  it("separates basemaps (global) from overlays (regional)", () => {
    for (const key of BASEMAP_KEYS) expect(TREK_LAYERS[key].role).toBe("basemap");
    for (const key of OVERLAY_KEYS) expect(TREK_LAYERS[key].role).toBe("overlay");
    expect(BASEMAP_KEYS).toContain(DEFAULT_BASEMAP);
    for (const key of DEFAULT_OVERLAYS) expect(OVERLAY_KEYS).toContain(key);
  });

  it("Jezero HiRISE extent lies within the Jezero CTX extent", () => {
    const [cw, cs, ce, cn] = TREK_LAYERS.jezeroCtx.extent;
    const [hw, hs, he, hn] = TREK_LAYERS.jezeroHirise.extent;
    expect(hw).toBeGreaterThanOrEqual(cw);
    expect(hs).toBeGreaterThanOrEqual(cs);
    expect(he).toBeLessThanOrEqual(ce);
    expect(hn).toBeLessThanOrEqual(cn);
  });

  it("attribution credits NASA Mars Trek and the instrument", () => {
    const html = trekAttribution(TREK_LAYERS.jezeroCtx);
    expect(html).toContain("NASA Mars Trek");
    expect(html).toContain("CTX");
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
