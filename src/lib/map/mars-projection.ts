import Projection from "ol/proj/Projection";
import { addProjection, get as getProjection } from "ol/proj";
import { MARS_METERS_PER_DEGREE } from "./mars-geodesy";

/**
 * OpenLayers projection for Mars 2000 geographic coordinates (IAU2000:49900),
 * i.e. planetocentric lat / east-positive lon on a 3,396,190 m sphere.
 *
 * Why not just use "EPSG:4326"? The tile maths would be identical, but
 * OpenLayers would measure distances on an *Earth* sphere: the scale line would
 * be ~1.88x too long. Supplying `metersPerUnit` and `getPointResolution` makes
 * the scale line report Mars ground distances.
 */
export const MARS_PROJECTION_CODE = "IAU2000:49900";

export const MARS_GEOGRAPHIC_EXTENT = [-180, -90, 180, 90] as const;

export function getMarsProjection(): Projection {
  const existing = getProjection(MARS_PROJECTION_CODE);
  if (existing) return existing;

  const projection = new Projection({
    code: MARS_PROJECTION_CODE,
    units: "degrees",
    extent: [...MARS_GEOGRAPHIC_EXTENT],
    worldExtent: [...MARS_GEOGRAPHIC_EXTENT],
    global: true,
    metersPerUnit: MARS_METERS_PER_DEGREE,
    axisOrientation: "enu",
    // Return the resolution in projection units (degrees) scaled to the
    // east–west direction at this latitude. OpenLayers then multiplies by
    // `metersPerUnit` to get metres. Result: the scale line is exact for
    // east–west distances at the view centre.
    getPointResolution: (resolution, point) =>
      resolution * Math.cos((point[1] * Math.PI) / 180),
  });
  addProjection(projection);
  return projection;
}
