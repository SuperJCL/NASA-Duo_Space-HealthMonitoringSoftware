import type { Scenario, Source } from "@/lib/evidence/schema";
import { TREK_LAYERS } from "@/lib/map/trek-layers";
import type { GeoCatalog, SampleSite, Traverse } from "./schema";

/**
 * Data-consistency rules for geographic records. Each rule returns a
 * readable problem; an empty list means the data passes. These run on load,
 * so bad data fails `next build`, and in unit tests.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Parses the PDS coordinate line, e.g.
 * "Latitude (N), Longitude (E), Elevation: 18.49186664 °, 77.3272192 °, - 2382.434036 m".
 * The source's own spacing varies, so spaces around "°" and "-" are allowed.
 */
export function parsePdsSampleQuote(quote: string): { lat: number; lon: number; elevationM: number; sol: number; coringDate: string } | null {
  const coords = /Elevation:\s*([\d.]+)\s*°,\s*([\d.]+)\s*°,\s*(-?)\s*([\d.]+)\s*m/.exec(quote);
  const sol = /Sol (\d+)/.exec(quote);
  const date = /Date of Coring: (\d{1,2})-([A-Za-z]+)-(\d{4})/.exec(quote);
  if (!coords || !sol || !date) return null;
  const month = MONTHS.indexOf(date[2]) + 1;
  if (month === 0) return null;
  return {
    lat: Number(coords[1]),
    lon: Number(coords[2]),
    elevationM: Number(`${coords[3]}${coords[4]}`),
    sol: Number(sol[1]),
    coringDate: `${date[3]}-${String(month).padStart(2, "0")}-${date[1].padStart(2, "0")}`,
  };
}

const rmcOrder = (rmc: string): [number, number] => {
  const [site, drive] = rmc.split("_").map(Number);
  return [site ?? NaN, drive ?? NaN];
};

export function checkGeoIntegrity(
  catalog: GeoCatalog,
  traverse: Traverse,
  scenario: Scenario,
  sources: readonly Source[],
): string[] {
  const problems: string[] = [];
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const conventionIds = new Set(catalog.conventions.map((c) => c.id));
  const observationById = new Map(scenario.observations.map((o) => [o.id, o]));

  if (catalog.scenarioId !== scenario.id) problems.push(`geo catalog is for "${catalog.scenarioId}", not "${scenario.id}"`);

  const ids = [...catalog.conventions.map((c) => c.id), ...catalog.records.map((r) => r.id), traverse.id];
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) problems.push(`duplicate geo ids: ${[...new Set(dup)].join(", ")}`);

  for (const c of catalog.conventions) {
    for (const cit of c.citations) if (!sourceById.has(cit.sourceId)) problems.push(`convention ${c.id}: unknown source ${cit.sourceId}`);
  }

  for (const r of catalog.records) {
    if (!conventionIds.has(r.conventionId)) problems.push(`${r.id}: unknown convention ${r.conventionId}`);
    const dates: string[] = [];
    for (const cit of r.citations) {
      const s = sourceById.get(cit.sourceId);
      if (!s) problems.push(`${r.id}: unknown source ${cit.sourceId}`);
      else dates.push(s.publishedOn);
    }
    const latest = dates.reduce((a, b) => (a > b ? a : b), "");
    if (latest && r.availableFrom !== latest) {
      problems.push(`${r.id}: availableFrom ${r.availableFrom} must equal the latest cited source date ${latest}`);
    }

    if (r.kind === "sample-site") problems.push(...checkSampleSite(r, observationById, sourceById));

    if (r.kind === "product-extent") {
      const quoted = r.citations.map((c) => /"bbox":"([^"]+)"/.exec(c.quote)?.[1]).find(Boolean);
      if (!quoted) problems.push(`${r.id}: no citation quotes the catalog bbox`);
      else if (quoted.split(",").map(Number).join() !== r.bbox.join()) problems.push(`${r.id}: bbox differs from the quoted catalog bbox ${quoted}`);
      if (!r.productLabel.includes(`_${r.nominalResolution}_`)) problems.push(`${r.id}: nominal resolution ${r.nominalResolution} is not in the product label`);
      if (r.trekLayerKey) {
        const layer = (TREK_LAYERS as Record<string, { id: string; extent: readonly number[] }>)[r.trekLayerKey];
        if (!layer) problems.push(`${r.id}: unknown Trek layer ${r.trekLayerKey}`);
        else {
          if (layer.id !== r.productLabel) problems.push(`${r.id}: Trek layer ${r.trekLayerKey} is ${layer.id}, not ${r.productLabel}`);
          if (layer.extent.join() !== r.bbox.join()) problems.push(`${r.id}: bbox differs from the map layer extent`);
        }
      }
    }
  }

  // Traverse
  if (!sourceById.has(traverse.sourceId)) problems.push(`traverse: unknown source ${traverse.sourceId}`);
  const segs = traverse.segments;
  if (traverse.segmentCount !== segs.length) problems.push(`traverse: segmentCount ${traverse.segmentCount} ≠ ${segs.length} segments`);
  const sols = segs.map((s) => s.sol);
  if (traverse.solRange[0] !== Math.min(...sols) || traverse.solRange[1] !== Math.max(...sols)) {
    problems.push(`traverse: solRange ${traverse.solRange.join("–")} does not match the segments`);
  }
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1];
    const b = segs[i];
    if (b.sol < a.sol || (b.sol === a.sol && b.fid <= a.fid)) problems.push(`traverse: segments not ordered by sol, fid at index ${i}`);
  }
  const vertices = segs.reduce((n, s) => n + s.lines.reduce((m, l) => m + l.length, 0), 0);
  if (vertices !== traverse.simplification.vertexCount) problems.push(`traverse: vertexCount ${traverse.simplification.vertexCount} ≠ ${vertices}`);
  if (traverse.simplification.maxDeviationM > traverse.simplification.toleranceM + 1e-9) {
    problems.push(`traverse: simplification deviates ${traverse.simplification.maxDeviationM} m, above the ${traverse.simplification.toleranceM} m tolerance`);
  }
  // The last-position marker needs one unambiguous final segment.
  const lastSol = Math.max(...sols);
  const finals = segs.filter((s) => s.sol === lastSol);
  if (finals.length !== 1) problems.push(`traverse: ${finals.length} segments on the final sol ${lastSol}; the last position is ambiguous`);
  else {
    const [site, drive] = rmcOrder(finals[0].toRMC);
    const later = segs.filter((s) => {
      const [ss, dd] = rmcOrder(s.toRMC);
      return ss > site || (ss === site && dd > drive);
    });
    if (later.length) problems.push(`traverse: ${later.length} segment(s) end at a later rover motion counter than the final sol`);
  }
  return problems;
}

function checkSampleSite(r: SampleSite, observationById: Map<string, Scenario["observations"][number]>, sourceById: Map<string, Source>): string[] {
  const problems: string[] = [];
  const parsed = r.citations.map((c) => parsePdsSampleQuote(c.quote)).find(Boolean);
  if (!parsed) return [`${r.id}: no citation quotes the PDS designation, coring date, sol and coordinates`];
  if (!r.citations.some((c) => c.quote.includes(`Sample Designation: ${r.designation}`))) problems.push(`${r.id}: designation is not quoted`);
  if (parsed.lat !== r.position[1] || parsed.lon !== r.position[0]) problems.push(`${r.id}: position differs from the quoted coordinates`);
  if (parsed.elevationM !== r.elevationM) problems.push(`${r.id}: elevation differs from the quoted value`);
  if (parsed.sol !== r.sealingSol) problems.push(`${r.id}: sealingSol differs from the quoted sol`);
  if (parsed.coringDate !== r.coringDate) problems.push(`${r.id}: coringDate differs from the quoted date`);
  if (!r.citations.some((c) => c.quote.includes(`Campaign: ${r.campaign} Region of Interest: ${r.regionOfInterest}`))) {
    problems.push(`${r.id}: campaign and region of interest are not quoted`);
  }
  if (r.coringDate > r.availableFrom) problems.push(`${r.id}: cored after its source was published`);
  // A related observation must name the sample in a quote or in a cited source's title.
  for (const id of r.relatedObservationIds) {
    const o = observationById.get(id);
    if (!o) {
      problems.push(`${r.id}: unknown related observation ${id}`);
      continue;
    }
    const names = o.citations.some((c) => c.quote.includes(r.name) || sourceById.get(c.sourceId)?.title.includes(r.name));
    if (!names) problems.push(`${r.id}: observation ${id} does not name "${r.name}" in its citations`);
  }
  return problems;
}
