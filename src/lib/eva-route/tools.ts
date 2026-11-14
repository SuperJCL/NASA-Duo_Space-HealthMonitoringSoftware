// Tool-call entry point for FUTURE agents (no agent is wired in yet, and no LLM is called anywhere
// in MDI). Every tool is deterministic and works on the mission's snapshot only: the hidden
// simulated truth is unreachable from here (eva-route.test.ts checks it). Inputs are validated
// with Zod; `toolDefinitions()` gives JSON schemas a model API can take as tool definitions.
//
// Rules a future agent integration must keep (see docs/EVA_ROUTE_SCOUTING.md):
//   - an agent may only CHOOSE among the options this module returns; it cannot change a number,
//     a feasibility flag or a route, and it never assigns science scores;
//   - every action carries the `stateVersion` it was decided on; a stale version is refused;
//   - approval still goes through Mission.approve(), which re-checks the safe return route.

import { z } from "zod";
import type { LonLat } from "@/lib/terrain/terrain";
import { lonLatOfCell } from "./grid";
import { planRoute, type Route } from "./planner";
import { departure, OPTION_KINDS, type RouteOption } from "./options";
import { estimateScouting } from "./scouting";
import type { Mission } from "./mission";

const Place = z.string().min(1).describe('"base", "rover", or a target id (e.g. "sim-target-a")');

const TOOLS = {
  get_state: {
    description: "Current mission state: phase, state version, targets, observed-map counts, rover battery, waiting time. No hidden truth.",
    input: z.object({}).strict(),
  },
  plan_route: {
    description: "Plan an A* route on the OBSERVED map. mode crew: observed crew-walkable ground only; candidate: may cross unobserved ground (never approvable); rover: rover-drivable ground.",
    input: z.object({ from: Place, to: Place, mode: z.enum(["crew", "candidate", "rover"]) }).strict(),
  },
  eva_budget: {
    description: "Crew round-trip budget (upstream Sol Atlas EVA model) to a target on safe crew routes of the observed map, after an optional wait.",
    input: z.object({ targetId: z.string().min(1), waitMin: z.number().min(0).max(600).default(0) }).strict(),
  },
  estimate_scouting: {
    description: "Best-case scouting estimate for the primary target (assumes every unobserved cell is firm): wait, rover distance and energy.",
    input: z.object({}).strict(),
  },
  evaluate_options: {
    description: "The deterministic decision options (scout / continue / detour / known / switch / cancel) with their numbers, violations and value under the configured simulation assumptions.",
    input: z.object({}).strict(),
  },
  choose_option: {
    description: "Act on one option. Refused unless stateVersion is the current version and the option is feasible now.",
    input: z.object({ optionId: z.enum(OPTION_KINDS), stateVersion: z.number().int() }).strict(),
  },
} as const;

export type ToolName = keyof typeof TOOLS;
export type ToolResult = { ok: true; result: unknown } | { ok: false; error: string };

/** Tool definitions (name, description, JSON schema of the input). */
export function toolDefinitions() {
  return (Object.keys(TOOLS) as ToolName[]).map((name) => ({ name, description: TOOLS[name].description, input_schema: z.toJSONSchema(TOOLS[name].input) }));
}

const r = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function routeView(m: Mission, route: Route | null) {
  if (!route) return null;
  const step = Math.max(1, Math.floor(route.cells.length / 40));
  const path: LonLat[] = route.cells.filter((_, k) => k % step === 0 || k === route.cells.length - 1).map((c) => lonLatOfCell(m.grid, c));
  return { mode: route.mode, length_m: Math.round(route.lengthM), unobserved_m: Math.round(route.unknownLengthM), map_version: route.mapVersion, path_lonlat: path };
}

function optionView(o: RouteOption) {
  return { id: o.id, target_id: o.targetId, role: o.role, label: o.label, feasible: o.feasible, violations: o.violations, metrics: o.metrics };
}

function cellOf(m: Mission, place: string): number | null {
  if (place === "base") return m.cells.base;
  if (place === "rover") return m.rover.cell;
  return m.cells.targets[place] ?? null;
}

/** Call one tool against a mission. Never throws for bad input: returns { ok: false, error }. */
export function callTool(m: Mission, name: string, rawInput: unknown = {}): ToolResult {
  if (!(name in TOOLS)) return { ok: false, error: `Unknown tool ${name}` };
  const tool = TOOLS[name as ToolName];
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const input = parsed.data as Record<string, unknown>;
  const snap = m.snapshot();
  switch (name as ToolName) {
    case "get_state":
      return {
        ok: true,
        result: {
          state_version: snap.version,
          phase: snap.phase,
          primary_target: snap.primaryId,
          alternative_target: snap.alternativeId,
          targets: m.targets.map((t) => ({ id: t.id, name: t.name })),
          observed_cells: snap.mapCounts,
          wait_min: Math.round(snap.waitS / 60),
          rover: { battery_pct: Math.round((snap.rover.batteryWh / snap.roverDetail.capacityWh) * 100), busy: snap.rover.busy, odometer_km: r(snap.roverDetail.odometerM / 1000) },
          observations: snap.observations,
          scouting_result: snap.scoutReason,
          eva_window_h: snap.params?.evaMaxH,
        },
      };
    case "plan_route": {
      const from = cellOf(m, String(input.from));
      const to = cellOf(m, String(input.to));
      if (from === null || to === null) return { ok: false, error: "Unknown place" };
      return { ok: true, result: { state_version: snap.version, route: routeView(m, planRoute(m.grid, m.map, from, to, { mode: input.mode as Route["mode"], params: m.params })) } };
    }
    case "eva_budget": {
      const target = m.cells.targets[String(input.targetId)];
      if (target === undefined) return { ok: false, error: "Unknown target" };
      const d = departure(m.grid, m.map, { baseCell: m.cells.base, targetCell: target, waitS: Number(input.waitMin) * 60, params: m.params });
      return { ok: true, result: { state_version: snap.version, feasible: d.feasible, violations: d.violations, sortie: d.sortie, outbound: routeView(m, d.route), back: routeView(m, d.returnRoute) } };
    }
    case "estimate_scouting": {
      const e = estimateScouting(m.grid, m.map, { roverCell: snap.rover.cell, baseCell: m.cells.base, targetCell: m.cells.targets[m.primaryId], batteryWh: snap.rover.batteryWh, spec: m.roverSpec, params: m.params });
      return { ok: true, result: { state_version: snap.version, reason: e.reason, posts: e.posts, wait_min: Math.round(e.waitS / 60), rover_km: r(e.distanceM / 1000), rover_kwh: r(e.wh / 1000), shortcut: routeView(m, e.shortcut) } };
    }
    case "evaluate_options": {
      const ev = m.options();
      return { ok: true, result: { state_version: ev.stateVersion, recommended_by_value: ev.recommendedByValue, options: ev.options.map(optionView) } };
    }
    case "choose_option": {
      if (input.stateVersion !== m.version) return { ok: false, error: `Stale state version ${String(input.stateVersion)} (current ${m.version}): re-read the options` };
      const res = m.approve(String(input.optionId));
      return res.ok ? { ok: true, result: { state_version: m.version, phase: m.phase } } : { ok: false, error: res.reason };
    }
  }
}
