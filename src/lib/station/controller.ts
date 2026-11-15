// MyoMars base station runtime: runs the pure state machine (station.ts) against an adapter.
// It executes the machine's effects: sends through the adapter, paces the simulated analysis
// stages with timers, and cancels every pending timer on a scenario reset. No DOM, no React:
// the UI subscribes to it, and tests drive it with fake timers.

import type { StationAdapter } from "./adapter";
import { DEMO_BASELINES } from "./fixtures";
import { initialState, step, type Action, type Decision, type StationState } from "./station";
import type { Baseline } from "./analysis";

export type Snapshot = { state: StationState; lastError: string | null };

const now = () => new Date().toISOString();

export class StationController {
  private snapshot: Snapshot;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private detachAdapter: (() => void) | null = null;

  constructor(
    private readonly adapter: StationAdapter,
    private readonly stageDelayMs = 1100,
    baselines: readonly Baseline[] = DEMO_BASELINES,
    sessionId = "local",
  ) {
    this.snapshot = { state: initialState(baselines, sessionId), lastError: null };
  }

  /** Start receiving from the adapter; returns the matching detach (also clears timers). */
  attach = () => {
    this.detachAdapter?.();
    // Delivered messages carry the relay's receive time; mock messages are stamped now.
    const at = (raw: unknown) => {
      const r = (raw as { receivedAt?: unknown } | null)?.receivedAt;
      return typeof r === "string" ? r : now();
    };
    this.detachAdapter = this.adapter.subscribe(
      (raw) => this.dispatch({ type: "inbound", raw, at: at(raw) }),
      (raws) => this.dispatch({ type: "history", raws, at: now() }),
    );
    return () => {
      this.detachAdapter?.();
      this.detachAdapter = null;
      this.cancelTimers();
    };
  };

  getSnapshot = () => this.snapshot;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  get pendingTimers() {
    return this.timers.size;
  }

  dispatch = (action: Action): string | null => {
    const r = step(this.snapshot.state, action);
    const lastError = action.type === "stage-tick" || action.type === "delivery" || action.type === "view" || action.type === "discard" || action.type === "history" ? this.snapshot.lastError : r.error;
    this.snapshot = { state: r.state, lastError };
    for (const e of r.effects) {
      if (e.kind === "cancel-ticks") this.cancelTimers();
      else if (e.kind === "schedule-tick") {
        const id = setTimeout(() => {
          this.timers.delete(id);
          this.dispatch({ type: "stage-tick", runId: e.runId, caseId: e.caseId, version: e.version, at: now() });
        }, this.stageDelayMs);
        this.timers.add(id);
      } else {
        const eventId = e.envelope.eventId;
        this.adapter.send(e.envelope).then(
          (res) => this.dispatch(!res.ok && res.discard ? { type: "discard", eventId, at: now() } : { type: "delivery", eventId, ok: res.ok, note: res.note, at: now() }),
          (err: unknown) => this.dispatch({ type: "delivery", eventId, ok: false, note: err instanceof Error ? err.message : String(err), at: now() }),
        );
      }
    }
    for (const l of this.listeners) l();
    return r.error;
  };

  review = (caseId: string, version: number, decision: Decision, reason: string, reviewer: string) => this.dispatch({ type: "review", caseId, version, decision, reason, reviewer, at: now() });
  resend = (eventId: string) => this.dispatch({ type: "resend", eventId, at: now() });
  /** Base staff viewed a case (unread counts only; never a confirmation or a close). */
  view = (caseId: string) => this.dispatch({ type: "view", caseId, at: now() });

  private cancelTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
