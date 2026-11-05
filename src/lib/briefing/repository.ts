import { z } from "zod";
import lefroyBayJson from "@/data/briefings/lefroy-bay.json";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import type { Source } from "@/lib/evidence/schema";
import { loadJezeroGeo } from "@/lib/geo/repository";
import type { GeoCatalog } from "@/lib/geo/schema";
import { checkBriefingIntegrity } from "./integrity";
import { Briefing } from "./schema";

/**
 * Loads location briefings (BR-1), validated with Zod and integrity rules.
 * Invalid data throws, which fails `next build`. Briefings are not engine
 * inputs: lib/evidence and lib/decision never import this module.
 */
export function parseBriefing(raw: unknown, geo: GeoCatalog, sources: readonly Source[]): Briefing {
  const parsed = Briefing.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid briefing:\n${z.prettifyError(parsed.error)}`);
  const problems = checkBriefingIntegrity(parsed.data, geo, sources);
  if (problems.length) throw new Error(`Briefing integrity check failed (${parsed.data.id}):\n- ${problems.join("\n- ")}`);
  return parsed.data;
}

let cached: Briefing[] | undefined;

export function loadBriefings(): Briefing[] {
  if (!cached) {
    const { sources } = loadJezeroMarginScenario();
    const { catalog } = loadJezeroGeo();
    cached = [parseBriefing(lefroyBayJson, catalog, sources)];
  }
  return cached;
}
