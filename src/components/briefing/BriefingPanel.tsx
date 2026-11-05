"use client";

import { useState, type ReactNode } from "react";
import type { BriefingLine, BriefingView } from "@/lib/briefing/view";

/**
 * Science briefing for one location (BR-2). Concise by default: one line per
 * point, with the exact quote, report page and limitations one click away.
 * Every changing text is the sole child of its element (translation-safe).
 */
const BADGE: Record<BriefingLine["classification"], string> = {
  measured: "border-sky-300/60 text-sky-200",
  interpreted: "border-violet-300/60 text-violet-200",
  "open-question": "border-foreground/70 text-foreground",
  "proposed-by-source": "border-stone-300/60 text-stone-200",
  "simulated-idea": "border-accent/70 text-accent",
};

function Badge({ line }: { line: BriefingLine }) {
  return (
    <span className={`inline-flex shrink-0 rounded border px-1 py-px font-mono text-[9px] uppercase tracking-wider ${BADGE[line.classification]}`} data-testid="line-badge">
      {line.badge}
    </span>
  );
}

function SourceDetails({ line, showLimitations }: { line: BriefingLine; showLimitations: boolean }) {
  return (
    <div className="mt-1 space-y-1.5 rounded border border-border bg-background p-2 text-[11px]" data-testid="line-source">
      {line.sources.map((s, n) => (
        <figure key={n}>
          <blockquote className="border-l-2 border-border pl-2 italic text-foreground/90">{`“${s.quote}”`}</blockquote>
          <figcaption className="mt-0.5 text-muted">
            <span>{s.where}</span>
            <span>{" · "}</span>
            <a href={s.url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
              {"open source"}
            </a>
          </figcaption>
        </figure>
      ))}
      {showLimitations && line.limitations.length ? (
        <ul className="list-disc pl-4 text-muted">
          {line.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Line({
  line,
  emphasis = false,
  conditionsInline = false,
  badge = false,
}: {
  line: BriefingLine;
  emphasis?: boolean;
  conditionsInline?: boolean;
  /** Per-line label; sections that hold one classification state it in their heading instead. */
  badge?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-1" data-item-id={line.id} data-classification={line.classification}>
      <div className="flex items-start gap-2">
        <p className={`min-w-0 flex-1 ${emphasis ? "text-sm" : "text-xs"}`}>{line.claim}</p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] text-muted hover:bg-surface-raised hover:text-foreground"
          data-testid="source-toggle"
        >
          {open ? "Hide source" : "Source"}
        </button>
      </div>
      {badge || line.scope === "margin-unit" ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {badge ? <Badge line={line} /> : null}
          {line.scope === "margin-unit" ? <span className="text-[10px] text-muted">{"Margin-unit-wide statement"}</span> : null}
        </div>
      ) : null}
      {conditionsInline && line.limitations.length ? (
        <ul className="mt-1 flex flex-wrap gap-1" data-testid="line-conditions">
          {line.limitations.map((l) => (
            <li key={l} className="rounded border border-warn/60 px-1 py-px text-[10px] text-warn">
              {l}
            </li>
          ))}
        </ul>
      ) : null}
      {open ? <SourceDetails line={line} showLimitations={!conditionsInline} /> : null}
    </li>
  );
}

function Block({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="border-t border-border px-4 py-2.5" data-testid={testId} aria-label={title}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function BriefingPanel({
  view,
  onClose,
  onShowMethods,
  onShowAdvanced,
}: {
  view: BriefingView;
  onClose: () => void;
  onShowMethods: () => void;
  onShowAdvanced: () => void;
}) {
  return (
    <article aria-labelledby="briefing-title" data-testid="briefing" data-briefing-id={view.id}>
      <header className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wider text-sky-200">{"Science briefing · verified historical sample site"}</p>
            <h2 id="briefing-title" className="text-lg font-semibold leading-tight">
              {view.title}
            </h2>
            <p className="text-xs text-muted">{view.subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-raised" aria-label="Close briefing">
            {"✕"}
          </button>
        </div>
      </header>

      <Block title="Why does this location matter?" testId="briefing-why">
        <ul>
          {view.whyItMatters.map((l, n) => (
            <Line key={l.id} line={l} emphasis={n === 0} badge />
          ))}
        </ul>
      </Block>

      <section className="mx-4 my-2 rounded-lg border-2 border-foreground/80 bg-surface-raised px-3 py-2.5" data-testid="key-question" aria-labelledby="key-question-title">
        <h3 id="key-question-title" className="text-[11px] font-semibold uppercase tracking-wider">
          {"Still unknown"}
        </h3>
        <ul>
          <Line line={view.keyQuestion} emphasis badge />
        </ul>
        {view.otherQuestions.length ? (
          <div className="mt-1 border-t border-border pt-1">
            <p className="text-[10px] text-muted">{"Also open, across the whole Margin unit:"}</p>
            <ul>
              {view.otherQuestions.map((l) => (
                <Line key={l.id} line={l} />
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <Block title="What was measured here · as reported by the instruments" testId="briefing-measured">
        <ul className="divide-y divide-border/60">
          {view.measured.map((l) => (
            <Line key={l.id} line={l} />
          ))}
        </ul>
      </Block>

      <Block title="What the science team thinks · preliminary interpretation" testId="briefing-interpreted">
        <ul className="divide-y divide-border/60">
          {view.interpreted.map((l) => (
            <Line key={l.id} line={l} />
          ))}
        </ul>
      </Block>

      <Block title="Already done here · historical rover operations" testId="briefing-done">
        <ol className="divide-y divide-border/60">
          {view.alreadyDone.map((l) => (
            <Line key={l.id} line={l} />
          ))}
        </ol>
        <p className="mt-1 text-[11px] text-muted">{"Imaging, abrasion, drilling and sealing are complete; the briefing does not suggest repeating them."}</p>
      </Block>

      <Block title="What the source proposes next" testId="briefing-next">
        <p className="mt-0.5 text-[11px] text-muted">{"Discussed in the report. These are not approved NASA missions."}</p>
        <ul className="divide-y divide-border/60">
          {view.proposed.map((l) => (
            <Line key={l.id} line={l} conditionsInline badge />
          ))}
          {view.status.map((l) => (
            <Line key={l.id} line={l} badge />
          ))}
        </ul>
        <div className="mt-2 rounded border border-accent/50 px-2 py-1.5" data-testid="briefing-simulated">
          <p className="text-[11px] font-semibold text-accent">{"Simulated ideas (MDI): not NASA plans, not reviewed by a scientist"}</p>
          <ul>
            {view.simulated.map((l) => (
              <Line key={l.id} line={l} />
            ))}
          </ul>
        </div>
      </Block>

      <Block title={`Is the rover at ${view.title} now?`} testId="briefing-rover">
        <p className="mt-0.5 text-xs">{view.roverNote}</p>
      </Block>

      <footer className="flex flex-wrap gap-2 border-t border-border px-4 py-3 text-xs">
        <a href={view.report.url} target="_blank" rel="noreferrer" className="rounded border border-border px-2 py-1 hover:bg-surface-raised" data-testid="briefing-report-link">
          {`Original report (${view.report.date}, PDS PDF, about 190 MB)`}
        </a>
        <button type="button" onClick={onShowMethods} className="rounded border border-border px-2 py-1 hover:bg-surface-raised" data-testid="open-methods">
          {"Methods & audit"}
        </button>
        <button type="button" onClick={onShowAdvanced} className="rounded border border-border px-2 py-1 hover:bg-surface-raised">
          {"Advanced ranking workspace"}
        </button>
      </footer>
    </article>
  );
}
