"use client";

import type { ReactNode } from "react";
import type { AlertLevel, Case, Decision, OutMessage, WorkbenchStage } from "@/lib/station/station";

export const ALERT: Record<AlertLevel, { text: string; cls: string }> = {
  none: { text: "无告警", cls: "border-[var(--mg-line-strong)] text-[var(--mg-dim)]" },
  watch: { text: "关注", cls: "border-[var(--mg-caution)] text-[var(--mg-caution)]" },
  alert: { text: "告警", cls: "border-[#ff6b6b] text-[#ff8f8f]" },
};

export const STAGE_TEXT: Record<WorkbenchStage, string> = {
  analysing: "模拟分析中",
  review: "待审核",
  dispatched: "已派发 · 等待宇航员反馈",
  reassessing: "结果已接收 · 重评中",
  reassessed: "重评完成 · 等待人工处理",
  decided: "已决定 · 保留关注",
  closed: "已关闭",
};

export const PHASE_SHORT: Record<Case["phase"], string> = {
  analysing: "分析中",
  "awaiting-review": "待审核",
  "on-hold": "保留复核",
  "awaiting-hud": "等待 HUD",
  "awaiting-retest": "等待复测",
  deferred: "宇航员暂缓",
  rejected: "已驳回",
  monitoring: "保留关注",
  closed: "已关闭",
};

export const DECISION_TEXT: Record<Decision, string> = { approve: "批准并发送", reject: "驳回", hold: "保留复核", close: "关闭事件", "keep-open": "保留关注" };

export const OUT_TEXT: Record<OutMessage["type"], string> = {
  "station.notice.approved": "已审核提示",
  "station.retest.requested": "复测任务",
  "station.receipt": "结果接收回执",
  "station.reassessment": "重评结果",
};

export const time = (iso: string | null) => {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(11, 19) + " UTC";
};

export function AlertBadge({ level, testId }: { level: AlertLevel; testId?: string }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[12px] font-semibold ${ALERT[level].cls}`} data-testid={testId}>
      {ALERT[level].text}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--mg-faint)]">{children}</p>;
}

/** Collapsible secondary block (closed by default unless `open`). */
export function Fold({ title, children, testId, open = false }: { title: string; children: ReactNode; testId: string; open?: boolean }) {
  return (
    <details open={open} className="rounded-xl border border-[var(--mg-line)] px-3 py-2" data-testid={testId}>
      <summary className="cursor-pointer text-[13px] font-medium text-[var(--mg-dim)]">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
