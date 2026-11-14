import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateContractFiles, exampleEnvelopes, scenarios } from "./generate-contracts.ts";
import { Delivered, EVENT_RULES, EVENT_TYPES, isAuditEvent, parseEnvelope, parseIncoming, PREVIOUS_SCHEMA, SCHEMA } from "../../src/contracts/envelope.ts";

describe("shared contracts v1", () => {
  it("committed language-neutral files match the Zod sources (run npm run contracts:build)", () => {
    for (const [rel, content] of Object.entries(generateContractFiles())) expect(readFileSync(rel, "utf8"), rel).toBe(content);
  });

  it("every example envelope is valid, simulated where it carries data, and allowed for its publisher", () => {
    for (const [type, env] of Object.entries(exampleEnvelopes())) {
      const r = parseEnvelope(env);
      expect(r.ok, type).toBe(true);
      expect((EVENT_RULES[type as keyof typeof EVENT_RULES].roles as readonly string[]).includes(env.source)).toBe(true);
    }
    for (const s of Object.values(scenarios())) expect(s.simulated).toBe(true);
  });

  it("rejects bad envelopes with a code: missing caseId / retestId, bad payload, unknown type, relay fields, old schema", () => {
    const ex = exampleEnvelopes();
    const bad = (raw: unknown) => {
      const r = parseEnvelope(raw);
      return r.ok ? null : r.code;
    };
    expect(bad({ ...ex["observation.submitted"], caseId: null })).toBe("invalid_envelope");
    expect(bad({ ...ex["retest.result"], retestId: null })).toBe("invalid_envelope");
    expect(bad({ ...ex["hud.defer"], payload: { messageId: "x" } })).toBe("invalid_payload");
    expect(bad({ ...ex["hud.ack"], type: "hud.read" })).toBe("invalid_envelope");
    expect(bad({ ...ex["hud.ack"], seq: 5 })).toBe("invalid_envelope");
    expect(bad({ ...ex["hud.ack"], schema: PREVIOUS_SCHEMA })).toBe("invalid_envelope");
    expect(bad({ ...ex["hud.ack"], sessionId: "Demo Session" })).toBe("invalid_envelope");
  });

  it("delivered envelopes carry the relay's seq, receive time and authenticated sender", () => {
    const d = { ...exampleEnvelopes()["hud.ack"], seq: 7, receivedAt: "2026-11-14T10:00:01.000Z", sender: { role: "hud", clientId: "c1" } };
    expect(Delivered.safeParse(d).success).toBe(true);
    expect(parseIncoming(d).ok).toBe(true);
    expect(parseIncoming({ ...d, sender: { role: "nobody", clientId: "c1" } }).ok).toBe(false);
  });

  it("only the station publishes station.* (incl. audit records); observers publish nothing; delivery ≠ ack ≠ completion", () => {
    for (const t of EVENT_TYPES) {
      const roles = EVENT_RULES[t].roles as readonly string[];
      expect(roles.includes("observer")).toBe(false);
      if (t.startsWith("station.")) expect(roles).toEqual(["station"]);
    }
    expect(isAuditEvent("station.audit.review")).toBe(true);
    expect(isAuditEvent("station.notice.approved")).toBe(false);
    expect(new Set(["hud.received", "hud.ack", "retest.completed", "retest.result"]).size).toBe(4);
    expect(EVENT_TYPES).toEqual(expect.arrayContaining(["hud.received", "hud.ack", "retest.completed", "retest.result"]));
  });

  it("retest.completed is a proposed extension; retest.result alone carries the whole retest submission", () => {
    expect(EVENT_RULES["retest.completed"].status).toBe("proposed-extension");
    expect(EVENT_RULES["retest.result"].status).toBe("core");
    const r = parseEnvelope(exampleEnvelopes()["retest.result"]);
    expect(r.ok && r.value.retestId).toBe("case-change-rt1");
    for (const t of ["scenario.start", "observation.submitted", "hud.received", "hud.ack", "hud.defer", "station.notice.approved", "station.retest.requested", "station.receipt", "station.reassessment"] as const) expect(EVENT_RULES[t].status).toBe("core");
  });

  it("schema identifiers are versioned", () => {
    expect(SCHEMA).toBe("myomars/v1");
    expect(PREVIOUS_SCHEMA).toBe("myomars.station/v0-draft");
  });
});
