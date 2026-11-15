import { describe, expect, it } from "vitest";
import { inboundEnvelope } from "./adapter";
import { businessProgress, canvasPlan, divergence } from "./canvas";
import { DEMO_BASELINES, DEMO_START, FIXTURES } from "./fixtures";
import { initialState, latest, stagesToReveal, step, type StationState } from "./station";

const T = "2026-11-14T10:00:00Z";
function analysed(fx: keyof typeof FIXTURES, ticks = Infinity) {
  let s: StationState = initialState(DEMO_BASELINES);
  for (const raw of [inboundEnvelope("scenario.start", { runId: "r", payload: DEMO_START, eventId: "s" }), inboundEnvelope("observation.submitted", { runId: "r", caseId: FIXTURES[fx].caseId, payload: FIXTURES[fx].observation, eventId: `o-${fx}` })]) s = step(s, { type: "inbound", raw, at: T }).state;
  const ev = () => latest(s.cases[FIXTURES[fx].caseId]);
  const n = Math.min(ticks, stagesToReveal(ev().result));
  for (let i = 0; i < n; i++) s = step(s, { type: "stage-tick", runId: "r", caseId: FIXTURES[fx].caseId, version: 1, at: T }).state;
  return ev();
}
const human = { label: "等待基地审核", outcome: "human" as const };

describe("data-flow canvas plan (the path the data actually took)", () => {
  it("normal path: device data → quality → conditions → indicators → base review", () => {
    const steps = canvasPlan(analysed("change"), "EV1（模拟宇航员）", human)!;
    expect(steps.map((s) => `${s.edge}>${s.to}`)).toEqual(["e-source>receive", "e-quality>quality", "e-context>context", "e-features>features", "e-review>review"]);
    expect(steps.map((s) => s.result)).toEqual(["已接收：标准握持 40% MVC · 30 s", "合格：6 项参数在阈值内", "条件一致，可比较", "3 项超出参考范围", "等待基地审核"]);
    expect(steps.at(-1)!.outcome).toBe("human");
    expect(steps[0].packet).toBe("EV1 · 设备数据 10:00");
    expect(divergence(steps)).toBeNull();
  });

  it("quality failure takes the branch: quality → check device / re-measure → base review; normal downstream not used", () => {
    const steps = canvasPlan(analysed("acquisition"), "EV1（模拟宇航员）", human)!;
    expect(steps.map((s) => s.edge)).toEqual(["e-source", "e-quality", "b-quality", "b-review"]);
    expect(steps[1]).toMatchObject({ outcome: "stopped", result: "不合格：电极阻抗、运动伪迹" });
    expect(steps[2].packet).toBe("质量不合格：电极阻抗、运动伪迹");
    expect(divergence(steps)).toBe(1);
  });

  it("not comparable takes the other branch from the condition check", () => {
    const steps = canvasPlan(analysed("not-comparable"), "EV1（模拟宇航员）", human)!;
    expect(steps.map((s) => s.edge)).toEqual(["e-source", "e-quality", "e-context", "b-context", "b-review"]);
    expect(steps[2].outcome).toBe("stopped");
  });

  it("gates every result on what the station has revealed (never ahead of the business state)", () => {
    expect(businessProgress(analysed("change", 0))).toBe(0);
    expect(businessProgress(analysed("change", 1))).toBe(1);
    expect(businessProgress(analysed("change", 3))).toBe(3);
    expect(businessProgress(analysed("change"))).toBe(5);
    const steps = canvasPlan(analysed("change"), "EV1", human)!;
    expect(steps.map((s) => s.needs)).toEqual([0, 1, 2, 3, 5]);
  });

  it("a report check is not drawn as a data flow", () => {
    const ev = { ...analysed("change"), observation: null };
    expect(canvasPlan(ev, "EV1", human)).toBeNull();
  });
});
