import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sources from "@/data/sources.json";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { LEFROY_HIRISE as h, LEFROY_TERRAIN as ctx, gridToLonLat, insideCrop, isHirise, lonLatToGrid, postSpacing, sampleHeight, sourceLine } from "./terrain";

const hBuf = readFileSync(`public${h.heights.file}`);
const heights = new Float32Array(hBuf.buffer, hBuf.byteOffset, hBuf.byteLength / 4);
const cBuf = readFileSync(`public${ctx.heights.file}`);
const ctxHeights = new Float32Array(cBuf.buffer, cBuf.byteOffset, cBuf.byteLength / 4);
const sites = loadJezeroGeo().catalog.records.filter((r) => r.kind === "sample-site");

describe("HiRISE terrain: every 5th post of the verified 1 m DTM over the CTX crop's area", () => {
  it("committed files match their recorded checksums and sizes; sources are registered", () => {
    expect(createHash("sha256").update(hBuf).digest("hex")).toBe(h.heights.sha256);
    expect(createHash("sha256").update(readFileSync(`public${h.imagery.file}`)).digest("hex")).toBe(h.imagery.sha256);
    expect(heights.length).toBe(h.crop.cols * h.crop.rows);
    expect(h.crop.stride).toBe(5);
    expect(postSpacing(h)).toBe(5);
    expect(postSpacing(ctx)).toBe(20);
    expect(isHirise(h) && !isHirise(ctx)).toBe(true);
    const ids = sources.map((x) => x.id);
    expect(ids).toContain(h.dtm.sourceId);
    expect(ids).toContain(h.imagery.sourceId);
  });

  it("the elevations are real posts: within the recorded range, no no-data", () => {
    let min = Infinity;
    let max = -Infinity;
    for (const v of heights) {
      expect(Number.isFinite(v)).toBe(true);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeCloseTo(h.heights.minM, 2);
    expect(max).toBeCloseTo(h.heights.maxM, 2);
  });

  it("covers the same area as the CTX crop (within one 1 m post)", () => {
    for (let i = 0; i < 4; i++) expect(Math.abs(h.crop.bboxDeg[i] - ctx.crop.bboxDeg[i])).toBeLessThan(1 / 59274); // 1 m in degrees
  });

  it("grid ↔ lon/lat round trip with the stride; post centres", () => {
    const p = gridToLonLat(h, 123.5, 456.5);
    const g = lonLatToGrid(h, p);
    expect(g.col).toBeCloseTo(123.5, 9);
    expect(g.row).toBeCloseTo(456.5, 9);
    // The NW corner of post (0, 0) is the crop's NW corner.
    const nw = gridToLonLat(h, 0, 0);
    expect(nw[0]).toBeCloseTo(h.crop.bboxDeg[0], 7);
    expect(nw[1]).toBeCloseTo(h.crop.bboxDeg[3], 7);
  });

  it("matches the PDS sample-site elevations within 2 m and the recorded validation", () => {
    for (const s of sites) {
      if (s.kind !== "sample-site") continue;
      expect(insideCrop(h, s.position)).toBe(true);
      const v = sampleHeight(h, heights, s.position)!;
      const rec = h.validation.pdsSampleSites.find((x) => x.id === s.id)!;
      expect(Math.abs(v - s.elevationM)).toBeLessThan(2);
      expect(v).toBeCloseTo(rec.dtmElevationM, 1);
    }
  });

  it("agrees with the CTX crop on average (the same areoid datum)", () => {
    let sum = 0;
    let n = 0;
    for (let r = 5; r < ctx.crop.rows - 5; r += 7)
      for (let c = 5; c < ctx.crop.cols - 5; c += 7) {
        const p = gridToLonLat(ctx, c + 0.5, r + 0.5);
        sum += sampleHeight(h, heights, p)! - ctxHeights[r * ctx.crop.cols + c];
        n++;
      }
    expect(Math.abs(sum / n)).toBeLessThan(1.5);
  });

  it("states its source and the 5 m mesh honestly", () => {
    expect(sourceLine(h)).toMatch(/every 5th post of the 1 m mosaic = 5 m mesh/);
    expect(sourceLine(ctx)).toMatch(/^CTX DTM 20 m posts/);
  });
});
