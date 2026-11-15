"use client";

// The case's EVENT CHAIN, always visible at the top of the Health Monitoring overlay:
// Data source → Base analysis → Base review → HUD → Crew response → Retest → Reassessment, plus the
// closure as two separate facts (case closed / closing notice delivered). States come from
// eventChain() (recorded case + outbox). A short marker animation plays once for each NEW event
// (observation arrived, analysis finished, messages sent, HUD receipt, crew reply, retest result);
// nothing moves while the chain waits for a person or a device, and nothing here changes state.

import { useEffect, useRef, type ReactNode } from "react";
import { CHAIN_IDS, type ChainId, type ChainNode, type ChainState, type EventChain } from "@/lib/station/event-chain";
import { hhmmss } from "@/lib/station/flow";
import { elapsed, prefersReducedMotion } from "./motion";

export const CHAIN_ICON: Record<ChainState, string> = { done: "✓", running: "◐", human: "●", waiting: "◷", stopped: "■", failed: "!", todo: "○", skipped: "–" };
export const CHAIN_WORD: Record<ChainState, string> = { done: "Done", running: "Processing", human: "Base decision needed", waiting: "Waiting", stopped: "Stopped", failed: "Failed", todo: "Not reached", skipped: "Not needed" };
const STYLE: Record<ChainState, string> = {
  done: "border-[var(--mg-ok)]/70 bg-[var(--mg-bg)] text-[var(--mg-text)]",
  running: "border-[var(--mg-cyan)] bg-[var(--mg-cyan-soft)] text-[var(--mg-text)]",
  human: "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] text-[var(--mg-text)]",
  waiting: "border-dashed border-[var(--mg-cyan)] bg-[var(--mg-bg)] text-[var(--mg-text)]",
  stopped: "border-[var(--mg-caution)] bg-[rgba(241,200,120,0.1)] text-[var(--mg-text)]",
  failed: "border-[#ff6b6b] bg-[rgba(255,107,107,0.12)] text-[var(--mg-text)]",
  todo: "border-dashed border-[var(--mg-line)] bg-[var(--mg-bg)] text-[var(--mg-faint)]",
  skipped: "border-dashed border-[var(--mg-line)] bg-transparent text-[var(--mg-faint)] opacity-70",
};
const ICON_TONE: Record<ChainState, string> = { done: "text-[var(--mg-ok)]", running: "text-[var(--mg-cyan)]", human: "text-[var(--mg-coral)]", waiting: "text-[var(--mg-cyan)]", stopped: "text-[var(--mg-caution)]", failed: "text-[#ff8f8f]", todo: "", skipped: "" };
const MARK: Record<"data" | "send" | "feedback", string> = { data: "var(--mg-cyan)", send: "var(--mg-coral)", feedback: "var(--mg-ok)" };
const NOTICE_TEXT = { none: "not sent", sending: "sending…", sent: "relay accepted · awaiting HUD receipt", received: "Received by HUD", failed: "send failed" } as const;

/** Events already animated (module level: a remount or a reopened overlay never replays them). */
const played = new Set<string>();

export function EventChainPanel({ chain, caseKey, now, selected, onSelect, aside }: { chain: EventChain; caseKey: string; now: number; selected: ChainId | null; onSelect: (id: ChainId) => void; aside?: ReactNode }) {
  const markRef = useRef<HTMLSpanElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const keys = chain.events.map((e) => e.key).join("|");
  useEffect(() => {
    const el = markRef.current;
    const first = seen.current === null;
    if (first) seen.current = new Set();
    // New events only: ones that appeared while this panel was shown, or (on first render) that just happened.
    const fresh = chain.events.filter((e) => !played.has(e.key) && !seen.current!.has(e.key) && (!first || Date.now() - Date.parse(e.at) < 4000));
    for (const e of chain.events) seen.current!.add(e.key);
    if (!el || !fresh.length || prefersReducedMotion() || typeof el.animate !== "function") {
      for (const e of fresh) played.add(e.key);
      return;
    }
    const x = (i: number) => `${((i + 0.5) / CHAIN_IDS.length) * 100}%`;
    const anims = fresh.map((e, i) => {
      played.add(e.key);
      el.style.background = MARK[e.kind];
      return el.animate(
        [
          { left: x(e.from), opacity: 0, background: MARK[e.kind] },
          { left: x(e.from), opacity: 1, offset: 0.12 },
          { left: x(e.to), opacity: 1, offset: 0.85 },
          { left: x(e.to), opacity: 0, background: MARK[e.kind] },
        ],
        { duration: 650 + 150 * Math.abs(e.to - e.from), delay: i * 750, easing: "ease-in-out", fill: "none" },
      );
    });
    return () => anims.forEach((a) => a.cancel());
    // keys captures the events of this chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  const cur = chain.nodes.find((n) => n.id === chain.current) ?? null;
  const { caseClosed, notice } = chain.closure;
  return (
    <section className="rounded-xl border border-[var(--mg-line)] bg-[var(--mg-bg)] p-3" aria-label="Case event chain" data-testid="event-chain" data-current={chain.current ?? ""} data-case={caseKey}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold">{"Case events"}</h3>
        <span className="text-[11px] text-[var(--mg-faint)]">{"click a step for its evidence and messages"}</span>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>
      <div className="relative">
        <ol className="grid grid-cols-7 gap-1.5">
          {chain.nodes.map((n, i) => (
            <li key={n.id} className="relative flex min-w-0">
              {i > 0 ? <span aria-hidden className={`absolute -left-1.5 top-5 h-0.5 w-1.5 ${n.state === "todo" || n.state === "skipped" ? "bg-[var(--mg-line)]" : "bg-[var(--mg-cyan)]"}`} /> : null}
              <ChainButton n={n} selected={selected === n.id} current={chain.current === n.id} onClick={() => onSelect(n.id)} />
            </li>
          ))}
        </ol>
        <span ref={markRef} aria-hidden className="pointer-events-none absolute -top-1.5 h-3 w-3 -translate-x-1/2 rounded-full opacity-0 shadow-[0_0_10px_currentColor]" style={{ left: "0%" }} data-testid="event-marker" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className={`rounded-md border px-2 py-0.5 ${caseClosed ? "border-[var(--mg-ok)] text-[var(--mg-ok)]" : "border-[var(--mg-line-strong)] text-[var(--mg-dim)]"}`} data-testid="chain-closure-case" data-state={caseClosed ? "closed" : "open"}>
          {caseClosed ? `✓ Case Closed · ${hhmmss(caseClosed.at).slice(0, 5)} · ${caseClosed.by}` : "Case open"}
        </span>
        <span className={`rounded-md border px-2 py-0.5 ${notice.state === "received" ? "border-[var(--mg-ok)] text-[var(--mg-ok)]" : notice.state === "failed" ? "border-[#ff6b6b] text-[#ff8f8f]" : notice.state === "none" ? "border-[var(--mg-line)] text-[var(--mg-faint)]" : "border-dashed border-[var(--mg-cyan)] text-[var(--mg-cyan)]"}`} data-testid="chain-closure-notice" data-state={notice.state}>
          {`Closing notice: ${NOTICE_TEXT[notice.state]}${notice.state === "received" && notice.at ? ` · ${hhmmss(notice.at).slice(0, 5)}` : ""}`}
        </span>
        <span className="ml-auto text-[var(--mg-dim)]" data-testid="chain-now">
          {cur ? nowLine(cur, now) : caseClosed ? (notice.state === "received" ? "Handling complete · nothing is waiting" : "Case Closed · waiting only for the closing-notice receipt") : "Nothing is waiting"}
        </span>
      </div>
    </section>
  );
}

/** What the chain is doing now, in one line (who is awaited, since when). Never animated. */
function nowLine(n: ChainNode, now: number): string {
  const since = n.since ? ` · since ${hhmmss(n.since).slice(0, 8)} · ${elapsed(n.since, now)}` : "";
  if (n.state === "running") return `Processing: ${n.label} · ${n.summary}`;
  if (n.state === "failed") return `${n.label}: ${n.summary} · base staff can resend`;
  return `Paused · waiting for ${n.waitingFor ?? "a reply"} (${n.label})${since}`;
}

function ChainButton({ n, selected, current, onClick }: { n: ChainNode; selected: boolean; current: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-current={current ? "step" : undefined}
      aria-label={`${n.label}: ${CHAIN_WORD[n.state]}. ${n.summary}`}
      title={`${n.label} · ${CHAIN_WORD[n.state]}\n${n.summary}`}
      className={`flex w-full min-w-0 flex-col items-start rounded-lg border px-1.5 py-1.5 text-left ${STYLE[n.state]} ${selected ? "ring-2 ring-[var(--mg-cyan)]" : ""}`}
      data-testid={`step-${n.id}`}
      data-state={n.state}
    >
      {/* Label on its own line (no icon beside it), so "Reassessment" never breaks inside the word. */}
      <span className="w-full text-[12px] font-semibold leading-tight">{n.label}</span>
      <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug opacity-90">
        <span aria-hidden className={`mr-1 font-semibold ${ICON_TONE[n.state]}`}>
          {CHAIN_ICON[n.state]}
        </span>
        <span data-testid={`step-${n.id}-summary`}>{n.summary}</span>
      </span>
    </button>
  );
}
