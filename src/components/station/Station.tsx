"use client";

import { useState, useSyncExternalStore } from "react";
import { MockStationAdapter } from "@/lib/station/adapter";
import { workbenchStage } from "@/lib/station/station";
import { ActionPanel } from "./ActionPanel";
import { CaseDetails, CaseSummary, Timeline } from "./CaseView";
import { CrewColumn } from "./CrewColumn";
import { DevPanel } from "./DevPanel";
import { useStation } from "./useStation";

const noop = () => () => {};
const isDev = () => new URLSearchParams(window.location.search).get("dev") === "1";

/**
 * MyoMars base station: a health-event workbench built with the Mission Glass visual system
 * (header, tokens, glass panels). Left: astronaut and events. Centre: understand the event.
 * Right: the action for the event's current stage. Rendering only: rules live in src/lib/station/.
 */
export function Station() {
  const [adapter] = useState(() => new MockStationAdapter());
  const api = useStation(adapter);
  const { state } = api;
  const dev = useSyncExternalStore(noop, isDev, () => false);
  const mock = adapter.mode === "standalone-mock";
  const [selected, setSelected] = useState<string | null>(null);
  const cases = state.caseOrder.map((id) => state.cases[id]);
  const current = (selected && state.cases[selected]) || cases[cases.length - 1] || null;
  const count = (stages: string[]) => cases.filter((c) => stages.includes(workbenchStage(c))).length;

  return (
    <div lang="en" className="mission-glass flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden" data-testid="station" data-link-mode={adapter.mode}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--mg-line)] px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">{"MyoMars"}</span>
          <span className="text-sm text-[var(--mg-dim)]">{"Mars Base · Health case workbench"}</span>
        </div>
        <p className="text-[13px] text-[var(--mg-dim)]" data-testid="station-counts">
          {`Awaiting base ${count(["review", "reassessed"])} · Awaiting crew ${count(["dispatched"])} · Analysing ${count(["analysing", "reassessing"])}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--mg-coral)] px-3 py-1 text-[13px] font-semibold text-[var(--mg-coral)]" data-testid="station-sim-pill">
            {"Simulated Data / Simulated Analysis"}
          </span>
          <span className="rounded-full border border-[var(--mg-line-strong)] px-3 py-1 text-[12px] text-[var(--mg-dim)]" title={adapter.label} data-testid="station-link">
            {"Standalone demo · not connected to Trigger / HUD"}
          </span>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-3 p-3 lg:min-h-0 lg:grid-cols-[16rem_minmax(0,1fr)_27rem] lg:grid-rows-[auto_minmax(0,1fr)]">
        <aside className="mg-glass flex min-h-0 flex-col lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <CrewColumn state={state} selectedId={current?.caseId ?? null} onSelect={setSelected} />
        </aside>
        {current ? (
          <>
            <div className="lg:col-start-2 lg:row-start-1" data-testid="station-case" data-case={current.caseId} data-phase={current.phase} data-stage={workbenchStage(current)} data-alert={current.alert.level} data-version={current.evaluations.at(-1)?.version}>
              <CaseSummary c={current} />
            </div>
            <section aria-label="Current action" className="mg-glass flex min-h-0 flex-col overflow-y-auto lg:col-start-3 lg:row-span-2 lg:row-start-1">
              <ActionPanel c={current} state={state} api={api} mock={mock} />
            </section>
            <section aria-label="Analysis and evidence" className="mg-glass min-h-0 overflow-y-auto p-4 lg:col-start-2 lg:row-start-2">
              <CaseDetails c={current} state={state} mock={mock} />
            </section>
          </>
        ) : (
          <>
            <div className="mg-glass flex flex-col gap-1 p-5 lg:col-start-2 lg:row-start-1" data-testid="station-empty">
              <p className="text-[12px] text-[var(--mg-faint)]">{"What happened"}</p>
              <h2 className="text-[19px] font-semibold">{state.run ? "Scenario running, awaiting a standardised simulated measurement" : "Awaiting scenario start"}</h2>
              <p className="text-[14px] text-[var(--mg-dim)]">
                {state.run
                  ? `${state.run.astronaut.callsign} · ${state.run.task.title}. No measurement received yet; when one arrives, the base runs the simulated analysis automatically and prepares a candidate for base review.`
                  : "The base has not received a scenario start event yet. Until the Trigger is connected, add ?dev=1 to the address to open the development test entry and inject simulated events."}
              </p>
              <p className="text-[13px] text-[var(--mg-dim)]" data-testid="station-demo-flow">
                {"Demo flow: a standardised simulated measurement shows a change → base review → standardised retest → re-evaluation → base handling. Each input is one simulated measurement under a fixed protocol, not continuous sEMG monitoring during free activity."}
              </p>
              <p className="text-[12px] text-[var(--mg-faint)]">{`Input source: ${mock ? "local simulation (standalone demo, not connected to Trigger / HUD)" : adapter.label}`}</p>
            </div>
            <section aria-label="Current action" className="mg-glass min-h-0 overflow-y-auto lg:col-start-3 lg:row-span-2 lg:row-start-1">
              <ActionPanel c={null} state={state} api={api} mock={mock} />
            </section>
            <section aria-label="Case timeline" className="mg-glass min-h-0 overflow-y-auto p-4 lg:col-start-2 lg:row-start-2">
              <Timeline entries={state.timeline} />
            </section>
          </>
        )}
      </main>
      {api.lastError && api.lastError.startsWith("invalid") ? (
        <p role="alert" className="fixed bottom-3 right-3 z-50 max-w-md rounded-lg bg-[rgba(11,17,28,0.95)] p-2 text-[12px] text-[var(--mg-caution)]">
          {`Rejected an invalid message: ${api.lastError.split("\n")[0]}`}
        </p>
      ) : null}
      {dev ? <DevPanel adapter={adapter} state={state} caseId={current?.caseId ?? null} /> : null}
    </div>
  );
}
