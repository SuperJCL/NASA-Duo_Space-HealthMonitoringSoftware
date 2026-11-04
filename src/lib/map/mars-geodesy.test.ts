import { describe, expect, it } from "vitest";
import {
  MARS_METERS_PER_DEGREE,
  eastWestMetersPerPixel,
  formatLonLat,
  normalizeLongitude,
} from "./mars-geodesy";

describe("MARS_METERS_PER_DEGREE", () => {
  it("is derived from the 3,396,190 m IAU2000 Mars sphere (~59.27 km/deg)", () => {
    expect(MARS_METERS_PER_DEGREE).toBeCloseTo(59_274.7, 0);
  });

  it("is not the Earth value (~111.32 km/deg)", () => {
    expect(MARS_METERS_PER_DEGREE).toBeLessThan(60_000);
  });
});

describe("normalizeLongitude", () => {
  it.each([
    [0, 0],
    [77.45, 77.45],
    [180, -180],
    [-180, -180],
    [190, -170],
    [-190, 170],
    [437.45, 77.45],
    [-360, 0],
  ])("wraps %d to %d", (input, expected) => {
    expect(normalizeLongitude(input)).toBeCloseTo(expected, 9);
  });

  it("never returns negative zero", () => {
    expect(Object.is(normalizeLongitude(-360), -0)).toBe(false);
  });
});

describe("eastWestMetersPerPixel", () => {
  it("equals metres-per-degree times resolution at the equator", () => {
    expect(eastWestMetersPerPixel(1, 0)).toBeCloseTo(MARS_METERS_PER_DEGREE, 6);
  });

  it("shrinks with cos(latitude)", () => {
    expect(eastWestMetersPerPixel(1, 60)).toBeCloseTo(
      MARS_METERS_PER_DEGREE / 2,
      6,
    );
  });
});

describe("formatLonLat", () => {
  it("formats north/east coordinates", () => {
    expect(formatLonLat([77.4508, 18.4447])).toBe("18.4447° N, 77.4508° E");
  });

  it("formats south/west coordinates", () => {
    expect(formatLonLat([-10.5, -4.25], 2)).toBe("4.25° S, 10.50° W");
  });

  it("wraps longitudes from neighbouring world copies", () => {
    expect(formatLonLat([77.4508 + 360, 18.4447])).toBe(
      "18.4447° N, 77.4508° E",
    );
  });
});
