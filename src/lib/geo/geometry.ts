import { MARS_METERS_PER_DEGREE } from "@/lib/map/mars-geodesy";
import type { BBox, LonLat } from "./schema";

/**
 * Small-area geometry on the Mars 2000 sphere (pure, no OpenLayers).
 *
 * Distances use a local tangent plane at the query point's latitude:
 * x = Δλ · m/deg · cos φ, y = Δφ · m/deg. Over a few kilometres this is
 * accurate to well under a metre, which is ample for consistency checks.
 * Not for long-distance or navigation use.
 */

const toPlane = (p: LonLat, lat0: number): [number, number] => {
  const k = MARS_METERS_PER_DEGREE * Math.cos((lat0 * Math.PI) / 180);
  return [p[0] * k, p[1] * MARS_METERS_PER_DEGREE];
};

/** Distance in metres from p to the segment a–b. */
export function distanceToSegmentM(p: LonLat, a: LonLat, b: LonLat): number {
  const lat0 = p[1];
  const [px, py] = toPlane(p, lat0);
  const [ax, ay] = toPlane(a, lat0);
  const [bx, by] = toPlane(b, lat0);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Shortest distance in metres from p to any of the polylines. */
export function distanceToPolylinesM(p: LonLat, lines: readonly (readonly LonLat[])[]): number {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, distanceToSegmentM(p, line[i], line[i + 1]));
  }
  return best;
}

/** Length in metres of a polyline. */
export function polylineLengthM(line: readonly LonLat[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const lat0 = (line[i][1] + line[i + 1][1]) / 2;
    const [ax, ay] = toPlane(line[i], lat0);
    const [bx, by] = toPlane(line[i + 1], lat0);
    sum += Math.hypot(bx - ax, by - ay);
  }
  return sum;
}

export function bboxContains([w, s, e, n]: BBox, [lon, lat]: LonLat): boolean {
  return lon >= w && lon <= e && lat >= s && lat <= n;
}

/** Closed polygon ring for a bbox, counter-clockwise. */
export function bboxRing([w, s, e, n]: BBox): LonLat[] {
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}
