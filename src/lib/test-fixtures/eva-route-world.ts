// Test fixture: the real EVA route inputs, loaded the way the app loads them (committed CTX crop,
// verified geo catalog and traverse, the Mission Glass simulated targets, the simulated scouting
// scenario). Node only (reads the committed heights from public/).

import { readFileSync } from "node:fs";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { allFeatures } from "@/lib/geo/features";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { parseScenario, simulatedTargets } from "@/lib/prototype/mission-glass";
import { LEFROY_TERRAIN } from "@/lib/terrain/terrain";
import { buildPlanningGrid } from "@/lib/eva-route/grid";
import { loadEvaScouting, traverseLinesOf } from "@/lib/eva-route/repository";
import { Mission } from "@/lib/eva-route/mission";
import type { RouteTarget } from "@/lib/eva-route/world";

let cache: ReturnType<typeof build> | null = null;

function build() {
  const buf = readFileSync(`public${LEFROY_TERRAIN.heights.file}`);
  const heights = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const grid = buildPlanningGrid(LEFROY_TERRAIN, heights);
  const geo = loadJezeroGeo();
  const { scenario } = loadJezeroMarginScenario();
  const s = parseScenario(scenarioJson, scenario, geo.catalog);
  const targets: RouteTarget[] = simulatedTargets(s, geo.catalog).map((t) => ({ id: t.id, name: t.name, position: t.position }));
  const scouting = loadEvaScouting(geo);
  const traverse = traverseLinesOf(allFeatures(geo));
  return { grid, heights, geo, targets, scouting, traverse };
}

export function evaRouteWorld() {
  cache ??= build();
  return cache;
}

export function missionFor(variantId: string, opts: { primaryId?: string; alternativeId?: string } = {}) {
  const w = evaRouteWorld();
  return new Mission({
    grid: w.grid,
    scenario: w.scouting,
    variantId,
    targets: w.targets,
    primaryId: opts.primaryId ?? w.scouting.defaultPrimaryId,
    alternativeId: opts.alternativeId ?? w.scouting.defaultAlternativeId,
    traverse: w.traverse,
  });
}
