import { z } from "zod";
import sourcesJson from "@/data/sources.json";
import jezeroMarginJson from "@/data/scenarios/jezero-margin-unit.json";
import jezeroMarginReviewsJson from "@/data/scenarios/jezero-margin-unit.reviews.json";
import { checkScenarioIntegrity } from "./integrity";
import { applyRegistry, checkRegistryIntegrity, ReviewRegistry } from "./review-registry";
import { Scenario, ScenarioInput, SourceList, type Source } from "./schema";

/**
 * Data access for curated evidence. JSON is validated with Zod and the
 * integrity rules on load; invalid data throws, which fails `next build`.
 *
 * Review state comes only from the review registry (RI-1). It is attached to
 * the scenario here, after checking that the registry covers every
 * ranking-relevant relationship exactly once.
 */
export type ScenarioBundle = { scenario: Scenario; sources: Source[]; registry: ReviewRegistry };

export function parseScenarioBundle(rawScenario: unknown, rawSources: unknown, rawRegistry: unknown): ScenarioBundle {
  const sources = SourceList.safeParse(rawSources);
  if (!sources.success) throw new Error(`Invalid sources.json:\n${z.prettifyError(sources.error)}`);

  const input = ScenarioInput.safeParse(rawScenario);
  if (!input.success) throw new Error(`Invalid scenario:\n${z.prettifyError(input.error)}`);

  const registry = ReviewRegistry.safeParse(rawRegistry);
  if (!registry.success) throw new Error(`Invalid review registry:\n${z.prettifyError(registry.error)}`);

  const registryProblems = checkRegistryIntegrity(input.data, registry.data, sources.data);
  if (registryProblems.length) {
    throw new Error(`Review registry integrity check failed:\n- ${registryProblems.join("\n- ")}`);
  }

  const scenario = Scenario.safeParse(applyRegistry(input.data, registry.data));
  if (!scenario.success) throw new Error(`Invalid scenario after applying reviews:\n${z.prettifyError(scenario.error)}`);

  const problems = checkScenarioIntegrity(scenario.data, sources.data);
  if (problems.length) throw new Error(`Scenario integrity check failed:\n- ${problems.join("\n- ")}`);

  return { scenario: scenario.data, sources: sources.data, registry: registry.data };
}

export function loadJezeroMarginScenario(): ScenarioBundle {
  return parseScenarioBundle(jezeroMarginJson, sourcesJson, jezeroMarginReviewsJson);
}
