import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockStationAdapter } from "./adapter";
import { StationController } from "./controller";
import { crewCards } from "./crew";
import { DemoDirector, demoTargetCase } from "./demo";
import { ageText, freshnessOf, missionCrewView } from "./mission-crew";

function setup() {
  const adapter = new MockStationAdapter();
  const ctl = new StationController(adapter, 1100);
  ctl.attach();
  const director = new DemoDirector((raw) => adapter.inject(raw));
  director.setAutoHud(false);
  ctl.subscribe(() => director.update(ctl.getSnapshot().state));
  director.update(ctl.getSnapshot().state);
  const st = () => ctl.getSnapshot().state;
  const view = (now = Date.now()) => missionCrewView(st(), crewCards(st(), { mock: true }), { mock: true, now });
  return { ctl, director, st, view, caseOf: (a: string) => demoTargetCase(st(), a)! };
}
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const ANALYSIS = 4 * 1100 + 50;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Mission & Crew view: known facts only", () => {
  it("before any data: nothing is filled in (device unknown, no HUD message, no measurement)", () => {
    const { view } = setup();
    expect(view().crew).toEqual([]);
    expect(view().totals).toEqual({ cases: 0, open: 0, closed: 0, needsBase: 0 });
  });

  it("follows a case: waiting party from the event chain, data age as display, last HUD message as a fact", async () => {
    const { ctl, director, view, caseOf } = setup();
    director.launch("ev1", "change");
    await tick(1500);
    const id = caseOf("ev1");
    let a = view().crew.find((c) => c.astronautId === "ev1")!;
    expect(a.hud).toEqual({ at: null, text: "No HUD in the local simulation" });
    expect(a.openCases).toHaveLength(1);
    expect(a.openCases[0].waitingFor).toBe("the system");
    expect(a.data.at).not.toBeNull();
    expect(a.data.freshness).toBe("fresh");

    await tick(ANALYSIS);
    a = view().crew.find((c) => c.astronautId === "ev1")!;
    expect(a.needsBase).toBe(1);
    expect(a.openCases[0]).toMatchObject({ caseId: id, needsBase: true, waitingFor: "base staff" });
    expect(view().totals).toMatchObject({ cases: 1, open: 1, closed: 0, needsBase: 1 });

    // Age is computed from the measurement time only; it changes no business state.
    const later = Date.now() + 40 * 60_000;
    expect(view(later).crew[0].data.freshness).toBe("stale");
    expect(view(later).crew[0].openCases[0].waitingFor).toBe("base staff");

    ctl.review(id, 1, "approve", "Retest with the standard protocol", "Base duty officer");
    await tick(100);
    expect(view().crew[0].openCases[0].waitingFor).toBe("the HUD");
    director.hud(id, "received");
    a = view().crew[0];
    expect(a.hud.text).toBe("Received by HUD");
    expect(a.hud.at).not.toBeNull();
    expect(a.openCases[0].waitingFor).toBe("the crew");
    director.hud(id, "ack");
    expect(view().crew[0].hud.text).toBe("Acknowledged by Crew");
  });

  it("closed cases leave the open list; totals count them as closed", async () => {
    const { ctl, director, view, caseOf } = setup();
    director.launch("ev1", "normal");
    await tick(1500 + ANALYSIS);
    const id = caseOf("ev1");
    expect(view().totals.open).toBe(1);
    ctl.review(id, 1, "close", "Within reference range, recorded", "Base duty officer");
    await tick(100);
    expect(view().crew[0].openCases).toEqual([]);
    expect(view().totals).toMatchObject({ cases: 1, open: 0, closed: 1 });
  });

  it("age wording and freshness bands", () => {
    expect(freshnessOf(null)).toBe("none");
    expect(freshnessOf(5)).toBe("fresh");
    expect(freshnessOf(6)).toBe("aging");
    expect(freshnessOf(31)).toBe("stale");
    expect(ageText(null)).toBe("–");
    expect(ageText(0)).toBe("just now");
    expect(ageText(12)).toBe("12 min ago");
    expect(ageText(75)).toBe("1 h 15 min ago");
  });
});
