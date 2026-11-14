"use client";

import { useState } from "react";
import { caseLabel, DEMO_SCENARIOS, demoTargetCase, HUD_INPUTS, hudInput, type DemoDirector, type DemoScenario, type DemoSnapshot, type HudInput } from "@/lib/station/demo";
import { DEMO_CREW } from "@/lib/station/fixtures";
import type { StationState } from "@/lib/station/station";

/**
 * LOCAL DEMO drawer (not the Trigger, not the HUD). Every input it sends is simulated and labelled
 * so; base staff decisions are never made here. Pausing the replay is a demo state and is NOT a
 * device disconnect (that is a separate, simulated device status).
 */
export function DemoDrawer({ director, snap, state, now, onClose, onLaunched, onPlayExample }: { director: DemoDirector; snap: DemoSnapshot; state: StationState; now: number; onClose: () => void; onLaunched: () => void; onPlayExample: (astronautId: string, scenario: DemoScenario) => void }) {
  const [astro, setAstro] = useState("ev1");
  const [scenario, setScenario] = useState<DemoScenario>("change");
  const [note, setNote] = useState<string | null>(null);
  const target = demoTargetCase(state, astro);
  const member = state.crew[astro];
  const due = snap.pending?.dueAt && now ? Math.max(0, Math.ceil((snap.pending.dueAt - now) / 1000)) : null;
  const btn = "min-h-8 rounded-lg border border-[var(--mg-line-strong)] px-2.5 text-[12px] disabled:opacity-40";
  return (
    <aside className="fixed bottom-3 right-3 top-3 z-50 flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto rounded-2xl border-2 border-dashed border-[#d678ff] bg-[rgba(11,17,28,0.97)] p-4 text-[12px] shadow-2xl" aria-label="本地模拟演示" data-testid="demo-drawer">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[14px] font-semibold text-[#e3a6ff]">{"本地模拟演示"}</p>
          <p className="text-[11px] text-[var(--mg-dim)]">{"扮演 Trigger / HUD 发送模拟输入，仅用于本地演示；不是真实三端联通。基地决定仍需人工完成。"}</p>
        </div>
        <button type="button" onClick={onClose} className="underline" data-testid="demo-close">
          {"隐藏"}
        </button>
      </div>

      <section className="flex flex-col gap-2 rounded-xl border border-[#d678ff] p-2.5">
        <p className="font-semibold">{"打开面板并播放示例（从头开始，会重置当前演示）"}</p>
        <div className="flex flex-col gap-1.5">
          <button type="button" className={`${btn} border-[#d678ff] text-left`} onClick={() => onPlayExample("ev1", "change")} data-testid="demo-example-normal">
            {"▶ 正常路径：EV1 · 可比变化 → 等待基地审核"}
          </button>
          <button type="button" className={`${btn} border-[#d678ff] text-left`} onClick={() => onPlayExample("ev1", "acquisition")} data-testid="demo-example-quality">
            {"▶ 质量不合格路径：EV1 · 采集质量异常 → 检查设备/重新测量"}
          </button>
        </div>
        <p className="text-[11px] text-[var(--mg-faint)]">{"先打开个人面板，再由模拟 Trigger 发送数据，所以能从第一步看到数据流动。"}</p>
      </section>

      <section className="flex flex-col gap-2">
        <p className="font-semibold">{"① 场景"}</p>
        <label className="flex items-center gap-2">
          {"模拟宇航员"}
          <select value={astro} onChange={(e) => setAstro(e.target.value)} className="flex-1 rounded-md border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1" data-testid="demo-astronaut">
            {DEMO_CREW.map((m) => (
              <option key={m.astronautId} value={m.astronautId}>
                {m.callsign}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          {"场景"}
          <select value={scenario} onChange={(e) => setScenario(e.target.value as DemoScenario)} className="flex-1 rounded-md border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1" data-testid="demo-scenario">
            {(Object.keys(DEMO_SCENARIOS) as DemoScenario[]).map((k) => (
              <option key={k} value={k}>
                {DEMO_SCENARIOS[k].label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`${btn} border-[#d678ff]`}
            onClick={() => {
              director.launch(astro, scenario);
              onLaunched();
            }}
            data-testid="demo-launch"
          >
            {"启动"}
          </button>
          <button type="button" className={btn} onClick={() => director.setPaused(!snap.paused)} data-testid="demo-pause">
            {snap.paused ? "继续回放" : "暂停回放"}
          </button>
          <button type="button" className={btn} disabled={!snap.pending} onClick={director.stepNow} data-testid="demo-step">
            {"立即发送下一条"}
          </button>
          <button type="button" className={btn} disabled={!state.run} onClick={director.reset} data-testid="demo-reset">
            {"重置"}
          </button>
        </div>
        <p className="text-[var(--mg-dim)]" data-testid="demo-pending">
          {snap.pending ? `下一条模拟输入：${snap.pending.label}${snap.paused ? "（回放已暂停）" : due !== null ? `（约 ${due} 秒后）` : ""}` : snap.paused ? "回放已暂停：暂无待发送的模拟输入" : "暂无待发送的模拟输入"}
        </p>
        <p className="text-[11px] text-[var(--mg-faint)]">{"暂停回放只暂停演示输入；基站对已收到数据的处理照常进行。暂停不是设备断线。"}</p>
      </section>

      <section className="flex flex-col gap-2">
        <p className="font-semibold">{"② 手动注入 HUD 反馈（模拟）"}</p>
        <p className="text-[var(--mg-dim)]">{target ? `对象：${member?.callsign ?? astro} · ${caseLabel(state, target)}` : "该宇航员暂无事件"}</p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(HUD_INPUTS) as HudInput[]).map((k) => (
            <button
              key={k}
              type="button"
              className={btn}
              disabled={!target || !hudInput(state, target, k, now || 0)}
              onClick={() => target && setNote(director.hud(target, k) ? `已注入（模拟）：${HUD_INPUTS[k]}` : "没有可对应的已发送消息")}
              data-testid={`demo-hud-${k}`}
            >
              {HUD_INPUTS[k]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[var(--mg-faint)]">{"只对基站已经发出的消息生效：未经基地批准的内容不存在，也就无法伪造回执。"}</p>
        {note ? <p className="text-[var(--mg-cyan)]">{note}</p> : null}
        <button type="button" className={btn} disabled={!member} onClick={() => director.toggleDevice(astro)} data-testid="demo-device">
          {member?.connection === "disconnected" ? "模拟设备恢复连接" : "模拟设备断线"}
        </button>
      </section>

      <section className="flex flex-col gap-1.5">
        <p className="font-semibold">{"③ 自动模拟 HUD 反馈"}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={snap.autoHud} onChange={(e) => director.setAutoHud(e.target.checked)} data-testid="demo-auto" />
          {"开启（默认关闭）"}
        </label>
        <p className="text-[11px] text-[var(--mg-faint)]">{"开启后，模拟 HUD 会对已发出的消息依次回传接收、确认和一次正常复测结果。仍必须由基地人员批准；所有回执都标注为模拟。"}</p>
      </section>

      <p className="mt-auto text-[11px] text-[var(--mg-faint)]">{"高级开发调试入口默认隐藏：在地址后加 ?dev=1。"}</p>
    </aside>
  );
}

/** Compact demo control bar shown after a start: it stays out of the way of the canvas. */
export function DemoBar({ director, snap, state, now, onExpand }: { director: DemoDirector; snap: DemoSnapshot; state: StationState; now: number; onExpand: () => void }) {
  const due = snap.pending?.dueAt && now ? Math.max(0, Math.ceil((snap.pending.dueAt - now) / 1000)) : null;
  const btn = "min-h-7 rounded-md border border-[var(--mg-line-strong)] px-2 text-[12px] disabled:opacity-40";
  return (
    <div className="fixed bottom-2 left-1/2 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-2 rounded-full border-2 border-dashed border-[#d678ff] bg-[rgba(11,17,28,0.97)] px-3 py-1 text-[12px] shadow-2xl" role="region" aria-label="本地模拟演示控制条" data-testid="demo-bar">
      <span className="font-semibold text-[#e3a6ff]">{"本地模拟"}</span>
      <span className="max-w-[24rem] truncate text-[var(--mg-dim)]" data-testid="demo-bar-pending">
        {snap.pending ? `${snap.paused ? "已暂停 · " : ""}下一条：${snap.pending.label}${!snap.paused && due !== null ? `（${due} 秒）` : ""}` : snap.paused ? "回放已暂停" : "无待发送的模拟输入"}
      </span>
      <button type="button" className={btn} onClick={() => director.setPaused(!snap.paused)} data-testid="demo-bar-pause">
        {snap.paused ? "继续" : "暂停"}
      </button>
      <button type="button" className={btn} disabled={!snap.pending} onClick={director.stepNow} data-testid="demo-bar-step">
        {"下一条"}
      </button>
      <button type="button" className={btn} disabled={!state.run} onClick={director.reset} data-testid="demo-bar-reset">
        {"重置"}
      </button>
      <button type="button" className={`${btn} border-[#d678ff] text-[#e3a6ff]`} onClick={onExpand} data-testid="demo-bar-expand">
        {"展开（HUD 反馈等）"}
      </button>
    </div>
  );
}
