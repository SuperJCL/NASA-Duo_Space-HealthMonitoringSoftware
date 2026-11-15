"use client";

import { useState } from "react";
import { intakeCheck, observationEnvelope, REPLAY_SAMPLES, sampleById, startEnvelope, type CheckStatus } from "@/lib/replay/replay";
import type { RelayStationAdapter } from "@/lib/station/relay-adapter";
import type { StationState } from "@/lib/station/station";

const MARK: Record<CheckStatus, { t: string; c: string }> = {
  ok: { t: "✓", c: "text-[var(--mg-dim)]" },
  assumed: { t: "假设", c: "text-[var(--mg-caution)]" },
  missing: { t: "缺失", c: "text-[var(--mg-caution)]" },
  blocked: { t: "阻止", c: "text-[var(--mg-coral)]" },
};

/**
 * DEV ENTRY in relay mode: the station page as one entry point of the DATA REPLAY module
 * (src/lib/replay; the other is `npm run replay`). It starts a run and publishes stored SIMULATED
 * samples as the data producer (contract role "trigger", client "-replay"). No product page, no HUD
 * feedback: receipts and confirmations only come from the real HUD page.
 */
export function RelayDevDrawer({ relay, state, onClose, onOpenPerson }: { relay: RelayStationAdapter; state: StationState; onClose: () => void; onOpenPerson: (astronautId: string) => void }) {
  const [sampleId, setSampleId] = useState(REPLAY_SAMPLES[0].id);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = state.run;
  const sample = sampleById(sampleId) ?? REPLAY_SAMPLES[0];
  const runInfo = run ? { runId: run.runId, astronaut: run.astronaut, task: run.task } : null;
  const check = intakeCheck(sample, runInfo, "回放时刻");
  const go = async (fn: () => Promise<{ note: string }>) => {
    setBusy(true);
    setNote((await fn()).note);
    setBusy(false);
  };
  const start = () => go(() => relay.publishAsReplay(startEnvelope(state.sessionId, Date.now())));
  const inject = (open: boolean) =>
    go(async () => {
      if (!runInfo || !check.publishable) return { note: "不能回放：见核查项" };
      if (open) onOpenPerson(runInfo.astronaut.id);
      return relay.publishAsReplay(observationEnvelope(state.sessionId, runInfo, sample, Date.now()));
    });
  const btn = "min-h-8 rounded-lg border px-2.5 text-[12px] disabled:opacity-40";
  return (
    <aside className="fixed bottom-3 right-3 top-3 z-50 flex w-[24rem] max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto rounded-2xl border-2 border-dashed border-[#d678ff] bg-[rgba(11,17,28,0.97)] p-4 text-[12px] shadow-2xl" aria-label="开发入口（数据回放）" data-testid="relay-dev-drawer">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[14px] font-semibold text-[#e3a6ff]">{"开发入口 · 数据回放（模拟样例）"}</p>
          <p className="text-[11px] text-[var(--mg-dim)]">{"以数据生产者身份（契约角色 trigger）向通信服务发布已存储的模拟样例。不是队友的健康数据；命令行 npm run replay 是同一模块。"}</p>
        </div>
        <button type="button" onClick={onClose} className="underline" data-testid="relay-dev-close">
          {"隐藏"}
        </button>
      </div>
      {run ? (
        <p className="text-[var(--mg-text)]" data-testid="relay-dev-run">{`当前运行：${run.astronaut.callsign} · ${run.task.title}（运行 ${run.runId}）`}</p>
      ) : (
        <p className="text-[var(--mg-caution)]" data-testid="relay-dev-norun">{"没有进行中的运行。先开始一个运行（HUD 以集成模式加入）。"}</p>
      )}
      <button type="button" disabled={busy} onClick={() => void start()} className={`${btn} self-start border-[var(--mg-line-strong)]`} data-testid="relay-dev-start">
        {run ? "开始新运行（结束当前运行）" : "开始运行（A-02）"}
      </button>
      <label className="flex items-center gap-2">
        {"样例"}
        <select value={sampleId} onChange={(e) => setSampleId(e.target.value)} className="flex-1 rounded-md border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1" data-testid="relay-dev-fixture">
          {REPLAY_SAMPLES.map((s) => (
            <option key={s.id} value={s.id}>
              {`${s.label} · ${s.observation.protocol.label}`}
            </option>
          ))}
        </select>
      </label>
      <ul className="grid gap-1 rounded-lg border border-[var(--mg-line)] p-2 text-[11px]" data-testid="relay-dev-check">
        <li className="text-[var(--mg-dim)]">{`来源：${sample.source.label}`}</li>
        {check.items
          .filter((i) => i.item !== "来源")
          .map((i) => (
            <li key={i.item} className="flex gap-2" data-status={i.status}>
              <span className={`w-8 shrink-0 ${MARK[i.status].c}`}>{MARK[i.status].t}</span>
              <span>
                <b className="font-medium">{i.item}</b>
                {`：${i.detail}`}
              </span>
            </li>
          ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={!run || busy || !check.publishable} onClick={() => void inject(true)} className={`${btn} border-[#d678ff] text-[#e3a6ff]`} data-testid="relay-dev-inject-open">
          {"回放并打开面板"}
        </button>
        <button type="button" disabled={!run || busy || !check.publishable} onClick={() => void inject(false)} className={`${btn} border-[var(--mg-line-strong)]`} data-testid="relay-dev-inject">
          {"只回放"}
        </button>
      </div>
      {note ? (
        <p className="text-[var(--mg-cyan)]" data-testid="relay-dev-note">
          {note}
        </p>
      ) : null}
      <p className="text-[11px] text-[var(--mg-faint)]">{"联调模式下没有自动或手动的模拟 HUD 反馈：接收回执、宇航员确认和复测结果只来自真实 HUD 页面。"}</p>
    </aside>
  );
}
