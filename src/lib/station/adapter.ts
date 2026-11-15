// MyoMars base station: transport adapter. The station's business logic (station.ts) only sees
// raw inbound messages and outbound envelopes; HOW they travel is this adapter's job, so connecting
// the real Trigger and HUD means replacing the adapter, not the station.
//
// Only the local mock adapter exists today (standalone demo). It does not reach any other page or
// device; a "sent" delivery means "handed to the mock", never "received by the HUD".

import { SCHEMA, type Envelope, type InboundType } from "./protocol";
import type { LinkMode } from "./station";

/** `discard`: this window must not send at all (read-only window); the message is dropped, not marked failed. */
export type DeliveryResult = { ok: true; note: string } | { ok: false; note: string; discard?: boolean };

export interface StationAdapter {
  readonly mode: LinkMode;
  /** Short label for the station header, e.g. "Standalone demo · local mock". */
  readonly label: string;
  /**
   * Receive inbound messages (unvalidated: the station validates them). `onHistory` receives a batch
   * of already delivered messages (relay: first connection and every reconnection). Returns an
   * unsubscribe function.
   */
  subscribe(onInbound: (raw: unknown) => void, onHistory?: (raws: unknown[]) => void): () => void;
  /** Send one outbound envelope. Must be safe to call again with the same envelope (same eventId). */
  send(envelope: Envelope): Promise<DeliveryResult>;
}

/** In-memory adapter for standalone development. `inject` plays the role of Trigger / HUD in tests. */
export class MockStationAdapter implements StationAdapter {
  readonly mode = "standalone-mock" as const;
  readonly label = "Standalone demo · local mock adapter (no HUD or data source connected)";
  readonly sent: Envelope[] = [];
  private failNext = 0;
  private handlers = new Set<(raw: unknown) => void>();

  subscribe(onInbound: (raw: unknown) => void) {
    this.handlers.add(onInbound);
    return () => {
      this.handlers.delete(onInbound);
    };
  }

  async send(envelope: Envelope): Promise<DeliveryResult> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return { ok: false, note: "Simulated send failure in the mock adapter" };
    }
    this.sent.push(envelope);
    return { ok: true, note: "Handed to the local mock adapter (not a HUD receipt)" };
  }

  /** Development only: make the next n sends fail (to show delivery failure and resend). */
  failNextSends(n = 1) {
    this.failNext += n;
  }

  /** Development only: deliver a message as if it came from the Trigger or the HUD. */
  inject(raw: unknown) {
    for (const h of this.handlers) h(raw);
  }
}

let devSeq = 0;
/** Development helper: build an inbound envelope (as the Trigger or HUD would send it). */
export function inboundEnvelope(
  type: InboundType,
  { runId, caseId = null, retestId = null, payload, eventId, at, sessionId = "local" }: { runId: string; caseId?: string | null; retestId?: string | null; payload: unknown; eventId?: string; at?: string; sessionId?: string },
): Envelope {
  devSeq += 1;
  const source = type.startsWith("hud.") || type === "retest.result" ? "hud" : "trigger";
  return {
    schema: SCHEMA,
    eventId: eventId ?? `dev-${source}-${Date.now().toString(36)}-${devSeq}`,
    sessionId,
    runId,
    caseId,
    retestId,
    sentAt: at ?? new Date().toISOString(),
    source,
    type,
    payload,
  };
}
