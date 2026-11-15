"use client";

import type { ReactNode } from "react";
import { OUT_LABEL, type Case, type Decision, type WorkbenchStage } from "@/lib/station/station";
import type { Tone } from "@/lib/station/views";

const TONE: Record<Tone, string> = {
  alert: "border-[#ff6b6b] text-[#ff8f8f]",
  caution: "border-[var(--mg-caution)] text-[var(--mg-caution)]",
  ok: "border-[var(--mg-ok)] text-[var(--mg-ok)]",
  neutral: "border-[var(--mg-line-strong)] text-[var(--mg-dim)]",
};

export const STAGE_TEXT: Record<WorkbenchStage, string> = {
  analysing: "Simulated Analysis in progress",
  review: "Awaiting Base Review",
  dispatched: "Dispatched · awaiting crew feedback",
  reassessing: "Result received · re-evaluating",
  reassessed: "Re-evaluation done · awaiting base decision",
  decided: "Decided",
  closed: "Case Closed",
};
/** Title of the right column for a case (the decided stage is split by its decision). */
export const stageTitle = (c: Case, stage: WorkbenchStage) => (stage === "decided" ? (c.phase === "rejected" ? "Candidate rejected · awaiting base decision" : "Continue Monitoring · case still open") : STAGE_TEXT[stage]);

export const DECISION_TEXT: Record<Decision, string> = { approve: "Approve and send", reject: "Reject", close: "Close case", "keep-open": "Continue Monitoring" };

export const OUT_TEXT = OUT_LABEL;

export const time = (iso: string | null) => {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(11, 19) + " UTC";
};

/** One status, outlined in its tone. Case status and evaluation result each get their own chip. */
export function StatusChip({ tone, children, testId }: { tone: Tone; children: ReactNode; testId?: string }) {
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-[12px] font-medium ${TONE[tone]}`} data-testid={testId} data-tone={tone}>
      {children}
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
