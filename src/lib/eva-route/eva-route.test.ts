import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaRouteWorld, missionFor } from "@/lib/test-fixtures/eva-route-world";
import { budget, EVA_DEFAULTS, metabolicW, o2KgPerSec, stepCost, verdict, walkSpeed } from "./sol-atlas-eva";
import { cellOfLonLat, distM, lonLatOfCell } from "./grid";
import { RIPPLES, UNKNOWN } from "./knowledge";
import { crewWalkable } from "./traversal";
import { planRoute } from "./planner";
import { buildOverlay } from "./overlay";
import { callTool, toolDefinitions } from "./tools";
import { parseEvaScouting } from "./scenario";
import raw from "@/data/prototype/eva-scouting.json";

describe("Sol Atlas EVA model (TypeScript port)", () => {
  it("matches values computed with the unmodified upstream eva.js (commit 9e1b2e0)", () => {
    // Reference values: node, upstream src/terrain/eva.js, EVA_DEFAULTS, on 2026-11-14.
    expect(walkSpeed(0)).toBeCloseTo(0.9, 12);
    expect(walkSpeed((10 * Math.PI) / 180)).toBeCloseTo(0.4855344926567273, 12);
    expect(metabolicW(0.8, 5)).toBeCloseTo(386.02016978593275, 10);
    expect(o2KgPerSec(300)).toBeCloseTo(0.00002132835820895522, 15);
    expect(stepCost(20, 1)).toBeCloseTo(9826.93103349688, 8);
    const b = budget(
      [
        { d: 0, e: 0 },
        { d: 100, e: 5 },
        { d: 250, e: 2 },
        { d: 400, e: -10 },
        { d: 1000, e: -12 },
      ],
      [400],
      EVA_DEFAULTS,
    );
    expect(b.walkT).toBeCloseTo(1102.092714035705, 8);
    expect(b.totalT).toBeCloseTo(2302.0927140357053, 8);
    expect(b.o2).toBeCloseTo(0.041356013027057194, 12);
    expect(b.marginPct).toBeCloseTo(93.10733116215714, 8);
    expect(b.maxSlope).toBeCloseTo(4.573921259900861, 10);
    expect(verdict(b).lvl).toBe("go");
  });
});

describe("planning grid on the verified CTX crop", () => {
  it("uses the committed heights unchanged and derives slope from them", () => {
    const { grid, heights } = evaRouteWorld();
    expect(grid.elev).toBe(heights);
    expect(grid.w * grid.h).toBe(160 * 160);
    expect(grid.cellY).toBeCloseTo(20, 6);
    expect(grid.cellX).toBeCloseTo(3034.9 / 160, 6);
    // 20 m posts over gentle terrain: most slopes are small; none is invented above 90°.
    const sorted = [...grid.slope].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThanOrEqual(6);
    expect(sorted[sorted.length - 1]).toBeLessThan(40);
  });

  it("round-trips a cell through lon/lat", () => {
    const { grid } = evaRouteWorld();
    for (const i of [0, 1234, 12880, grid.n - 1]) expect(cellOfLonLat(grid, lonLatOfCell(grid, i))).toBe(i);
    expect(distM(grid, 0, 1)).toBeCloseTo(grid.cellX, 6);
  });
});

describe("observed map vs hidden truth", () => {
  it("planner-side modules never import the simulator truth", () => {
    for (const f of ["planner", "options", "scouting", "tools", "budget", "traversal", "assumptions", "knowledge", "pathfind"]) {
      const src = readFileSync(`src/lib/eva-route/${f}.ts`, "utf8");
      expect(src, f).not.toMatch(/from "\.\/truth"/);
    }
    // overlay.ts may only take the truth as a type, for the labelled simulator view.
    expect(readFileSync("src/lib/eva-route/overlay.ts", "utf8")).toMatch(/import type \{ Truth \} from "\.\/truth"/);
  });

  it("starts from surveyed ground only; unobserved is not safe", () => {
    const m = missionFor("B");
    const snap = m.snapshot();
    expect(snap.mapCounts.ripples).toBe(0); // the hidden ripple field is not on the planner's map
    expect(JSON.stringify(Object.keys(snap))).not.toMatch(/truth|sensor|hazard/i);
    const known = m.routes.initialKnown!;
    expect(known.unknownCells).toHaveLength(0);
    expect(known.cells.every((i) => crewWalkable(m.grid, m.map, i))).toBe(true);
    const cand = m.routes.initialCandidate!;
    expect(cand.unknownLengthM).toBeGreaterThan(500);
    expect(cand.lengthM).toBeLessThan(known.lengthM * 0.95);
    // A crew route on the observed map never crosses unobserved cells.
    const crew = planRoute(m.grid, m.map, m.cells.base, m.cells.targets[m.primaryId], { mode: "crew" })!;
    expect(crew.cells.some((i) => m.map.cells[i] === UNKNOWN)).toBe(false);
  });

  it("the rover's observations are the only way hazards reach the map", () => {
    const m = missionFor("B");
    const truthRipples = m.debugTruth().surface.filter((s) => s === RIPPLES).length;
    expect(truthRipples).toBeGreaterThan(100);
    expect(m.startScouting().ok).toBe(true);
    m.skipScouting();
    expect(m.observations.length).toBeGreaterThan(0);
    const seen = m.map.cells.filter((s) => s === RIPPLES).length;
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThanOrEqual(truthRipples);
    // Crew-blocked but rover-drivable: the rover got through, the crew may not walk it.
    expect(m.observations.some((o) => o.crewBlocked > 0)).toBe(true);
    expect(m.observations.every((o) => o.roverBlocked === 0)).toBe(true);
  });
});

describe("scenario variants (decisions are computed, not hard-coded)", () => {
  const rec = (v: string) => missionFor(v).options();

  it("A: scouting is worth it, then the confirmed shortcut is recommended", () => {
    const first = rec("A");
    expect(first.recommendedByValue).toBe("scout");
    const m = missionFor("A");
    m.startScouting();
    m.skipScouting();
    expect(m.scoutReason).toBe("confirmed");
    expect(m.waitS).toBeGreaterThan(0);
    const after = m.options();
    expect(after.recommendedByValue).toBe("continue");
    const cont = after.options.find((o) => o.id === "continue")!;
    expect(cont.sortie!.waitS).toBeCloseTo(m.waitS, 6); // waiting is charged to the EVA
    expect(m.approve("continue").ok).toBe(true);
    expect(m.routes.approved?.returnRoute.cells.length).toBeGreaterThan(1);
  });

  it("B: same first decision as A; after the obstacle is seen, a detour beats the known route", () => {
    expect(rec("B").recommendedByValue).toBe(rec("A").recommendedByValue);
    const m = missionFor("B");
    m.startScouting();
    m.skipScouting();
    const after = m.options();
    expect(after.recommendedByValue).toBe("detour");
    const v = Object.fromEntries(after.options.map((o) => [o.id, o.value]));
    expect(v.detour!).toBeGreaterThan(v.known!);
    expect(after.options.find((o) => o.id === "continue")!.feasible).toBe(false);
  });

  it("C: scouting is feasible but not worth it (rover far away, low charge)", () => {
    const ev = rec("C");
    const scout = ev.options.find((o) => o.id === "scout")!;
    expect(scout.feasible).toBe(true);
    expect(ev.recommendedByValue).toBe("known");
    expect(scout.value!).toBeLessThan(ev.options.find((o) => o.id === "known")!.value!);
  });

  it("a tighter EVA window can make a departure infeasible, and approval is then refused", () => {
    const m = missionFor("A");
    expect(m.setLimits({ evaMaxH: 1 }).ok).toBe(true);
    const known = m.options().options.find((o) => o.id === "known")!;
    expect(known.feasible).toBe(false);
    expect(known.violations.join(" ")).toMatch(/exceeds the 1 h suit rating/);
    expect(m.approve("known").ok).toBe(false);
  });

  it("refuses approval while scouting and after a decision; versions only move forward", () => {
    const m = missionFor("A");
    const v0 = m.version;
    m.startScouting();
    expect(m.approve("known")).toEqual({ ok: false, reason: "Wait for the scouting result first" });
    m.skipScouting();
    expect(m.version).toBeGreaterThan(v0);
    expect(m.cancel().ok).toBe(true);
    expect(m.approve("known").ok).toBe(false);
    expect(missionFor("A").version).toBeGreaterThan(m.version); // unique across missions
  });
});

describe("agent tool entry point (no agent wired in)", () => {
  it("publishes JSON schemas and validates input", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name)).toEqual(["get_state", "plan_route", "eva_budget", "estimate_scouting", "evaluate_options", "choose_option"]);
    for (const d of defs) expect(d.input_schema).toHaveProperty("type", "object");
    const m = missionFor("A");
    expect(callTool(m, "nope").ok).toBe(false);
    expect(callTool(m, "plan_route", { from: "base", to: "sim-target-a", mode: "walk" }).ok).toBe(false);
    expect(callTool(m, "plan_route", { from: "base", to: "sim-target-a", mode: "crew" }).ok).toBe(true);
  });

  it("never exposes the hidden truth, and refuses a stale choice", () => {
    const m = missionFor("B");
    const out = ["get_state", "evaluate_options", "estimate_scouting"].map((n) => JSON.stringify(callTool(m, n, {})));
    for (const s of out) expect(s).not.toMatch(/truth|hazard|ripple field/i);
    const ev = callTool(m, "evaluate_options") as { ok: true; result: { state_version: number } };
    const stale = ev.result.state_version - 1;
    expect(callTool(m, "choose_option", { optionId: "known", stateVersion: stale }).ok).toBe(false);
    const ok = callTool(m, "choose_option", { optionId: "known", stateVersion: ev.result.state_version });
    expect(ok.ok).toBe(true);
    expect(m.phase).toBe("approved");
  });
});

describe("scenario data and overlay", () => {
  it("is labelled simulated and keeps the traverse assumption explicit", () => {
    const s = parseEvaScouting(raw);
    expect(s.basis).toBe("simulated");
    expect(s.base.name).toMatch(/simulated/i);
    const tr = s.knownAreas.find((a) => a.kind === "traverse")!;
    expect(tr.label).toMatch(/real NASA data/);
    expect(tr.label).toMatch(/simulation assumption/);
    for (const v of s.variants) for (const h of v.hazards) expect(h.label).toMatch(/simulated/i);
  });

  it("draws an unconfirmed shortcut dashed yellow and hides the truth unless asked", () => {
    const m = missionFor("B");
    const o = buildOverlay({
      grid: m.grid,
      map: m.map,
      verified: m.verified,
      truth: null,
      base: { cell: m.cells.base, label: "Habitat" },
      rover: m.rover,
      routes: m.routes,
      preview: null,
      observationPosts: [],
    });
    const cand = o.paths.find((p) => p.id === "candidate")!;
    expect(cand).toMatchObject({ tone: "candidate", dashed: true });
    const tinted = (rgba: Uint8ClampedArray) => rgba.filter((_, k) => k % 4 === 3 && rgba[k] > 0).length;
    const withTruth = buildOverlay({ grid: m.grid, map: m.map, verified: m.verified, truth: m.debugTruth(), base: { cell: m.cells.base, label: "Habitat" }, rover: m.rover, routes: m.routes, preview: null, observationPosts: [] });
    expect(tinted(withTruth.rgba)).toBeGreaterThan(tinted(o.rgba));
    expect(withTruth.key).not.toBe(o.key);
  });
});
