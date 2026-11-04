/**
 * Pure Mars geodesy helpers. No OpenLayers or DOM imports, so this module is
 * unit-testable and reusable by server code.
 *
 * Coordinate convention used throughout the app (matches Mars Trek "EQ"
 * equirectangular layers): planetocentric latitude, east-positive longitude
 * in the range [-180, 180], degrees.
 */

/**
 * Sphere radius (metres) of the IAU2000:49900 "Mars 2000" geographic CRS.
 * Mars Trek equirectangular tiles are referenced to this sphere.
 * See docs/NASA_MAP_RESEARCH.md for sources.
 */
export const MARS_IAU2000_SPHERE_RADIUS_M = 3_396_190;

/** Ground distance (metres) spanned by one degree along a great circle. */
export const MARS_METERS_PER_DEGREE =
  (2 * Math.PI * MARS_IAU2000_SPHERE_RADIUS_M) / 360;

export type LonLat = readonly [lon: number, lat: number];

/** Wrap any longitude into [-180, 180). */
export function normalizeLongitude(lon: number): number {
  const wrapped = (((lon + 180) % 360) + 360) % 360 - 180;
  // Avoid returning -0 for display purposes.
  return wrapped === 0 ? 0 : wrapped;
}

/**
 * East–west ground resolution (metres per pixel) at a given latitude for a
 * map resolution expressed in degrees per pixel.
 */
export function eastWestMetersPerPixel(
  degreesPerPixel: number,
  latitude: number,
): number {
  return (
    degreesPerPixel *
    MARS_METERS_PER_DEGREE *
    Math.cos((latitude * Math.PI) / 180)
  );
}

/**
 * Format a coordinate as e.g. "18.4447° N, 77.4508° E".
 * Longitude is wrapped so panning across the antimeridian stays readable.
 */
export function formatLonLat(coordinate: LonLat, fractionDigits = 4): string {
  const [rawLon, lat] = coordinate;
  const lon = normalizeLongitude(rawLon);
  const latLabel = `${Math.abs(lat).toFixed(fractionDigits)}° ${lat >= 0 ? "N" : "S"}`;
  const lonLabel = `${Math.abs(lon).toFixed(fractionDigits)}° ${lon >= 0 ? "E" : "W"}`;
  return `${latLabel}, ${lonLabel}`;
}
