import { z } from "zod";
import geoJson from "@/data/geo/jezero-geo.json";
import traverseJson from "@/data/geo/perseverance-traverse.json";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import type { Scenario, Source } from "@/lib/evidence/schema";
import { checkGeoIntegrity } from "./integrity";
import { GeoCatalog, Traverse } from "./schema";

/**
 * Data access for geographic records (MF-0). Like the evidence repository,
 * JSON is validated with Zod and integrity rules on load, and invalid data
 * throws (which fails `next build`).
 *
 * This module may read the scientific scenario (to cross-check observation
 * ids and sources). The reverse is not allowed: nothing in lib/evidence or
 * lib/decision imports geographic data, so geography cannot affect scores.
 */
export type GeoBundle = {
  catalog: GeoCatalog;
  traverse: Traverse;
  /** Publication date of the traverse source (the rule used for every record's availableFrom). */
  traverseAvailableFrom: string;
};

export function parseGeoBundle(rawCatalog: unknown, rawTraverse: unknown, scenario: Scenario, sources: readonly Source[]): GeoBundle {
  const catalog = GeoCatalog.safeParse(rawCatalog);
  if (!catalog.success) throw new Error(`Invalid geo catalog:\n${z.prettifyError(catalog.error)}`);
  const traverse = Traverse.safeParse(rawTraverse);
  if (!traverse.success) throw new Error(`Invalid traverse:\n${z.prettifyError(traverse.error)}`);

  const problems = checkGeoIntegrity(catalog.data, traverse.data, scenario, sources);
  if (problems.length) throw new Error(`Geo integrity check failed:\n- ${problems.join("\n- ")}`);

  const traverseSource = sources.find((s) => s.id === traverse.data.sourceId);
  if (!traverseSource) throw new Error(`Traverse source ${traverse.data.sourceId} not found`);
  return { catalog: catalog.data, traverse: traverse.data, traverseAvailableFrom: traverseSource.publishedOn };
}

let cached: GeoBundle | undefined;

export function loadJezeroGeo(): GeoBundle {
  if (!cached) {
    const { scenario, sources } = loadJezeroMarginScenario();
    cached = parseGeoBundle(geoJson, traverseJson, scenario, sources);
  }
  return cached;
}
