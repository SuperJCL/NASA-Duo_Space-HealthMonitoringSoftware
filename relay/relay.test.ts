import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRelay } from "./relay.ts";

let base = "";
const relay = createRelay({ leaseMs: 400 });
beforeAll(async () => {
  base = `http://127.0.0.1:${await relay.listen(0, "127.0.0.1")}`;
});
afterAll(() => relay.close());

const env = (o: Record<string, unknown>) => ({ schema: "myomars/v1", sessionId: "t", sentAt: new Date().toISOString(), caseId: null, ...o });
const start = (runId: string) => env({ eventId: `start-${runId}`, runId, source: "trigger", type: "scenario.start", payload: { scenarioId: "s", astronaut: { id: "a-02", callsign: "A-02" }, task: { id: "t", title: "T", targetId: null } } });
const post = (body: unknown, role: string, client = "c1", sid = "t") => fetch(`${base}/v1/sessions/${sid}/events`, { method: "POST", headers: { "content-type": "application/json", "x-myomars-role": role, "x-myomars-client": client }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

describe("local relay (HTTP publish + SSE)", () => {
  it("validates against the shared contracts and the publisher role", async () => {
    expect((await post({ schema: "myomars/v1" }, "trigger")).body.error).toBe("invalid");
    expect((await post(start("r1"), "hud")).body).toMatchObject({ error: "role-not-allowed" });
    expect((await post(start("r1"), "nobody")).body).toMatchObject({ error: "unknown-role" });
    expect((await post({ ...start("r1"), sessionId: "other" }, "trigger")).body).toMatchObject({ error: "session-mismatch" });
  });

  it("sequences, de-duplicates, refuses conflicts and gates runs", async () => {
    const s1 = start("r1");
    const a = await post(s1, "trigger");
    expect(a).toMatchObject({ status: 200, body: { seq: 1, duplicate: false } });
    expect((await post(s1, "trigger")).body).toMatchObject({ seq: 1, duplicate: true });
    expect((await post({ ...s1, sentAt: "2026-01-01T00:00:00Z" }, "trigger")).body).toMatchObject({ error: "eventId-conflict" });
    const ackOther = env({ eventId: "ack-x", runId: "r0", caseId: "c", source: "hud", type: "hud.ack", payload: { messageId: "m" } });
    expect((await post(ackOther, "hud")).body).toMatchObject({ error: "unknown-run" });
    await post(start("r2"), "trigger");
    expect((await post({ ...ackOther, eventId: "ack-y", runId: "r1" }, "hud")).body).toMatchObject({ error: "stale-run" });
    const hist = await fetch(`${base}/v1/sessions/t/events?after=0`).then((r) => r.json());
    expect(hist.events.map((e: { seq: number; sender: { role: string } }) => [e.seq, e.sender.role])).toEqual([
      [1, "trigger"],
      [2, "trigger"],
    ]);
    expect(hist.lastSeq).toBe(2);
  });

  it("streams delivered events (resume after a sequence number)", async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${base}/v1/sessions/s2/stream?after=0`, { signal: ctrl.signal });
    expect((await post({ ...start("q1"), sessionId: "s2" }, "trigger", "c1", "s2")).status).toBe(200);
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("data:")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    clearTimeout(timer);
    ctrl.abort();
    expect(text).toMatch(/id: 1\ndata: \{.*"type":"scenario.start"/);
  });

  it("lets one station window publish at a time (lease)", async () => {
    const lease = (id: string) => fetch(`${base}/v1/sessions/t/station-lease`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: id }) }).then((r) => r.status);
    expect(await lease("w1")).toBe(200);
    expect(await lease("w2")).toBe(409);
    const receipt = env({ eventId: "stn-r2-001", runId: "r2", caseId: "c", source: "station", type: "station.receipt", payload: { receivedEventId: "x", receivedType: "retest.result", status: "rejected", reason: "test" } });
    expect((await post(receipt, "station", "w2")).body).toMatchObject({ error: "not-lease-holder", holder: "w1" });
    expect((await post(receipt, "station", "w1")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 450)); // lease expired without renewal
    expect(await lease("w2")).toBe(200);
  });

  it("allows same-host browser origins on any port (dev), not others", async () => {
    const ok = await fetch(`${base}/v1/health`, { headers: { origin: "http://127.0.0.1:3000" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3000");
    const no = await fetch(`${base}/v1/health`, { headers: { origin: "http://evil.example" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });
});
