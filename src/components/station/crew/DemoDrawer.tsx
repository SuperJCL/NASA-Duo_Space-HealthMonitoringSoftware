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
    <aside className="fixed bottom-3 right-3 top-3 z-50 flex w-[24rem] max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto rounded-2xl border-2 border-dashed border-[#d678ff] bg-[rgba(11,17,28,0.97)] p-4 text-[12px] shadow-2xl" aria-label="Local simulated demo" data-testid="demo-drawer">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[14px] font-semibold text-[#e3a6ff]">{"Local simulated demo"}</p>
          <p className="text-[11px] text-[var(--mg-dim)]">{"Plays the data source / HUD and sends simulated inputs, for the local demo only; no real HUD is connected. Base decisions are still made by people."}</p>
        </div>
        <button type="button" onClick={onClose} className="underline" data-testid="demo-close">
          {"Hide"}
        </button>
      </div>

      <section className="flex flex-col gap-2 rounded-xl border border-[#d678ff] p-2.5">
        <p className="font-semibold">{"Open the panel and play an example (starts over and resets the current demo)"}</p>
        <div className="flex flex-col gap-1.5">
          <button type="button" className={`${btn} border-[#d678ff] text-left`} onClick={() => onPlayExample("ev1", "change")} data-testid="demo-example-normal">
            {"▶ Normal path: EV1 · comparable change → Awaiting Base Review"}
          </button>
          <button type="button" className={`${btn} border-[#d678ff] text-left`} onClick={() => onPlayExample("ev1", "acquisition")} data-testid="demo-example-quality">
            {"▶ Quality-failure path: EV1 · signal quality failed → check device / remeasure"}
          </button>
        </div>
        <p className="text-[11px] text-[var(--mg-faint)]">{"The person panel opens first, then the simulated data source sends data, so the data flow is visible from the first step."}</p>
      </section>

      <section className="flex flex-col gap-2">
        <p className="font-semibold">{"① Scenario"}</p>
        <label className="flex items-center gap-2">
          {"Simulated astronaut"}
          <select value={astro} onChange={(e) => setAstro(e.target.value)} className="flex-1 rounded-md border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1" data-testid="demo-astronaut">
            {DEMO_CREW.map((m) => (
              <option key={m.astronautId} value={m.astronautId}>
                {m.callsign}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          {"Scenario"}
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
            {"Start"}
          </button>
          <button type="button" className={btn} onClick={() => director.setPaused(!snap.paused)} data-testid="demo-pause">
            {snap.paused ? "Resume replay" : "Pause replay"}
          </button>
          <button type="button" className={btn} disabled={!snap.pending} onClick={director.stepNow} data-testid="demo-step">
            {"Send next now"}
          </button>
          <button type="button" className={btn} disabled={!state.run} onClick={director.reset} data-testid="demo-reset">
            {"Reset"}
          </button>
        </div>
        <p className="text-[var(--mg-dim)]" data-testid="demo-pending">
          {snap.pending ? `Next simulated input: ${snap.pending.label}${snap.paused ? " (replay paused)" : due !== null ? ` (in about ${due} s)` : ""}` : snap.paused ? "Replay paused: no simulated input pending" : "No simulated input pending"}
        </p>
        <p className="text-[11px] text-[var(--mg-faint)]">{"Pausing the replay only pauses the demo inputs; the base keeps processing data it has already received. A pause is not a device disconnect."}</p>
      </section>

      <section className="flex flex-col gap-2">
        <p className="font-semibold">{"② Inject HUD feedback manually (simulated)"}</p>
        <p className="text-[var(--mg-dim)]">{target ? `Target: ${member?.callsign ?? astro} · ${caseLabel(state, target)}` : "No case for this astronaut yet"}</p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(HUD_INPUTS) as HudInput[]).map((k) => (
            <button
              key={k}
              type="button"
              className={btn}
              disabled={!target || !hudInput(state, target, k, now || 0)}
              onClick={() => target && setNote(director.hud(target, k) ? `Injected (simulated): ${HUD_INPUTS[k]}` : "No matching sent message")}
              data-testid={`demo-hud-${k}`}
            >
              {HUD_INPUTS[k]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[var(--mg-faint)]">{"Works only on messages the base has already sent: nothing exists without base approval, so no receipt can be faked."}</p>
        {note ? <p className="text-[var(--mg-cyan)]">{note}</p> : null}
        <button type="button" className={btn} disabled={!member} onClick={() => director.toggleDevice(astro)} data-testid="demo-device">
          {member?.connection === "disconnected" ? "Simulate device reconnect" : "Simulate device disconnect"}
        </button>
      </section>

      <section className="flex flex-col gap-1.5">
        <p className="font-semibold">{"③ Auto-simulated HUD feedback"}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={snap.autoHud} onChange={(e) => director.setAutoHud(e.target.checked)} data-testid="demo-auto" />
          {"On (off by default)"}
        </label>
        <p className="text-[11px] text-[var(--mg-faint)]">{"When on, the simulated HUD answers each sent message in turn with a HUD receipt, a crew acknowledgement and one retest result Within Reference Range. Base staff must still approve; every receipt is labelled simulated."}</p>
      </section>

      <p className="mt-auto text-[11px] text-[var(--mg-faint)]">{"The advanced dev entry is hidden by default: add ?dev=1 to the URL."}</p>
    </aside>
  );
}

/** Compact demo control bar shown after a start: it stays out of the way of the canvas. */
export function DemoBar({ director, snap, state, now, onExpand }: { director: DemoDirector; snap: DemoSnapshot; state: StationState; now: number; onExpand: () => void }) {
  const due = snap.pending?.dueAt && now ? Math.max(0, Math.ceil((snap.pending.dueAt - now) / 1000)) : null;
  const btn = "min-h-7 rounded-md border border-[var(--mg-line-strong)] px-2 text-[12px] disabled:opacity-40";
  return (
    <div className="fixed bottom-2 left-1/2 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-2 rounded-full border-2 border-dashed border-[#d678ff] bg-[rgba(11,17,28,0.97)] px-3 py-1 text-[12px] shadow-2xl" role="region" aria-label="Local simulated demo controls" data-testid="demo-bar">
      <span className="font-semibold text-[#e3a6ff]">{"Local simulation"}</span>
      <span className="max-w-[30rem] truncate text-[var(--mg-dim)]" data-testid="demo-bar-pending">
        {snap.pending ? `${snap.paused ? "Paused · " : ""}Next: ${snap.pending.label}${!snap.paused && due !== null ? ` (${due} s)` : ""}` : snap.paused ? "Replay paused" : "No simulated input pending"}
      </span>
      <button type="button" className={btn} onClick={() => director.setPaused(!snap.paused)} data-testid="demo-bar-pause">
        {snap.paused ? "Resume" : "Pause"}
      </button>
      <button type="button" className={btn} disabled={!snap.pending} onClick={director.stepNow} data-testid="demo-bar-step">
        {"Next"}
      </button>
      <button type="button" className={btn} disabled={!state.run} onClick={director.reset} data-testid="demo-bar-reset">
        {"Reset"}
      </button>
      <button type="button" className={`${btn} border-[#d678ff] text-[#e3a6ff]`} onClick={onExpand} data-testid="demo-bar-expand">
        {"Expand (HUD feedback, more)"}
      </button>
    </div>
  );
}
