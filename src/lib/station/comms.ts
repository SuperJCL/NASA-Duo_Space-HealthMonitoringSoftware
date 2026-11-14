// MyoMars base station: COMMUNICATION STREAM of one case (pure, render-neutral, tested).
//
// A structured, time-ordered list, not a chat: the astronaut's report, internal analysis summaries
// (base only, never sent), base decisions (records), action messages (notice, retest task) with
// their separate delivery statuses, HUD receipts, astronaut feedback, retest results and status
// notifications. Statuses only change when the matching message arrived; nothing is inferred.

import { caseMessages, messageKind, type Case, type OutMessage, type StationState } from "./station";
import { hhmmss } from "./flow";

export type CommKind = "report" | "analysis" | "decision" | "action" | "receipt" | "feedback" | "result" | "status";
export const COMM_BADGE: Record<CommKind, string> = {
  report: "宇航员报告 · 模拟",
  analysis: "分析摘要 · 仅基地可见，未发送",
  decision: "基地记录 · 不发送",
  action: "行动消息 · 基地 → 宇航员",
  receipt: "端侧回执 · 模拟",
  feedback: "宇航员反馈 · 模拟",
  result: "复测结果 · 模拟",
  status: "状态通知 · 不是行动",
};
export type CommLine = { label: string; value: string; state: "done" | "pending" | "failed" | "local" };
export type CommItem = { id: string; at: string; kind: CommKind; title: string; text: string; lines: CommLine[] };

const DECISION = { approve: "批准并派发", reject: "驳回建议", close: "关闭事件", "keep-open": "继续关注" } as const;

function deliveryLines(m: OutMessage, mock: boolean): CommLine[] {
  const lines: CommLine[] = [
    { label: "基站已发出", value: m.delivery === "failed" ? `发送失败：${m.deliveryNote ?? ""}` : m.delivery === "queued" ? "发出中" : mock ? `仅本地模拟 · ${hhmmss(m.adapterAt)}` : hhmmss(m.adapterAt), state: m.delivery === "failed" ? "failed" : m.delivery === "queued" ? "pending" : mock ? "local" : "done" },
    { label: "HUD 接收", value: m.hudReceivedAt ? hhmmss(m.hudReceivedAt) : "未收到回执", state: m.hudReceivedAt ? "done" : "pending" },
  ];
  if (messageKind(m.type) === "action") lines.push({ label: "宇航员确认", value: m.feedback === "acknowledged" ? hhmmss(m.feedbackAt) : m.feedback === "deferred" ? `暂缓 · ${hhmmss(m.feedbackAt)}` : "未反馈", state: m.feedback === "acknowledged" ? "done" : m.feedback === "deferred" ? "failed" : "pending" });
  return lines;
}
const text = (m: OutMessage) => {
  const p = m.envelope.payload as { text?: string; instructions?: string; summary?: string };
  return p.text ?? p.instructions ?? p.summary ?? "";
};
const TITLE: Partial<Record<OutMessage["type"], string>> = { "station.notice.approved": "基地已审核提示", "station.retest.requested": "复测任务" };

export function commStream(s: StationState, c: Case, { mock }: { mock: boolean }): CommItem[] {
  const items: CommItem[] = [];
  for (const ev of c.evaluations) {
    if (ev.trigger === "report" && ev.report) items.push({ id: `${ev.version}:report`, at: ev.startedAt, kind: "report", title: "宇航员主动报告", text: `“${ev.report.text}”${ev.report.request ? `\n请求：${ev.report.request}` : ""}`, lines: [] });
    else if (ev.trigger === "retest") items.push({ id: `${ev.version}:result`, at: ev.startedAt, kind: "result", title: "复测结果已接收", text: `标准化模拟测量 · 数据时间 ${hhmmss(ev.observation?.capturedAt ?? null)}；已发出接收回执，开始第 ${ev.version} 轮分析。`, lines: [] });
    else items.push({ id: `${ev.version}:obs`, at: ev.startedAt, kind: "analysis", title: "设备观测已接收", text: `标准化模拟测量 · 数据时间 ${hhmmss(ev.observation?.capturedAt ?? null)}；自动开始模拟分析。`, lines: [] });
    if (ev.completedAt) {
      items.push({
        id: `${ev.version}:done`,
        at: ev.completedAt,
        kind: "analysis",
        title: `第 ${ev.version} 轮${ev.trigger === "report" ? "核查" : "分析"}结论`,
        text: `${ev.result.headline}${ev.result.candidate ? `\n建议候选（未发送）：${ev.result.candidate.title}` : ""}`,
        lines: [],
      });
    }
  }
  c.reviews.forEach((r, i) => items.push({ id: `review:${i}`, at: r.at, kind: "decision", title: `基地决定：${DECISION[r.decision]}（v${r.version}）`, text: `${r.reviewer}：${r.reason}`, lines: [] }));
  for (const m of caseMessages(s, c.caseId)) {
    const kind = messageKind(m.type);
    if (kind === "action") items.push({ id: m.eventId, at: m.envelope.sentAt, kind: "action", title: TITLE[m.type] ?? "行动消息", text: text(m), lines: deliveryLines(m, mock) });
    else if (kind === "status") {
      const st = (m.envelope.payload as { caseStatus?: string }).caseStatus;
      items.push({ id: m.eventId, at: m.envelope.sentAt, kind: "status", title: `最终状态通知：${st === "closed" ? "事件已关闭" : st === "monitoring" ? "继续关注" : (st ?? "")}`, text: text(m), lines: deliveryLines(m, mock).slice(0, 2) });
    } else continue;
    if (m.hudReceivedAt) items.push({ id: `${m.eventId}:recv`, at: m.hudReceivedAt, kind: "receipt", title: `HUD 已接收：${kind === "status" ? "状态通知" : (TITLE[m.type] ?? "")}`, text: "端侧设备收到（不等于宇航员已确认）", lines: [] });
    if (m.feedbackAt && m.feedback !== "none") items.push({ id: `${m.eventId}:fb`, at: m.feedbackAt, kind: "feedback", title: m.feedback === "acknowledged" ? `宇航员已确认：${TITLE[m.type] ?? ""}` : `宇航员暂缓：${TITLE[m.type] ?? ""}`, text: m.feedbackNote ?? (m.feedback === "acknowledged" ? "已在 HUD 上确认" : ""), lines: [] });
  }
  for (const r of c.retests) if (r.completedAt) items.push({ id: `${r.retestId}:completed`, at: r.completedAt, kind: "feedback", title: "宇航员报告已完成复测", text: "等待复测数据（可选扩展消息）", lines: [] });
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
