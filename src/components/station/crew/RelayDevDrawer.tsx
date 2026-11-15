"use client";

import { useState } from "react";
import { FIXTURES, type FixtureId } from "@/lib/station/fixtures";
import type { RelayStationAdapter } from "@/lib/station/relay-adapter";
import { devObservation } from "@/lib/station/relay-dev";
import type { StationState } from "@/lib/station/station";

const CHOICES: { id: FixtureId; label: string }[] = [
  { id: "change", label: "可比变化（完整流程）" },
  { id: "normal", label: "正常" },
  { id: "acquisition", label: "采集质量异常" },
  { id: "not-comparable", label: "条件不可比" },
];

/**
 * DEV ENTRY in relay mode: the real Trigger is not connected yet, so the station's development entry
 * publishes ONE simulated standardised measurement into the run the relay currently has (the HUD
 * starts it today), as role "trigger" from a "-dev-trigger" client. No HUD feedback is simulated
 * here: receipts and confirmations only come from the real HUD page.
 */
export function RelayDevDrawer({ relay, state, onClose, onOpenPerson }: { relay: RelayStationAdapter; state: StationState; onClose: () => void; onOpenPerson: (astronautId: string) => void }) {
  const [fixture, setFixture] = useState<FixtureId>("change");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = state.run;
  const inject = async (open: boolean) => {
    const env = devObservation(state, fixture, Date.now());
    if (!env || !run) return;
    setBusy(true);
    if (open) onOpenPerson(run.astronaut.id);
    const r = await relay.publishAsDevTrigger(env);
    setNote(r.note);
    setBusy(false);
  };
  const btn = "min-h-8 rounded-lg border px-2.5 text-[12px] disabled:opacity-40";
  return (
    <aside className="fixed bottom-3 right-3 top-3 z-50 flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto rounded-2xl border-2 border-dashed border-[#d678ff] bg-[rgba(11,17,28,0.97)] p-4 text-[12px] shadow-2xl" aria-label="开发入口（模拟 Trigger）" data-testid="relay-dev-drawer">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[14px] font-semibold text-[#e3a6ff]">{"开发入口 · 模拟 Trigger"}</p>
          <p className="text-[11px] text-[var(--mg-dim)]">{"真实 Trigger 尚未接入。这里以 Trigger 角色向通信服务发布一次模拟的标准化测量（标注为 dev-trigger）。"}</p>
        </div>
        <button type="button" onClick={onClose} className="underline" data-testid="relay-dev-close">
          {"隐藏"}
        </button>
      </div>
      {run ? (
        <p className="text-[var(--mg-text)]" data-testid="relay-dev-run">{`当前运行：${run.astronaut.callsign} · ${run.task.title}（运行 ${run.runId}）`}</p>
      ) : (
        <p className="text-[var(--mg-caution)]" data-testid="relay-dev-norun">{"等待运行开始：请在 HUD 页面选择一个场景（HUD 以本地设备身份开始运行）。"}</p>
      )}
      <label className="flex items-center gap-2">
        {"测量"}
        <select value={fixture} onChange={(e) => setFixture(e.target.value as FixtureId)} className="flex-1 rounded-md border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1" data-testid="relay-dev-fixture">
          {CHOICES.map((c) => (
            <option key={c.id} value={c.id}>
              {`${c.label} · ${FIXTURES[c.id].observation.protocol.label}`}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={!run || busy} onClick={() => void inject(true)} className={`${btn} border-[#d678ff] text-[#e3a6ff]`} data-testid="relay-dev-inject-open">
          {"注入并打开面板"}
        </button>
        <button type="button" disabled={!run || busy} onClick={() => void inject(false)} className={`${btn} border-[var(--mg-line-strong)]`} data-testid="relay-dev-inject">
          {"只注入"}
        </button>
      </div>
      {note ? (
        <p className="text-[var(--mg-cyan)]" data-testid="relay-dev-note">
          {note}
        </p>
      ) : null}
      <p className="text-[11px] text-[var(--mg-faint)]">{"联调模式下没有自动或手动的模拟 HUD 反馈：接收回执和宇航员确认只来自真实 HUD 页面。"}</p>
    </aside>
  );
}
