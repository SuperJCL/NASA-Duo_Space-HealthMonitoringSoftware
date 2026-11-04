import { z } from "zod";
import sourcesJson from "@/data/sources.json";
import jezeroMarginJson from "@/data/scenarios/jezero-margin-unit.json";
import { checkScenarioIntegrity } from "./integrity";
import { Scenario, SourceList, type Source } from "./schema";

/**
 * Data access for curated evidence. JSON is validated with Zod and the
 * integrity rules on load; invalid data throws, which fails `next build`.
 */
export type ScenarioBundle = { scenario: Scenario; sources: Source[] };

export function parseScenarioBundle(rawScenario: unknown, rawSources: unknown): ScenarioBundle {
  const sources = SourceList.safeParse(rawSources);
  if (!sources.success) throw new Error(`Invalid sources.json:\n${z.prettifyError(sources.error)}`);

  const scenario = Scenario.safeParse(rawScenario);
  if (!scenario.success) throw new Error(`Invalid scenario:\n${z.prettifyError(scenario.error)}`);

  const problems = checkScenarioIntegrity(scenario.data, sources.data);
  if (problems.length) throw new Error(`Scenario integrity check failed:\n- ${problems.join("\n- ")}`);

  return { scenario: scenario.data, sources: sources.data };
}

export function loadJezeroMarginScenario(): ScenarioBundle {
  return parseScenarioBundle(jezeroMarginJson, sourcesJson);
}
