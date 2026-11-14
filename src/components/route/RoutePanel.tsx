"use client";

import { useState } from "react";
import { CREW_RULES, ROVER_RULES } from "@/lib/eva-route/traversal";
import { CREW_ASSUMPTIONS, ROVER_DEFAULTS } from "@/lib/eva-route/budget";
import { EVA_DEFAULTS } from "@/lib/eva-route/sol-atlas-eva";
import { DONE_REASONS } from "@/lib/eva-route/scouting";
import { OVERLAY_COLORS, PATH_COLORS } from "@/lib/eva-route/overlay";
import type { RouteOption } from "@/lib/eva-route/options";
import type { ResolvedScouting } from "@/lib/eva-route/scenario";
import type { RouteTarget } from "@/lib/eva-route/world";
import type { EvaRouteState } from "./useEvaRoute";

const rgb = (c: readonly number[]) => `rgb(${c.join(",")})`;
const PHASE_TEXT = { planning: "Planning", scouting: "Rover scouting", decision: "Decide after scouting", approved: "Departure approved", cancelled: "EVA cancelled" } as const;

function metricLines(o: RouteOption): string[] {
  const m = o.metrics;
  if (o.kind === "scout") {
    if (m.value === undefined) return [`Best-case estimate: wait ${m.est_wait_min} min · rover ${m.est_rover_km} km`];
    return [
      `Wait ≈ ${m.est_wait_min} min · rover ${m.est_rover_km} km, ${m.est_rover_kwh} kWh, ${m.est_posts} posts · battery after ${m.est_rover_battery_after_pct} %`,
      `If clear (p = ${m.p_walkable}): ${m.value_if_clear} pts · EVA ${m.if_clear_eva_h} h · O₂ ${m.if_clear_o2_used_kg} kg`,
      `If blocked: ${m.value_if_blocked} pts via ${m.if_blocked_fallback} · EVA ${m.if_blocked_eva_h} h · O₂ ${m.if_blocked_o2_used_kg} kg`,
    ];
  }
  if (o.kind === "cancel") return [];
  if (m.walk_km === undefined) return [];
  return [`Walk ${m.walk_km} km · EVA ${m.eva_h} h (wait ${m.wait_min} min) · O₂ ${m.o2_used_kg} kg used, ${m.o2_left_kg} kg left (${m.o2_margin_pct} %) · ${m.verdict}`];
}

export function RoutePanel({ r, scenario, targets }: { r: EvaRouteState; scenario: ResolvedScouting; targets: readonly RouteTarget[] }) {
  const m = r.mission;
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const variant = scenario.variants.find((v) => v.id === r.config.variantId)!;
  const nameOf = (id: string | null) => targets.find((t) => t.id === id)?.name ?? id ?? "–";

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4 text-[14px]" data-testid="route-panel">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-semibold">{"EVA route & scouting"}</h2>
          <span className="rounded-full border border-[var(--mg-coral)] px-2 py-0.5 text-[12px] font-medium text-[var(--mg-coral)]">{"SIMULATED"}</span>
        </div>
        <p className="mt-1 text-[13px] text-[var(--mg-dim)]">
          {"Plans a walking route from the simulated habitat to a target on the verified CTX terrain, budgets crew time and O₂, and lets a simulated rover scout unobserved ground first. Planning only; not flight software."}
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[12px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Hidden ground truth (simulator)"}</legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Scenario variant">
          {scenario.variants.map((v) => (
            <button key={v.id} type="button" aria-pressed={v.id === r.config.variantId} onClick={() => r.setVariant(v.id)} title={v.summary} className={`min-h-9 rounded-lg border px-2.5 text-[13px] ${v.id === r.config.variantId ? "border-[var(--mg-coral)] text-[var(--mg-text)]" : "border-[var(--mg-line)] text-[var(--mg-dim)]"}`} data-testid={`route-variant-${v.id}`}>
              {v.title}
            </button>
          ))}
          <button type="button" onClick={r.reset} className="min-h-9 rounded-lg border border-[var(--mg-line)] px-2.5 text-[13px] text-[var(--mg-dim)]" data-testid="route-reset">
            {"Reset"}
          </button>
        </div>
        <p className="text-[12px] text-[var(--mg-dim)]">{`${variant.summary} ${variant.rover.note}. The planner sees only what is observed.`}</p>
      </fieldset>

      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="col-span-2 text-[12px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Targets (scenario-defined positions)"}</legend>
        <label className="flex flex-col gap-0.5 text-[13px]">
          {"Primary"}
          <select value={r.config.primaryId} onChange={(e) => r.setPrimary(e.target.value)} className="rounded-lg border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1.5" data-testid="route-primary">
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[13px]">
          {"Alternative"}
          <select value={r.config.alternativeId} onChange={(e) => r.setAlternative(e.target.value)} className="rounded-lg border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1.5" data-testid="route-alternative">
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {r.status === "loading" ? <p className="text-[var(--mg-dim)]" data-testid="route-loading">{"Loading the verified terrain…"}</p> : null}
      {r.status === "error" ? (
        <p role="alert" className="text-[var(--mg-caution)]" data-testid="route-error">
          {`Route planning unavailable: ${r.error}`}
        </p>
      ) : null}

      {m && r.evaluated ? (
        <>
          <div className="mg-glass flex flex-col gap-1 p-3" data-testid="route-status" data-phase={m.phase} data-version={m.version}>
            <p className="font-medium">{`${PHASE_TEXT[m.phase]} · state v${m.version}`}</p>
            <p className="text-[13px] text-[var(--mg-dim)]" data-testid="route-status-detail">
              {`Crew waiting ${Math.round(m.waitS / 60)} min · rover ${Math.round((m.rover.batteryWh / m.roverSpec.capacityWh) * 100)} % battery, ${(m.rover.odometerM / 1000).toFixed(2)} km driven · ${m.observations.length} observation(s)`}
            </p>
            <p className="text-[13px] text-[var(--mg-dim)]" data-testid="route-routes">
              {`Known route ${m.routes.initialKnown ? `${(m.routes.initialKnown.lengthM / 1000).toFixed(2)} km` : "none"} · shortest candidate ${m.routes.candidate ? `${(m.routes.candidate.lengthM / 1000).toFixed(2)} km (${Math.round(m.routes.candidate.unknownLengthM)} m unobserved)` : "none"}`}
            </p>
            {m.scoutReason ? (
              <p className="text-[13px]" data-testid="route-scout-result">
                {`Scouting result: ${DONE_REASONS[m.scoutReason]}.`}
              </p>
            ) : null}
            {m.phase === "scouting" ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button type="button" onClick={r.skip} className="min-h-9 rounded-lg bg-[var(--mg-coral)] px-3 text-[13px] font-semibold text-[#1a0f0c]" data-testid="route-skip">
                  {"Skip to scouting result"}
                </button>
                <label className="flex items-center gap-1 text-[13px] text-[var(--mg-dim)]">
                  {"Speed"}
                  <select value={r.warp} onChange={(e) => r.setWarp(Number(e.target.value))} className="rounded bg-[var(--mg-bg)] px-1" data-testid="route-speed">
                    <option value={60}>{"×60"}</option>
                    <option value={300}>{"×300"}</option>
                  </select>
                </label>
              </div>
            ) : null}
            {m.routes.approved ? (
              <p className="text-[13px] font-medium text-[var(--mg-ok)]" data-testid="route-approved">
                {`Approved: ${m.routes.approved.option} → ${nameOf(m.routes.approved.targetId)} · walk ${(m.routes.approved.sortie.distanceM / 1000).toFixed(2)} km · EVA ${(m.routes.approved.sortie.totalS / 3600).toFixed(2)} h · O₂ margin ${Math.round(m.routes.approved.sortie.marginPct)} % · return route on observed ground`}
              </p>
            ) : null}
          </div>
          {r.toast ? (
            <p role="alert" className="text-[13px] text-[var(--mg-caution)]" data-testid="route-toast">
              {r.toast}
            </p>
          ) : null}

          <section aria-labelledby="route-options-title" className="flex flex-col gap-2">
            <h3 id="route-options-title" className="text-[12px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">
              {"Options (computed on the observed map)"}
            </h3>
            <ul className="flex flex-col gap-2" data-testid="route-options" data-recommended={r.evaluated.recommendedByValue ?? ""}>
              {r.evaluated.options.map((o) => {
                const rec = o.id === r.evaluated!.recommendedByValue;
                return (
                  <li key={o.id} className={`rounded-xl border p-2.5 ${rec ? "border-[var(--mg-ok)]" : "border-[var(--mg-line)]"} ${o.feasible ? "" : "opacity-75"}`} data-testid={`route-option-${o.id}`} data-feasible={o.feasible} data-value={o.value ?? ""}>
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" onClick={() => r.setPreviewId(o.id)} aria-pressed={r.previewId === o.id} className="text-left font-medium">
                        {`${o.label}${o.targetId && o.kind === "switch" ? ` (${nameOf(o.targetId)})` : ""}`}
                      </button>
                      <span className="shrink-0 text-[13px] tabular-nums text-[var(--mg-dim)]">{o.value !== null ? `${o.value.toFixed(2)} pts` : "–"}</span>
                    </div>
                    {rec ? <p className="text-[12px] font-semibold text-[var(--mg-ok)]">{"Highest value under the current assumptions"}</p> : null}
                    {metricLines(o).map((t) => (
                      <p key={t} className="text-[12px] text-[var(--mg-dim)]">
                        {t}
                      </p>
                    ))}
                    {o.violations.map((v) => (
                      <p key={v} className="text-[12px] text-[var(--mg-caution)]">
                        {v}
                      </p>
                    ))}
                    {o.feasible ? (
                      <button type="button" onClick={() => r.choose(o.id)} className={`mt-1.5 min-h-9 rounded-lg px-3 text-[13px] font-semibold ${o.kind === "cancel" ? "border border-[var(--mg-line-strong)]" : "bg-[var(--mg-surface)] ring-1 ring-[var(--mg-line-strong)]"}`} data-testid={`route-choose-${o.id}`}>
                        {o.kind === "scout" ? "Send rover to scout" : o.kind === "cancel" ? "Cancel EVA" : "Approve departure"}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="text-[12px] text-[var(--mg-faint)]">
              {"Approval needs a safe outbound and return crew route on observed ground and an EVA verdict that is not no-go. Values are demo points from configurable simulation assumptions, not science scores; they never affect the mission ranking."}
            </p>
          </section>

          <details className="rounded-xl border border-[var(--mg-line)] p-2.5" data-testid="route-assumptions">
            <summary className="cursor-pointer text-[13px] font-medium">{"Assumptions and limits"}</summary>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
              {(
                [
                  ["shortcutWalkableProb", "p (shortcut walkable)", m.assumptions.shortcutWalkableProb],
                  ["primary", "Value: primary (pts)", m.assumptions.targetValue.primary],
                  ["alternative", "Value: alternative (pts)", m.assumptions.targetValue.alternative],
                  ["costPerEvaHour", "Cost per EVA hour", m.assumptions.costPerEvaHour],
                  ["costPerO2Kg", "Cost per kg O₂", m.assumptions.costPerO2Kg],
                  ["evaMaxH", "EVA window (h)", m.params.evaMaxH],
                ] as const
              ).map(([k, label, v]) => (
                <label key={k} className="flex flex-col gap-0.5">
                  {label}
                  <input type="number" step="any" value={form?.[k] ?? String(v)} onChange={(e) => setForm((f) => ({ ...(f ?? {}), [k]: e.target.value }))} className="rounded border border-[var(--mg-line)] bg-[var(--mg-bg)] px-1.5 py-1" data-testid={`route-input-${k}`} />
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                const val = (k: string, d: number) => (form?.[k] !== undefined ? Number(form[k]) : d);
                r.applyAssumptions({
                  evaMaxH: val("evaMaxH", m.params.evaMaxH),
                  assumptions: {
                    shortcutWalkableProb: val("shortcutWalkableProb", m.assumptions.shortcutWalkableProb),
                    costPerEvaHour: val("costPerEvaHour", m.assumptions.costPerEvaHour),
                    costPerO2Kg: val("costPerO2Kg", m.assumptions.costPerO2Kg),
                    targetValue: { primary: val("primary", m.assumptions.targetValue.primary), alternative: val("alternative", m.assumptions.targetValue.alternative) },
                  },
                });
                setForm(null);
              }}
              className="mt-2 min-h-9 rounded-lg border border-[var(--mg-line-strong)] px-3 text-[13px]"
              data-testid="route-apply-assumptions"
            >
              {"Apply (new state version)"}
            </button>
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12px] text-[var(--mg-dim)]">
              <li>{`Crew (model assumptions, Sol Atlas EVA model, Apache-2.0): Pandolf metabolic rate, ${EVA_DEFAULTS.o2CapKg} kg usable O₂, ${EVA_DEFAULTS.reservePct} % reserve, ${EVA_DEFAULTS.stopMin} min science stop, slope limit ${CREW_RULES.maxSlopeDeg}°; waiting suited at ${CREW_ASSUMPTIONS.waitW} W (simulated).`}</li>
              <li>{`Crew surface rule (simulated): firm ground or loose sand only; sand ripples and boulder fields block the crew.`}</li>
              <li>{`Rover (simulated, not a real vehicle): ≤ ${ROVER_RULES.maxSlopeDeg}°, drives ripples; ${ROVER_DEFAULTS.speedMs} m/s, ${ROVER_DEFAULTS.whPerKm} Wh/km, ${ROVER_DEFAULTS.capacityWh / 1000} kWh, ${ROVER_DEFAULTS.reservePct} % reserve, sensor range ${ROVER_DEFAULTS.sensorRangeM} m without line of sight.`}</li>
              <li>{"Slope is derived from the 20 m CTX DTM, which smooths out boulders and small scarps: a lower bound, not a ground observation."}</li>
            </ul>
          </details>

          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={r.truthView} onChange={(e) => r.setTruthView(e.target.checked)} data-testid="route-truth" />
            {"Show hidden truth (simulator view)"}
          </label>
          {r.truthView ? (
            <p role="note" className="text-[12px] text-[#d678ff]" data-testid="route-truth-warning">
              {"Purple: simulated hazards the planner cannot see yet. Shown for explanation only; planning never uses it."}
            </p>
          ) : null}

          <div className="flex flex-col gap-1 text-[12px] text-[var(--mg-dim)]" data-testid="route-legend">
            {(
              [
                [PATH_COLORS.known, "Known route (surveyed ground only)", false],
                [PATH_COLORS.candidate, "Unconfirmed shortcut (crosses unobserved ground)", true],
                [PATH_COLORS.recommended, "Crew-approvable route (selected option / approved)", false],
                [PATH_COLORS.rover, "Rover track", false],
              ] as const
            ).map(([c, t, dashed]) => (
              <span key={t} className="flex items-center gap-2">
                <span aria-hidden className={`inline-block w-4 border-t-[3px] ${dashed ? "border-dashed" : ""}`} style={{ borderColor: c }} />
                {t}
              </span>
            ))}
            {(
              [
                [OVERLAY_COLORS.surveyed, "Surveyed before the EVA (simulated survey; incl. traverse corridor)"],
                [OVERLAY_COLORS.observed, "Observed by the rover, crew-walkable"],
                [OVERLAY_COLORS.crewBlocked, "Observed, crew may not walk it"],
                [OVERLAY_COLORS.steep, `DTM-derived slope above ${CREW_RULES.maxSlopeDeg}°`],
              ] as const
            ).map(([c, t]) => (
              <span key={t} className="flex items-center gap-2">
                <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: rgb(c) }} />
                {t}
              </span>
            ))}
            <span>{"No tint: unobserved (not safe)."}</span>
          </div>

          <section aria-labelledby="route-log-title">
            <h3 id="route-log-title" className="text-[12px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">
              {"Event log"}
            </h3>
            <ol className="mt-1 space-y-0.5 text-[12px] text-[var(--mg-dim)]" data-testid="route-log">
              {[...m.events]
                .reverse()
                .slice(0, 8)
                .map((e, k) => (
                  <li key={`${e.version}-${e.type}-${k}`}>{`t+${Math.round(e.clockS / 60)} min · v${e.version} · ${e.type}${e.type === "observation" ? ` (${String(e.newCells)} cells, ${String(e.crewBlocked)} crew-blocked)` : ""}`}</li>
                ))}
            </ol>
          </section>

          <p className="text-[12px] text-[var(--mg-faint)]" data-testid="route-provenance">
            {"Real data: CTX DTM 20 m crop (heights unchanged), verified sample sites, Perseverance's historical traverse. Simulated: habitat, surveyed areas, rover and its model, hidden hazards, crew surface rules, decision weights. Route planning and the EVA model are adapted from Sol Atlas (Apache-2.0); see NOTICE."}
          </p>
        </>
      ) : null}
    </div>
  );
}
