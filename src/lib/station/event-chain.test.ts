import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockStationAdapter } from "./adapter";
import { StationController } from "./controller";
import { DemoDirector, demoTargetCase } from "./demo";
import { eventChain, type ChainId } from "./event-chain";

function setup() {
  const adapter = new MockStationAdapter();
  const ctl = new StationController(adapter, 1100);
  ctl.attach();
  const director = new DemoDirector((raw) => adapter.inject(raw));
  director.setAutoHud(false);
  ctl.subscribe(() => director.update(ctl.getSnapshot().state));
  director.update(ctl.getSnapshot().state);
  const st = () => ctl.getSnapshot().state;
  const chain = (id: string) => eventChain(st(), st().cases[id], { mock: true });
  const states = (id: string) => Object.fromEntries(chain(id).nodes.map((n) => [n.id, n.state])) as Record<ChainId, string>;
  return { ctl, director, st, chain, states, caseOf: (a: string) => demoTargetCase(st(), a)! };
}
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const ANALYSIS = 4 * 1100 + 50;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("event chain: Data source → Base analysis → Base review → HUD → Crew response → Retest → Reassessment", () => {
  it("follows the recorded case only, end to end; case closed and closing notice delivered stay separate", async () => {
    const { ctl, director, chain, states, caseOf } = setup();
    director.launch("ev1", "change");
    await tick(1500);
    const id = caseOf("ev1");
    expect(states(id)).toMatchObject({ source: "done", analysis: "running", review: "todo", hud: "todo", crew: "todo", retest: "todo", reassessment: "todo" });
    expect(chain(id).current).toBe("analysis");
    expect(chain(id).events.map((e) => e.key.split(":").slice(1).join(":"))).toEqual(["arrive"]);

    await tick(ANALYSIS);
    let c = chain(id);
    expect(states(id)).toMatchObject({ analysis: "done", review: "human" });
    expect(c.nodes[1]).toMatchObject({ tone: "alert", summary: "Indicators beyond the individual baseline variation" });
    expect(c.nodes[2]).toMatchObject({ waitingFor: "base staff", summary: "Awaiting Base Review" });
    expect(c.current).toBe("review");

    // Nothing moves on with time alone.
    await tick(60_000);
    expect(states(id).review).toBe("human");

    ctl.review(id, 1, "approve", "Retest with the standard protocol", "Base duty officer");
    await tick(100);
    c = chain(id);
    expect(states(id)).toMatchObject({ review: "done", hud: "waiting", crew: "todo" });
    expect(c.nodes[3].summary).toBe("Sent (local simulation) · awaiting receipt");
    expect(c.nodes[3].messages.map((m) => m.type)).toEqual(["station.notice.approved", "station.retest.requested"]);
    expect(c.events.some((e) => e.kind === "send")).toBe(true);
    // No receipt is inferred from time.
    await tick(120_000);
    expect(states(id).hud).toBe("waiting");
    expect(chain(id).events.some((e) => e.kind === "feedback")).toBe(false);

    director.hud(id, "received");
    expect(states(id)).toMatchObject({ hud: "done", crew: "waiting" });
    expect(chain(id).nodes[4].waitingFor).toBe("the crew");
    director.hud(id, "defer");
    expect(chain(id).nodes[4]).toMatchObject({ state: "stopped", tone: "caution" });
    director.hud(id, "ack");
    expect(states(id)).toMatchObject({ crew: "done", retest: "waiting" });
    director.hud(id, "retest-normal");
    await tick(100);
    expect(states(id)).toMatchObject({ retest: "done", reassessment: "running" });
    await tick(ANALYSIS);
    c = chain(id);
    expect(c.nodes[6]).toMatchObject({ state: "human", round: 2, waitingFor: "base staff" });
    expect(c.nodes[6].detail[0]).toBe("Round 1 result (kept): Indicators beyond the individual baseline variation");
    expect(c.closure.caseClosed).toBeNull();

    ctl.review(id, 2, "close", "Retest Within Reference Range; closed after the duty review", "Base duty officer");
    await tick(100);
    c = chain(id);
    expect(c.nodes[6]).toMatchObject({ state: "done", summary: "Case Closed · retest Within Reference Range" });
    expect(c.closure.caseClosed).toMatchObject({ by: "Base duty officer" });
    // Closed by the base, but the closing notice is not delivered until the HUD says so.
    expect(c.closure.notice.state).toBe("sent");
    expect(c.current).toBeNull();
    director.hud(id, "received");
    expect(chain(id).closure.notice.state).toBe("received");
    const kinds = chain(id).events.map((e) => `${e.kind}:${e.from}>${e.to}`);
    expect(kinds).toEqual(["data:0>1", "data:1>2", "send:2>3", "feedback:3>2", "feedback:4>3", "data:5>6", "send:6>3", "feedback:3>6"]);
  });

  it("signal quality failure: analysis done with a caution, then base review; nothing downstream pretends to run", async () => {
    const { director, chain, states, caseOf } = setup();
    director.launch("ev3", "acquisition");
    await tick(1500 + ANALYSIS);
    const id = caseOf("ev3");
    expect(chain(id).nodes[1]).toMatchObject({ state: "done", tone: "caution", summary: "Signal quality failed: Unable to Assess" });
    expect(states(id)).toMatchObject({ review: "human", hud: "todo", crew: "todo", retest: "todo", reassessment: "todo" });
  });

  it("Continue Monitoring without a task: no dispatch steps are shown as run", async () => {
    const { ctl, director, chain, states, caseOf } = setup();
    director.launch("ev2", "normal");
    await tick(1500 + ANALYSIS);
    const id = caseOf("ev2");
    ctl.review(id, 1, "keep-open", "Keep monitoring", "Base duty officer");
    await tick(100);
    expect(states(id)).toMatchObject({ review: "done", hud: "skipped", crew: "skipped", retest: "skipped", reassessment: "skipped" });
    expect(chain(id).nodes[2].summary).toBe("Continue Monitoring · Base duty officer");
    expect(chain(id).nodes[3].summary).toBe("No task sent · status notice sent");
    expect(chain(id).closure).toMatchObject({ caseClosed: null, notice: { state: "none" } });
  });

  it("closed while waiting for the crew: open steps become 'not needed', never 'done'", async () => {
    const { ctl, director, states, caseOf, chain } = setup();
    director.launch("ev1", "change");
    await tick(1500 + ANALYSIS);
    const id = caseOf("ev1");
    ctl.review(id, 1, "approve", "Retest", "Base duty officer");
    await tick(100);
    director.hud(id, "received");
    ctl.review(id, 1, "close", "Handled on site", "Base duty officer");
    await tick(100);
    expect(states(id)).toMatchObject({ hud: "done", crew: "skipped", retest: "skipped", reassessment: "skipped" });
    expect(chain(id).closure.notice.state).toBe("sent");
  });
});
