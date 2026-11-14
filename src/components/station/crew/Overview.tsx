"use client";

import type { CrewCardView, Notice } from "@/lib/station/crew";
import { hhmmss } from "@/lib/station/flow";
import type { Tone } from "@/lib/station/views";
import { duration, useOnceAnimation } from "./motion";

export const TONE_TEXT: Record<Tone, string> = { alert: "text-[#ff9f8a]", caution: "text-[var(--mg-caution)]", ok: "text-[var(--mg-ok)]", neutral: "text-[var(--mg-dim)]" };
export const TONE_BORDER: Record<Tone, string> = { alert: "border-[var(--mg-coral)]", caution: "border-[var(--mg-caution)]", ok: "border-[var(--mg-ok)]", neutral: "border-[var(--mg-line-strong)]" };

const PULSE: Keyframe[] = [{ boxShadow: "0 0 0 0 rgba(255,128,102,0)" }, { boxShadow: "0 0 0 6px rgba(255,128,102,0.55)" }, { boxShadow: "0 0 0 0 rgba(255,128,102,0)" }];
const PULSE_OPTS: KeyframeAnimationOptions = { duration: 1400, easing: "ease-out" };

const CONN = { connected: { dot: "bg-[var(--mg-ok)]", label: "设备" }, disconnected: { dot: "bg-[#ff6b6b]", label: "设备" }, unknown: { dot: "bg-[var(--mg-faint)]", label: "设备" } } as const;
const VALIDITY_TONE = { valid: "text-[var(--mg-text)]", invalid: "text-[var(--mg-caution)]", checking: "text-[var(--mg-cyan)]", none: "text-[var(--mg-faint)]" } as const;

/** One crew member: identity and task, then device / data / event as three separate statements. */
export function CrewCard({ card, now, onOpen }: { card: CrewCardView; now: number; onOpen: () => void }) {
  // Short border pulse when a NEW message for this astronaut is accepted; a stable marker stays.
  const ref = useOnceAnimation<HTMLButtonElement>(card.latestInbound?.eventId ?? null, PULSE, PULSE_OPTS);
  const ev = card.event;
  const attention = !!ev && !ev.closed && ev.needsBase && ev.tone === "alert";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      data-crew-card={card.astronautId}
      data-testid={`crew-card-${card.astronautId}`}
      data-unread={card.unread}
      data-connection={card.connection.state}
      data-validity={card.data.validity}
      data-needs-base={attention ? "yes" : "no"}
      aria-label={`${card.callsign}：${ev ? ev.text : "暂无事件"}${card.unread ? `，${card.unread} 条未读` : ""}。打开个人分析与通信面板`}
      className={`mg-glass flex w-full flex-col gap-3 rounded-2xl border-2 p-4 text-left transition-colors hover:border-[var(--mg-line-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--mg-cyan)] ${attention ? "border-[var(--mg-coral)]" : "border-transparent"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[17px] font-semibold">{card.callsign}</p>
          <p className="text-[13px] text-[var(--mg-dim)]">{card.task}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-[var(--mg-faint)]">{"任务时长"}</p>
          <p className="text-[13px] tabular-nums">{duration(card.evaStartedAt, now)}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1 text-[13px]">
        <dt className="text-[var(--mg-faint)]">{CONN[card.connection.state].label}</dt>
        <dd className="flex items-center gap-1.5" data-testid="crew-card-connection">
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${CONN[card.connection.state].dot}`} />
          {card.connection.text}
        </dd>
        <dt className="text-[var(--mg-faint)]">{"数据"}</dt>
        <dd className={VALIDITY_TONE[card.data.validity]} data-testid="crew-card-data">
          {`${card.data.text} · ${card.data.summary}`}
        </dd>
        <dt className="text-[var(--mg-faint)]">{"事件"}</dt>
        <dd data-testid="crew-card-event">
          {ev ? (
            <span className={`inline-flex flex-wrap items-center gap-1.5 ${TONE_TEXT[ev.tone]}`}>
              <span className={`rounded-md border px-1.5 py-0.5 text-[12px] font-medium ${TONE_BORDER[ev.tone]}`}>{ev.text}</span>
              <span className="text-[11px] text-[var(--mg-faint)]">{ev.source}</span>
            </span>
          ) : (
            <span className="text-[var(--mg-faint)]">{"暂无事件"}</span>
          )}
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--mg-dim)]">
        <span>{`未关闭事件 ${card.openCases}`}</span>
        <span aria-hidden>·</span>
        <span>{`需基地处理 ${card.needsBase}`}</span>
        {card.unread ? (
          <span className="ml-auto rounded-full bg-[var(--mg-coral)] px-2 py-0.5 text-[12px] font-semibold text-[#1a0f0c]" data-testid="crew-card-unread">
            {`未读 ${card.unread}`}
          </span>
        ) : (
          <span className="ml-auto text-[var(--mg-faint)]">{"未读 0"}</span>
        )}
      </div>
    </button>
  );
}

/** Clickable notifications for unread messages (no sound, no flashing, no automatic opening). */
export function NotificationBar({ notes, onOpen, compact = false }: { notes: Notice[]; onOpen: (astronautId: string, caseId: string) => void; compact?: boolean }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap gap-2" data-testid={compact ? "panel-other-notices" : "crew-notices"}>
      {notes.slice(0, 3).map((n) => (
        <button
          key={n.astronautId}
          type="button"
          onClick={() => onOpen(n.astronautId, n.caseId)}
          className={`flex items-center gap-2 rounded-full border border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] px-3 py-1 text-[12px] ${compact ? "" : "text-[13px]"}`}
          data-testid={`${compact ? "panel-notice" : "crew-notice"}-${n.astronautId}`}
        >
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--mg-coral)]" />
          <span className="font-semibold">{n.callsign}</span>
          <span>{n.text}</span>
          <span className="text-[var(--mg-faint)]">{hhmmss(n.at).slice(0, 5)}</span>
          {n.count > 1 ? <span className="text-[var(--mg-dim)]">{`（${n.count} 条未读）`}</span> : null}
        </button>
      ))}
    </div>
  );
}
