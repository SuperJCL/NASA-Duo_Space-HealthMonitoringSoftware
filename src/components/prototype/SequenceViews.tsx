"use client";

import { useState } from "react";
import type { MissionSequence, SequenceSegment } from "@/lib/prototype/mission-sequence";
import { SEPARATION_NOTE } from "@/lib/prototype/mission-sequence";
import type { Profile } from "@/lib/terrain/terrain";
import { ProfileChart } from "@/components/terrain/ProfileChart";

const metres = (m: number) => `${Math.round(m).toLocaleString("en-US")} m`;
const chip = (phase: MissionSequence["phase"], order: number) => `${phase === "draft" ? "Draft" : "Seq"} ${order}`;
const LEADS: Record<SequenceSegment["state"], string> = {
  draft: "Draft order: not confirmed yet.",
  history: "Leads to completed work.",
  current: "Leads to the current action.",
  remaining: "Leads to work still to do.",
};

/**
 * MAP-2: the keyboard path to the sequence drawn on the map. Targets in plan
 * order (with their state in words) and, before each target, the connection
 * that leads to it. Selecting a target or a connection selects it in 2D and
 * 3D.
 */
export function SequenceList({
  sequence,
  titleByTask,
  selectedTaskId,
  selectedSegmentId,
  onSelectTask,
  onSelectSegment,
  defaultOpen,
}: {
  sequence: MissionSequence;
  titleByTask: Record<string, string>;
  selectedTaskId: string | null;
  selectedSegmentId: string | null;
  onSelectTask: (taskId: string) => void;
  onSelectSegment: (id: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const draft = sequence.phase === "draft";
  return (
    <section aria-labelledby="mg-seq-title" className="mt-2 rounded-xl border border-[var(--mg-line)] px-3 py-2" data-testid="mg-seq-list" data-phase={sequence.phase}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="mg-seq-title" className="text-[13px] font-semibold">
          {draft ? "Draft order on the map" : "Mission sequence on the map"}
        </h2>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="min-h-8 px-1 text-[12px] text-[var(--mg-dim)] underline underline-offset-2" data-testid="mg-seq-toggle">
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <p className="text-[12px] text-[var(--mg-coral)]" data-testid="mg-seq-label">
        {sequence.label}
      </p>
      <ol hidden={!open} className="mt-1 space-y-0.5" aria-label={draft ? "Draft order" : "Mission sequence, in plan order"}>
        {sequence.nodes.map((n) => {
          const into = sequence.segments.find((x) => x.to.order === n.order);
          const gap = sequence.gaps.find((g) => g.toOrder === n.order);
          return (
            <li key={n.taskId}>
              {into ? (
                <button
                  type="button"
                  aria-pressed={into.id === selectedSegmentId}
                  onClick={() => onSelectSegment(into.id)}
                  className={`ml-3 flex min-h-8 w-[calc(100%-0.75rem)] items-center gap-2 rounded-lg border-l-2 px-2 text-left text-[12px] ${
                    into.id === selectedSegmentId ? "bg-[var(--mg-surface)] text-[var(--mg-text)]" : "text-[var(--mg-dim)]"
                  } ${into.infeasible ? "border-dashed border-[var(--mg-caution)]" : into.state === "history" ? "border-[var(--mg-ok)]" : "border-[var(--mg-coral)]"}`}
                  data-testid={`mg-seq-seg-${into.from.order}-${into.to.order}`}
                  data-state={into.state}
                >
                  <span aria-hidden>{"↓"}</span>
                  <span>{`Connection ${into.from.order} → ${into.to.order} · ${metres(into.straightLineM)} straight line${into.infeasible ? " · leads to work that does not fit" : ""}`}</span>
                </button>
              ) : null}
              {gap ? (
                <p className="ml-3 px-2 text-[12px] text-[var(--mg-caution)]" data-testid={`mg-seq-gap-${gap.fromOrder}-${gap.toOrder}`}>
                  {gap.reason}
                </p>
              ) : null}
              <button
                type="button"
                aria-pressed={n.taskId === selectedTaskId}
                onClick={() => onSelectTask(n.taskId)}
                className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] ${n.taskId === selectedTaskId ? "bg-[var(--mg-surface)]" : ""} ${n.onLine ? "" : "text-[var(--mg-faint)]"}`}
                data-testid={`mg-seq-node-${n.order}`}
                data-state={n.state}
              >
                <span
                  className={`shrink-0 rounded border px-1 text-[11px] font-semibold ${n.onLine ? "border-[var(--mg-coral)]" : "border-dashed border-[var(--mg-faint)]"} ${n.current ? "bg-[var(--mg-coral)] text-[#1a0f0c]" : ""}`}
                >
                  {chip(sequence.phase, n.order)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{`${n.name} · ${titleByTask[n.taskId] ?? n.taskId}`}</span>
                  <span className={`block text-[12px] ${n.feasible ? "text-[var(--mg-dim)]" : "text-[var(--mg-caution)]"}`}>
                    {`${n.current ? "Current · " : ""}${n.stateText}${n.onLine ? "" : " · not on the sequence line"}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {open ? <p className="mt-1 text-[11px] text-[var(--mg-faint)]">{`Numbers are plan order, not priority. ${SEPARATION_NOTE}`}</p> : null}
    </section>
  );
}

/**
 * MAP-2: the selected connection. Plan order only; its straight-line
 * separation; and, in 2D, the existing real-DTM profile along the same
 * straight sampling line (in 3D the viewer's profile panel shows it).
 */
export function SegmentSummary({
  segment,
  phase,
  titleByTask,
  view,
  coverage,
  profile,
  profileState,
  onClose,
}: {
  segment: SequenceSegment;
  phase: MissionSequence["phase"];
  titleByTask: Record<string, string>;
  view: "2d" | "3d";
  coverage: "inside" | "outside";
  profile: Profile | null;
  /** 2D only: "loading" while the verified DTM loads, or an error text. */
  profileState: "ready" | "loading" | { error: string };
  onClose: () => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const a = segment.from;
  const b = segment.to;
  return (
    <section
      aria-label="Selected connection"
      className="mg-glass mg-rise relative z-[5] mx-3 mt-3 bg-[var(--mg-glass-strong)] p-3 text-sm lg:absolute lg:left-14 lg:top-16 lg:m-0 lg:max-h-[calc(100%-5rem)] lg:w-[22rem] lg:overflow-y-auto"
      data-testid="mg-segment-summary"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--mg-coral)]">{`${phase === "draft" ? "Draft" : "Conceptual"} connection · plan order ${a.order} → ${b.order}`}</p>
          <h2 className="mt-0.5 text-[16px] font-semibold leading-snug" data-testid="mg-segment-title">
            {`${a.name} → ${b.name}`}
          </h2>
        </div>
        <button type="button" aria-label="Close connection summary" onClick={onClose} className="size-9 shrink-0 rounded-lg border border-[var(--mg-line)] text-[var(--mg-dim)]" data-testid="mg-segment-close">
          {"✕"}
        </button>
      </div>
      <p className="mt-1 text-[var(--mg-dim)]" data-testid="mg-segment-explain">
        {`After ${titleByTask[a.taskId] ?? a.taskId} (${a.name}), the plan continues with ${titleByTask[b.taskId] ?? b.taskId} (${b.name}). ${LEADS[segment.state]}${segment.infeasible ? " That action does not fit the current constraints." : ""}`}
      </p>
      <p className="mt-1 font-medium" data-testid="mg-segment-distance">
        {`${metres(segment.straightLineM)} straight-line separation (great circle, Mars 2000 sphere). Not a travel distance.`}
      </p>
      <p className="mt-0.5 text-[12px] text-[var(--mg-faint)]">{"Plan order only: not a navigable route, no travel time, no safety or traversability assessment."}</p>
      <div className="mt-2" data-testid="mg-segment-profile">
        {coverage === "outside" ? (
          <p className="text-[13px] text-[var(--mg-caution)]" data-testid="mg-segment-profile-unavailable">
            {"Elevation profile unavailable: this connection leaves the 3 km DTM crop (no elevations are extrapolated)."}
          </p>
        ) : view === "3d" ? (
          <p className="text-[13px] text-[var(--mg-dim)]">{"Elevation along this straight line: shown in the profile panel (real DTM)."}</p>
        ) : profileState === "loading" ? (
          <p className="text-[13px] text-[var(--mg-dim)]">{"Loading the verified DTM…"}</p>
        ) : typeof profileState === "object" ? (
          <p className="text-[13px] text-[var(--mg-caution)]" data-testid="mg-segment-profile-unavailable">
            {`Elevation profile unavailable: ${profileState.error}.`}
          </p>
        ) : profile ? (
          <>
            <p className="text-[12px] font-medium">{"Elevation profile (CTX DTM, 20 m posts)"}</p>
            <ProfileChart profile={profile} fromName={a.name} toName={b.name} hover={hover} onHover={setHover} testId="mg-seg-profile" />
            <p className="mt-1 text-[12px] font-medium" data-testid="mg-segment-profile-caveat">
              {"Straight sampling line: not a route, not a safe path, no travel time or traversability."}
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}

const DIAGRAM = { w: 260, h: 120, pad: 22 };
const STROKE: Record<SequenceSegment["state"], string> = { draft: "#ff8a6b", history: "#84d8a6", current: "#ff8a6b", remaining: "#ff8a6b" };

/**
 * MAP-2 replanning preview: a small plan-order diagram of one option, drawn
 * from the scenario positions (north up, equal scale on both axes). It is a
 * schematic of plan order only, not a map and not a route.
 */
export function SequenceDiagram({ sequence, testId, caption }: { sequence: MissionSequence; testId: string; caption: string }) {
  const placed = sequence.nodes.filter((n) => n.position);
  // Local east/north in degrees of arc (longitude scaled by cos φ), one scale for both axes.
  const lat0 = placed.length ? placed.reduce((sum, n) => sum + n.position![1], 0) / placed.length : 0;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = placed.map((n) => n.position![0] * k);
  const ys = placed.map((n) => n.position![1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((DIAGRAM.w - 2 * DIAGRAM.pad) / Math.max(x1 - x0, 1e-9), (DIAGRAM.h - 2 * DIAGRAM.pad) / Math.max(y1 - y0, 1e-9));
  const sx = (p: readonly [number, number]) => DIAGRAM.w / 2 + (p[0] * k - (x0 + x1) / 2) * scale;
  const sy = (p: readonly [number, number]) => DIAGRAM.h / 2 - (p[1] - (y0 + y1) / 2) * scale;
  const live = sequence.segments.filter((x) => x.state !== "history").map((x) => `${x.from.order}→${x.to.order}`);
  return (
    <figure className="mt-2" data-testid={testId} data-segments={JSON.stringify(sequence.segments.map((x) => ({ id: x.id, state: x.state, infeasible: x.infeasible })))}>
      <svg viewBox={`0 0 ${DIAGRAM.w} ${DIAGRAM.h}`} className="block w-full rounded-lg bg-[rgba(0,0,0,0.25)]" role="img" aria-label={`${caption}. ${live.length ? `Remaining connections in plan order: ${live.join(", ")}.` : "No remaining connection."}`}>
        {sequence.segments.map((x) => (
          <line
            key={x.id}
            x1={sx(x.from.position)}
            y1={sy(x.from.position)}
            x2={sx(x.to.position)}
            y2={sy(x.to.position)}
            stroke={x.infeasible ? "#f1c878" : STROKE[x.state]}
            strokeWidth={x.state === "current" ? 3 : 2}
            strokeDasharray={x.infeasible ? "5 4" : undefined}
            strokeLinecap="round"
          />
        ))}
        {placed.map((n) => (
          <g key={n.taskId}>
            <circle
              cx={sx(n.position!)}
              cy={sy(n.position!)}
              r={6}
              fill={n.state === "done" || n.state === "done-partial" ? "#84d8a6" : n.onLine ? "#ff8a6b" : "rgba(14,21,32,0.9)"}
              stroke={n.onLine ? "#0e1520" : "#8b97a8"}
              strokeDasharray={n.onLine ? undefined : "2 2"}
              strokeWidth={1.5}
            />
            <text x={sx(n.position!)} y={sy(n.position!) - 10} textAnchor="middle" fontSize={10} fill={n.onLine ? "#ffffff" : "#a3b3c8"}>
              {`${n.order} ${n.name.replace("Target ", "")}`}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-0.5 text-[12px] text-[var(--mg-faint)]">{caption}</figcaption>
    </figure>
  );
}
