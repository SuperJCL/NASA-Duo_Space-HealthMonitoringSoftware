import type { ReactNode } from "react";
import type { Interpretation, Observation, Source } from "@/lib/evidence/schema";
import type { SnapshotGap } from "@/lib/evidence/snapshot";
import { Citations } from "./Citations";
import { EpistemicBadge, ReviewBadge } from "./EpistemicBadge";

type Props = {
  observations: readonly Observation[];
  interpretations: readonly Interpretation[];
  gaps: readonly SnapshotGap[];
  sourceById: ReadonlyMap<string, Source>;
};

/** Date labels: observation date vs public availability vs publication vs reveal. */
export function DateLine({ parts }: { parts: (string | false | undefined)[] }) {
  return <span className="text-[11px] text-muted">{parts.filter(Boolean).join(" · ")}</span>;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function ObservationCard({
  observation: o,
  sourceById,
  revealedAfter,
}: {
  observation: Observation;
  sourceById: ReadonlyMap<string, Source>;
  /** Snapshot date, when shown in the retrospective reveal. */
  revealedAfter?: string;
}) {
  const badge =
    o.relevance === "regional-context" ? (
      <EpistemicBadge kind="context" detail={o.platform} />
    ) : o.platform === "rover" ? (
      <EpistemicBadge kind="measured" detail="rover" />
    ) : (
      <EpistemicBadge kind="observed" detail="orbital" />
    );
  return (
    <li className="rounded-md border border-border bg-surface-raised p-3" data-record-id={o.id} data-relevance={o.relevance}>
      <div className="flex flex-wrap items-center gap-1.5">
        {badge}
        {revealedAfter ? <EpistemicBadge kind="later" /> : null}
        <DateLine
          parts={[
            `${o.mission} · ${o.instruments.join(", ")}`,
            o.observedOn && `observed ${o.observedOn}`,
            `public ${o.availableFrom}`,
            revealedAfter && `revealed: ${daysBetween(revealedAfter, o.availableFrom)} days after snapshot`,
          ]}
        />
      </div>
      <p className="mt-1.5 text-sm font-medium">{o.title}</p>
      <p className="mt-0.5 text-xs text-foreground/85">{o.statement}</p>
      <Citations citations={o.citations} sourceById={sourceById} />
      <CurationNote note={o.curationNote} />
    </li>
  );
}

function InterpretationCard({
  i,
  titleOf,
  sourceById,
}: {
  i: Interpretation;
  titleOf: (id: string) => string;
  sourceById: ReadonlyMap<string, Source>;
}) {
  return (
    <li className="rounded-md border border-border bg-surface-raised p-3" data-record-id={i.id} data-relevance={i.relevance}>
      <div className="flex flex-wrap items-center gap-1.5">
        {i.relevance === "regional-context" ? <EpistemicBadge kind="context" detail={i.stance} /> : null}
        <EpistemicBadge kind={i.stance === "hypothesis" ? "hypothesis" : "interpreted"} />
        <DateLine parts={[i.attributedTo, `published ${i.availableFrom}`]} />
      </div>
      <p className="mt-1.5 text-sm font-medium">{i.title}</p>
      <p className="mt-0.5 text-xs text-foreground/85">{i.claim}</p>
      {i.supportingObservationIds.length ? (
        <p className="mt-1 text-[11px] text-muted">{`Based on: ${i.supportingObservationIds.map(titleOf).join("; ")}`}</p>
      ) : null}
      {i.contextRecordIds.length ? (
        <p className="mt-1 text-[11px] text-muted">
          {`Regional context (not local support): ${i.contextRecordIds.map(titleOf).join("; ")}`}
        </p>
      ) : null}
      <Citations citations={i.citations} sourceById={sourceById} />
      <CurationNote note={i.curationNote} />
    </li>
  );
}

function GapCard({
  g,
  titleOf,
  sourceById,
}: {
  g: SnapshotGap;
  titleOf: (id: string) => string;
  sourceById: ReadonlyMap<string, Source>;
}) {
  return (
    <li className="rounded-md border border-border bg-surface-raised p-3" data-record-id={g.id} data-relevance={g.relevance}>
      <div className="flex flex-wrap items-center gap-1.5">
        {g.relevance === "regional-context" ? <EpistemicBadge kind="context" /> : null}
        <EpistemicBadge kind="gap" detail={g.origin.kind} />
        <span className={`font-mono text-[10px] uppercase tracking-wider ${g.status.state === "open" ? "text-warn" : "text-ok"}`}>
          {g.status.state === "open" ? "Open" : "Addressed"}
        </span>
        <DateLine parts={[`identified ${g.availableFrom}`]} />
      </div>
      <p className="mt-1.5 text-sm font-medium">{g.title}</p>
      <p className="mt-0.5 text-xs text-foreground/85">{g.question}</p>
      {g.discriminatesInterpretationIds.length ? (
        <p className="mt-0.5 text-[11px] text-muted">
          {`Competing hypotheses it concerns: ${g.discriminatesInterpretationIds.map(titleOf).join(" vs. ")}`}
        </p>
      ) : null}
      {g.status.state === "addressed" ? (
        <p className="mt-0.5 text-[11px] text-ok">{`Addressed by: ${g.status.byObservationIds.map(titleOf).join("; ")}`}</p>
      ) : null}
      {g.origin.kind === "cited" ? (
        <Citations citations={g.origin.citations} sourceById={sourceById} />
      ) : (
        <p className="mt-1 text-[11px] text-muted">{`Derived by rule: ${g.origin.rule}`}</p>
      )}
      {g.priority ? (
        <div className="mt-2 rounded border border-border px-2 py-1.5">
          <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <EpistemicBadge kind="curated" detail="priority" /> <ReviewBadge review={g.priority.review} />
          </p>
          <p className="mt-1 text-[11px] text-foreground/85">{g.priority.statement}</p>
          <Citations citations={g.priority.citations} sourceById={sourceById} />
        </div>
      ) : null}
      <CurationNote note={g.curationNote} />
    </li>
  );
}

export function EvidenceSection({ observations, interpretations, gaps, sourceById }: Props) {
  const titles = new Map<string, string>([
    ...observations.map((o) => [o.id, o.title] as const),
    ...interpretations.map((i) => [i.id, i.title] as const),
  ]);
  const titleOf = (id: string) => titles.get(id) ?? id;
  const local = <T extends { relevance: string }>(r: T) => r.relevance === "local";
  const regional = <T extends { relevance: string }>(r: T) => r.relevance === "regional-context";
  const contextCount =
    observations.filter(regional).length + interpretations.filter(regional).length + gaps.filter(regional).length;

  return (
    <>
      <Section title="Observations (margin unit)" count={observations.filter(local).length}>
        <p className="mb-2 text-[11px] text-muted">
          Only records whose source places them in the margin unit. Orbital observations and rover in-situ measurements are
          labelled separately.
        </p>
        {observations.filter(local).length === 0 ? (
          <Empty>No margin-unit observations were public on this date.</Empty>
        ) : (
          <ul className="space-y-2">
            {observations.filter(local).map((o) => (
              <ObservationCard key={o.id} observation={o} sourceById={sourceById} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Hypotheses & interpretations" count={interpretations.filter(local).length}>
        {interpretations.filter(local).length === 0 ? (
          <Empty>No hypotheses or interpretations were published by this date.</Empty>
        ) : (
          <ul className="space-y-2">
            {interpretations.filter(local).map((i) => (
              <InterpretationCard key={i.id} i={i} titleOf={titleOf} sourceById={sourceById} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Evidence gaps" count={gaps.filter(local).length}>
        {gaps.filter(local).length === 0 ? (
          <Empty>No evidence gaps were identified by this date.</Empty>
        ) : (
          <ul className="space-y-2">
            {gaps.filter(local).map((g) => (
              <GapCard key={g.id} g={g} titleOf={titleOf} sourceById={sourceById} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Regional geological context" count={contextCount} defaultOpen={false}>
        <p className="mb-2 text-[11px] text-muted">
          Crater-wide or regional records. Shown for context; never counted as direct margin-unit evidence or as a competing
          hypothesis, and excluded from gap coverage.
        </p>
        <ul className="space-y-2" data-testid="regional-context">
          {observations.filter(regional).map((o) => (
            <ObservationCard key={o.id} observation={o} sourceById={sourceById} />
          ))}
          {interpretations.filter(regional).map((i) => (
            <InterpretationCard key={i.id} i={i} titleOf={titleOf} sourceById={sourceById} />
          ))}
          {gaps.filter(regional).map((g) => (
            <GapCard key={g.id} g={g} titleOf={titleOf} sourceById={sourceById} />
          ))}
        </ul>
      </Section>
    </>
  );
}

export function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group border-b border-border px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
        <span>
          <span>{title}</span>
          {count !== undefined ? <span className="ml-1.5 font-normal text-muted">{`(${count})`}</span> : null}
        </span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function CurationNote({ note }: { note?: string }) {
  if (!note) return null;
  return (
    <p className="mt-2 rounded bg-background/60 px-2 py-1 text-[11px] text-muted">
      <span className="font-semibold">{"MDI curation note: "}</span>
      <span>{note}</span>
    </p>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}
