"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CANVAS_EDGES, CANVAS_H, CANVAS_NODES, CANVAS_W, divergence, type CanvasEdgeId, type CanvasNodeId, type CanvasStep } from "@/lib/station/canvas";

/** Display pacing at 1× (presentation rhythm, NOT the analysis algorithm's duration). */
export const PACE = { travelMs: 700, processMs: 1100, holdMs: 500 } as const;
const SPEEDS = [0.5, 1, 1.5, 2] as const;

type Phase = "travel" | "process" | "hold" | "end";
type Cursor = { step: number; phase: Phase; mode: "live" | "replay" };
type NodeView = "source" | "todo" | "incoming" | "processing" | "done" | "stopped" | "human" | "skipped";
type EdgeView = "todo" | "active" | "done" | "skipped";

const subscribeMotion = (l: () => void) => {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", l);
  return () => m.removeEventListener("change", l);
};
const useReducedMotion = () => useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);

// Node boxes in canvas units (14% × 19% of the canvas).
const NODE_W = 140;
const NODE_H = 80;
const SOURCE_W = 64;

const NODE_STYLE: Record<NodeView, string> = {
  source: "border-[var(--mg-line-strong)] bg-[var(--mg-bg-2)] text-[var(--mg-dim)]",
  todo: "border-dashed border-[var(--mg-line)] bg-[var(--mg-bg)] text-[var(--mg-faint)]",
  incoming: "border-dashed border-[var(--mg-cyan)] bg-[var(--mg-bg)] text-[var(--mg-dim)]",
  processing: "border-[var(--mg-cyan)] bg-[rgba(98,212,230,0.12)] text-[var(--mg-text)]",
  done: "border-[var(--mg-ok)] bg-[var(--mg-bg-2)] text-[var(--mg-text)]",
  stopped: "border-[var(--mg-caution)] bg-[rgba(241,200,120,0.12)] text-[var(--mg-text)]",
  human: "border-[var(--mg-coral)] bg-[rgba(255,128,102,0.14)] text-[var(--mg-text)]",
  skipped: "border-dashed border-[var(--mg-line)] bg-transparent text-[var(--mg-faint)] opacity-60",
};
const NODE_WORD: Record<NodeView, string> = { source: "", todo: "未到达", incoming: "数据传入中", processing: "处理中…", done: "完成", stopped: "停止：转入分支", human: "等待基地审核", skipped: "未执行" };
const EDGE_STROKE: Record<EdgeView, string> = { todo: "var(--mg-line-strong)", active: "var(--mg-cyan)", done: "var(--mg-ok)", skipped: "var(--mg-line)" };

/**
 * One analysis round as a node-link graph. A data marker carrying a short data summary moves along
 * the edge the data actually took; the node then processes and shows its result; the output moves
 * on. A result is never shown before the station revealed it (`progress` ≥ step.needs). At a human
 * node the transfer stops. A replay only re-draws what already happened.
 */
export function FlowCanvas({
  steps,
  progress,
  sourceLabel,
  startAtEnd,
  waitingText,
  renderDetail,
}: {
  steps: CanvasStep[];
  progress: number;
  sourceLabel: string;
  startAtEnd: boolean;
  waitingText: string | null;
  renderDetail: (id: CanvasNodeId) => ReactNode;
}) {
  const [cursor, setCursor] = useState<Cursor>(() => (startAtEnd && steps.length ? { step: steps.length - 1, phase: "end", mode: "live" } : { step: 0, phase: "travel", mode: "live" }));
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [open, setOpen] = useState<CanvasNodeId | null>(null);
  const reduced = useReducedMotion();
  const packetRef = useRef<HTMLDivElement>(null);
  const paths = useRef<Partial<Record<CanvasEdgeId, SVGPathElement | null>>>({});
  const live = useRef({ cursor, paused, speed, progress, steps, reduced, elapsed: 0 });
  useEffect(() => {
    Object.assign(live.current, { cursor, paused, speed, progress, steps, reduced });
  });

  // Presentation clock (requestAnimationFrame). It only moves the picture; business state is read, never written.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const advance = (n: Cursor) => {
      live.current.elapsed = 0;
      live.current.cursor = n;
      setCursor(n);
    };
    const place = (edge: CanvasEdgeId, t: number) => {
      const path = paths.current[edge];
      const el = packetRef.current;
      if (!path || !el) return;
      const p = path.getPointAtLength(path.getTotalLength() * t);
      el.style.left = `${(p.x / CANVAS_W) * 100}%`;
      el.style.top = `${(p.y / CANVAS_H) * 100}%`;
    };
    const frame = (now: number) => {
      const L = live.current;
      const dt = Math.min(100, now - last);
      last = now;
      if (!L.paused) L.elapsed += dt * L.speed;
      const c = L.cursor;
      const st = L.steps[c.step];
      if (st && c.phase === "travel") {
        const t = Math.min(1, L.elapsed / PACE.travelMs);
        place(st.edge, L.reduced ? 0.5 : t);
        if (t >= 1) advance({ ...c, phase: "process" });
      } else if (st && c.phase === "process") {
        // The node may only show its result once the station has really produced it.
        if (L.elapsed >= PACE.processMs && L.progress >= st.needs) advance(c.step === L.steps.length - 1 || st.outcome === "human" ? { step: c.step, phase: "end", mode: "live" } : { ...c, phase: "hold" });
      } else if (st && c.phase === "hold") {
        if (L.elapsed >= PACE.holdMs) advance({ ...c, step: c.step + 1, phase: "travel" });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const replay = () => {
    live.current.elapsed = 0;
    setOpen(null);
    setPaused(false);
    setCursor({ step: 0, phase: "travel", mode: "replay" });
  };

  const planIdx = new Map(steps.map((s, i) => [s.to, i]));
  const edgeIdx = new Map(steps.map((s, i) => [s.edge, i]));
  const div = divergence(steps);
  const settledAt = (k: number) => k < cursor.step || (k === cursor.step && (cursor.phase === "hold" || cursor.phase === "end"));
  const passedDiv = div !== null && settledAt(div);
  const nodeView = (id: CanvasNodeId): NodeView => {
    if (id === "source") return "source";
    const k = planIdx.get(id);
    if (k === undefined) return passedDiv ? "skipped" : "todo";
    if (settledAt(k)) return steps[k].outcome === "stopped" ? "stopped" : steps[k].outcome === "human" ? "human" : "done";
    if (k === cursor.step) return cursor.phase === "process" ? "processing" : "incoming";
    return "todo";
  };
  const edgeView = (e: CanvasEdgeId): EdgeView => {
    const k = edgeIdx.get(e);
    if (k === undefined) return passedDiv ? "skipped" : "todo";
    if (k < cursor.step || (k === cursor.step && cursor.phase !== "travel")) return "done";
    return k === cursor.step ? "active" : "todo";
  };
  const current = steps[cursor.step];
  const behind = cursor.mode === "live" && cursor.phase !== "end" && steps.findLastIndex((s) => s.needs <= progress) > cursor.step;
  const shown = !current
    ? (waitingText ?? "等待数据")
    : cursor.phase === "end" && current.outcome === "human"
      ? "停在「等待基地审核」：数据传输已停止，等待基地人员"
      : `${CANVAS_NODES[current.to].label} · ${cursor.phase === "travel" ? "数据传入中" : cursor.phase === "process" ? "处理中" : "已完成"}`;

  return (
    <section aria-label="分析数据流" className="flex flex-col gap-2" data-testid="flow-canvas" data-step={cursor.step} data-phase={cursor.phase} data-mode={cursor.mode}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md border px-2 py-0.5 text-[12px] font-semibold ${cursor.mode === "replay" ? "border-[#d678ff] text-[#e3a6ff]" : "border-[var(--mg-cyan)] text-[var(--mg-cyan)]"}`} data-testid="canvas-mode">
          {cursor.mode === "replay" ? "可视化回放 · 仅重绘已发生的过程，不重新分析、不发送消息" : "实时 · 跟随基站实际进度"}
        </span>
        <span className="text-[12px] text-[var(--mg-dim)]" role="status" aria-live="polite" data-testid="canvas-shown">
          {`画面：${shown}`}
        </span>
        <div className="ml-auto flex items-center gap-1.5 text-[12px]">
          <button type="button" disabled={!steps.length || cursor.phase === "end"} onClick={() => setPaused((x) => !x)} className="min-h-8 rounded-lg border border-[var(--mg-line-strong)] px-2.5 disabled:opacity-40" data-testid="canvas-pause">
            {paused ? "▶ 继续" : "⏸ 暂停"}
          </button>
          <button type="button" disabled={!steps.length} onClick={replay} className="min-h-8 rounded-lg border border-[#d678ff] px-2.5 text-[#e3a6ff] disabled:opacity-40" data-testid="canvas-replay">
            {"↺ 可视化回放"}
          </button>
          <label className="flex items-center gap-1 text-[var(--mg-dim)]">
            {"速度"}
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded-md border border-[var(--mg-line)] bg-[var(--mg-bg)] px-1 py-0.5" data-testid="canvas-speed">
              {SPEEDS.map((s) => (
                <option key={s} value={s}>{`${s}×`}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {behind ? <p className="text-[11px] text-[var(--mg-dim)]" data-testid="canvas-behind">{"画面按展示节奏追赶中，稍落后于基站实际进度（实际进度见上方“数据到了哪一步”）。"}</p> : null}

      <div className="overflow-x-auto">
        <div className="relative min-w-[860px] rounded-2xl border border-[var(--mg-line)] bg-[rgba(8,13,22,0.6)]" style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }} data-testid="canvas-area">
          <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} className="absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              {(["todo", "active", "done", "skipped"] as EdgeView[]).map((v) => (
                <marker key={v} id={`arrow-${v}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={EDGE_STROKE[v]} />
                </marker>
              ))}
            </defs>
            {(Object.keys(CANVAS_EDGES) as CanvasEdgeId[]).map((e) => {
              const v = edgeView(e);
              return (
                <path
                  key={e}
                  ref={(el) => {
                    paths.current[e] = el;
                  }}
                  d={CANVAS_EDGES[e].d}
                  fill="none"
                  stroke={EDGE_STROKE[v]}
                  strokeWidth={v === "active" ? 3 : 2}
                  strokeDasharray={v === "todo" || v === "skipped" ? "6 6" : undefined}
                  opacity={v === "skipped" ? 0.5 : 1}
                  markerEnd={`url(#arrow-${v})`}
                  data-testid={`canvas-edge-${e}`}
                  data-state={v}
                />
              );
            })}
          </svg>

          {(Object.keys(CANVAS_EDGES) as CanvasEdgeId[])
            .filter((e) => CANVAS_EDGES[e].label)
            .map((e) => {
              const v = edgeView(e);
              return (
                <span
                  key={e}
                  className={`pointer-events-none absolute -translate-y-1/2 whitespace-nowrap rounded px-1 text-[11px] ${e === "b-quality" ? "-translate-x-full" : e === "e-review" ? "" : "-translate-x-1/2"} ${v === "skipped" ? "text-[var(--mg-faint)] line-through" : e.startsWith("b-") ? "font-medium text-[var(--mg-caution)]" : "text-[var(--mg-dim)]"}`}
                  style={{ left: `${(CANVAS_EDGES[e].lx / CANVAS_W) * 100}%`, top: `${(CANVAS_EDGES[e].ly / CANVAS_H) * 100}%` }}
                  data-testid={`canvas-label-${e}`}
                >
                  {CANVAS_EDGES[e].label}
                  {v === "skipped" ? "（未执行）" : ""}
                </span>
              );
            })}

          {(Object.keys(CANVAS_NODES) as CanvasNodeId[]).map((id) => {
            const n = CANVAS_NODES[id];
            const v = nodeView(id);
            const k = planIdx.get(id);
            const w = id === "source" ? SOURCE_W : NODE_W;
            const result = k !== undefined && (v === "done" || v === "stopped" || v === "human") ? steps[k].result : null;
            const clickable = v === "done" || v === "stopped" || v === "human" || v === "processing";
            return (
              <button
                key={id}
                type="button"
                disabled={!clickable}
                onClick={() => setOpen(open === id ? null : id)}
                aria-label={`${id === "source" ? sourceLabel : n.label}：${NODE_WORD[v]}${result ? `，${result}` : ""}`}
                className={`absolute flex flex-col items-start justify-center gap-0.5 overflow-hidden rounded-xl border-2 px-2 text-left transition-colors ${NODE_STYLE[v]} ${open === id ? "ring-2 ring-[var(--mg-cyan)]" : ""} ${clickable ? "cursor-pointer" : "cursor-default"}`}
                style={{ left: `${((n.x - w / 2) / CANVAS_W) * 100}%`, top: `${((n.y - NODE_H / 2) / CANVAS_H) * 100}%`, width: `${(w / CANVAS_W) * 100}%`, height: `${(NODE_H / CANVAS_H) * 100}%` }}
                data-testid={`canvas-node-${id}`}
                data-state={v}
              >
                {id === "source" ? (
                  <span className="w-full text-center text-[11px] leading-tight">{sourceLabel}</span>
                ) : (
                  <>
                    <span className="text-[13px] font-semibold leading-tight">{n.label}</span>
                    <span className={`text-[11px] ${v === "processing" || v === "incoming" ? "text-[var(--mg-cyan)]" : v === "stopped" ? "text-[var(--mg-caution)]" : v === "human" ? "text-[var(--mg-coral)]" : ""}`}>{NODE_WORD[v]}</span>
                    {result ? <span className="line-clamp-2 text-[11px] leading-snug text-[var(--mg-dim)]">{result}</span> : null}
                    {v === "processing" ? (
                      <span className="mt-0.5 h-1 w-full overflow-hidden rounded bg-[var(--mg-line)]">
                        <span
                          key={`${cursor.step}-${cursor.mode}`}
                          className="block h-full origin-left bg-[var(--mg-cyan)]"
                          style={{ animation: `mg-fill ${PACE.processMs / speed}ms linear forwards`, animationPlayState: paused ? "paused" : "running" }}
                        />
                      </span>
                    ) : null}
                  </>
                )}
              </button>
            );
          })}

          {current && cursor.phase === "travel" ? (
            <div ref={packetRef} className="pointer-events-none absolute z-10" style={{ left: "0%", top: "0%" }} data-testid="canvas-packet" data-edge={current.edge}>
              <span className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--mg-bg)] bg-[var(--mg-cyan)] p-[5px] shadow-[0_0_10px_rgba(98,212,230,0.8)]" />
              <span className="absolute -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-md border border-[var(--mg-cyan)] bg-[rgba(11,17,28,0.95)] px-2 py-0.5 text-[11px] text-[var(--mg-text)]">
                {reduced ? `→ ${current.packet}` : current.packet}
              </span>
            </div>
          ) : null}

          {waitingText && !steps.length ? <p className="absolute left-[2%] top-[42%] text-[13px] text-[var(--mg-dim)]">{waitingText}</p> : null}

          {open ? (
            <div className="absolute inset-x-[2%] bottom-[3%] z-20 max-h-[80%] overflow-y-auto rounded-xl border border-[var(--mg-line-strong)] bg-[var(--mg-bg-2)] p-3 shadow-2xl" data-testid="canvas-detail" data-node={open}>
              <button type="button" onClick={() => setOpen(null)} className="float-right text-[12px] text-[var(--mg-dim)] underline" data-testid="canvas-detail-close">
                {"关闭"}
              </button>
              {renderDetail(open)}
            </div>
          ) : null}
        </div>
      </div>
      <p className="text-[11px] text-[var(--mg-faint)]">{`展示节奏（1×）：连线传输 ${PACE.travelMs / 1000} s，节点处理约 ${(PACE.processMs + PACE.holdMs) / 1000} s；不是算法耗时。点击节点查看输入、输出与证据。只有汇总指标，没有原始肌电波形。`}</p>
    </section>
  );
}
