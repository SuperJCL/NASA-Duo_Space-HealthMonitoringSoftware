import { afterEach, describe, expect, it } from "vitest";
import { DEMO_START } from "@/contracts/demo-fixtures";
import { activeRunOf, createBrowserRelay, DEMO_BASE } from "./browser-relay";
import { RelayStationAdapter } from "@/lib/station/relay-adapter";
import { setTransportMode } from "@/lib/station/transport-words";

const start = (sid: string, runId = "eva-test-1", eventId = "start-1") => ({
  schema: "myomars/v1",
  eventId,
  sessionId: sid,
  runId,
  caseId: null,
  sentAt: new Date().toISOString(),
  source: "station",
  type: "scenario.start",
  payload: { ...DEMO_START, astronaut: { id: "a-02", callsign: "A-02" }, task: { id: "task-1", title: "Survey", targetId: "sim-target-b" } },
});
const post = (f: ReturnType<typeof createBrowserRelay>["fetch"], sid: string, body: unknown, role = "station", client = "station-x") =>
  f(`${DEMO_BASE}/v1/sessions/${sid}/events`, { method: "POST", headers: { "content-type": "application/json", "x-myomars-role": role, "x-myomars-client": client }, body: JSON.stringify(body) });

afterEach(() => setTransportMode("relay"));

describe("browser-demo bus: the relay's rules inside one tab", () => {
  it("publishes, de-duplicates by eventId, and serves history and the event stream", async () => {
    const bus = createBrowserRelay();
    const sid = bus.newSessionId();
    const env = start(sid);
    const r1 = await post(bus.fetch, sid, env);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ seq: 1, duplicate: false });
    const r2 = await post(bus.fetch, sid, env);
    expect(await r2.json()).toMatchObject({ seq: 1, duplicate: true });
    // same eventId, different content: refused
    expect((await post(bus.fetch, sid, { ...env, sentAt: "2026-01-01T00:00:00.000Z" })).status).toBe(409);
    expect(bus.core.events(sid)).toHaveLength(1);
    const h = await (await bus.fetch(`${DEMO_BASE}/v1/sessions/${sid}/events?after=0`)).json();
    expect(h.lastSeq).toBe(1);
    // the stream replays after `after`, then delivers new events; abort stops it
    const ac = new AbortController();
    const res = await bus.fetch(`${DEMO_BASE}/v1/sessions/${sid}/stream?after=0`, { signal: ac.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    while (!text.includes("id: 1")) text += dec.decode((await reader.read()).value);
    expect(text).toContain('"type":"scenario.start"');
    ac.abort();
    await expect(reader.read()).rejects.toThrow();
  });

  it("keeps the relay's role rules and run isolation", async () => {
    const bus = createBrowserRelay();
    const sid = bus.newSessionId();
    expect((await post(bus.fetch, sid, start(sid), "hud", "hud-a02")).status).toBe(403); // only the station starts a run
    await post(bus.fetch, sid, start(sid, "eva-1", "s1"));
    await post(bus.fetch, sid, start(sid, "eva-2", "s2")); // a new run ends the previous one
    const late = { ...start(sid, "eva-1", "s3"), type: "scenario.reset", payload: {} };
    expect((await (await post(bus.fetch, sid, { ...late, source: "trigger" }, "trigger", "replay")).json()).error).toBe("stale-run");
    expect(activeRunOf(bus.core, sid)?.runId).toBe("eva-2");
  });

  it("isolates sessions and forgets a dropped one", async () => {
    const bus = createBrowserRelay();
    const a = bus.newSessionId();
    const b = bus.newSessionId();
    expect(a).not.toBe(b);
    await post(bus.fetch, a, start(a));
    expect(bus.core.events(a)).toHaveLength(1);
    expect(bus.core.events(b)).toHaveLength(0);
    bus.core.drop(a);
    expect(bus.core.history(a, 0).lastSeq).toBe(0);
  });

  it("refuses anything that is not the browser-demo scheme (never a network request)", async () => {
    const bus = createBrowserRelay();
    await expect(bus.fetch("http://127.0.0.1:8787/v1/health")).rejects.toThrow(/browser-demo bus/);
  });

  it("drives the unchanged station relay adapter: lease, stream, send", async () => {
    setTransportMode("browser-demo");
    const bus = createBrowserRelay();
    const sid = bus.newSessionId();
    const adapter = new RelayStationAdapter({ baseUrl: DEMO_BASE, sessionId: sid, clientId: "station-t", fetchImpl: bus.fetch });
    const got: unknown[] = [];
    const off = adapter.subscribe((raw) => got.push(raw));
    for (let i = 0; i < 50 && adapter.getStatus().conn !== "online"; i++) await new Promise((r) => setTimeout(r, 10));
    expect(adapter.getStatus()).toMatchObject({ conn: "online", lease: "holder" });
    expect(adapter.label).toMatch(/^In-browser bus \(this tab\)/);
    const res = await adapter.send(start(sid) as never);
    expect(res).toMatchObject({ ok: true });
    expect(res.note).toMatch(/^Accepted by the in-browser bus \(seq 1\)/);
    for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(got).toHaveLength(1);
    off();
  });
});
