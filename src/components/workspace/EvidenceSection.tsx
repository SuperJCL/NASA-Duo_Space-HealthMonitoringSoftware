import type { ReactNode } from "react";
import type { Interpretation, Observation, Source } from "@/lib/evidence/schema";
import type { SnapshotGap } from "@/lib/evidence/snapshot";
import { Citations } from "./Citations";
import { EpistemicBadge } from "./EpistemicBadge";

type Props = {
  observations: readonly Observation[];
  interpretations: readonly Interpretation[];
  gaps: readonly SnapshotGap[];
  sourceById: ReadonlyMap<string, Source>;
};

export function ObservationCard({
  observation,
  sourceById,
  later = false,
}: {
  observation: Observation;
  sourceById: ReadonlyMap<string, Source>;
  later?: boolean;
}) {
  return (
    <li className="rounded-md border border-border bg-surface-raised p-3" data-record-id={observation.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        <EpistemicBadge kind="observed" detail={observation.platform} />
        {later ? <EpistemicBadge kind="later" /> : null}
        <span className="text-[11px] text-muted">
          {observation.mission} · {observation.instruments.join(", ")} · public {observation.availableFrom}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-medium">{observation.title}</p>
      <p className="mt-0.5 text-xs text-foreground/85">{observation.statement}</p>
      <Citations citations={observation.citations} sourceById={sourceById} />
    </li>
  );
}

export function EvidenceSection({ observations, interpretations, gaps, sourceById }: Props) {
  const observationTitle = new Map(observations.map((o) => [o.id, o.title]));
  const interpretationTitle = new Map(interpretations.map((i) => [i.id, i.title]));

  return (
    <>
      <Section title="Observations" count={observations.length}>
        {observations.length === 0 ? (
          <Empty>No observations were public on this date.</Empty>
        ) : (
          <ul className="space-y-2">
            {observations.map((o) => (
              <ObservationCard key={o.id} observation={o} sourceById={sourceById} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Interpretations" count={interpretations.length}>
        {interpretations.length === 0 ? (
          <Empty>No interpretations were published by this date.</Empty>
        ) : (
          <ul className="space-y-2">
            {interpretations.map((i) => (
              <li key={i.id} className="rounded-md border border-border bg-surface-raised p-3" data-record-id={i.id}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <EpistemicBadge kind="interpreted" />
                  <span className="text-[11px] text-muted">
                    {i.attributedTo} · public {i.availableFrom}
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-medium">{i.title}</p>
                <p className="mt-0.5 text-xs text-foreground/85">{i.claim}</p>
                {i.supportingObservationIds.length ? (
                  <p className="mt-1 text-[11px] text-muted">
                    Based on: {i.supportingObservationIds.map((id) => observationTitle.get(id) ?? id).join("; ")}
                  </p>
                ) : null}
                <Citations citations={i.citations} sourceById={sourceById} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Evidence gaps" count={gaps.length}>
        {gaps.length === 0 ? (
          <Empty>No evidence gaps were identified by this date.</Empty>
        ) : (
          <ul className="space-y-2">
            {gaps.map((g) => (
              <li key={g.id} className="rounded-md border border-border bg-surface-raised p-3" data-record-id={g.id}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <EpistemicBadge kind="gap" detail={g.origin.kind} />
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wider ${
                      g.status.state === "open" ? "text-warn" : "text-ok"
                    }`}
                  >
                    {g.status.state === "open" ? "Open" : "Addressed"}
                  </span>
                  <span className="text-[11px] text-muted">public {g.availableFrom}</span>
                </div>
                <p className="mt-1.5 text-sm font-medium">{g.question}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  Would help decide between:{" "}
                  {g.discriminatesInterpretationIds.map((id) => interpretationTitle.get(id) ?? id).join(" vs. ")}
                </p>
                {g.status.state === "addressed" ? (
                  <p className="mt-0.5 text-[11px] text-ok">
                    Addressed by: {g.status.byObservationIds.map((id) => observationTitle.get(id) ?? id).join("; ")}
                  </p>
                ) : null}
                {g.origin.kind === "cited" ? (
                  <Citations citations={g.origin.citations} sourceById={sourceById} />
                ) : (
                  <p className="mt-1 text-[11px] text-muted">Derived by rule: {g.origin.rule}</p>
                )}
              </li>
            ))}
          </ul>
        )}
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
          {title}
          {count !== undefined ? <span className="ml-1.5 font-normal text-muted">({count})</span> : null}
        </span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}
