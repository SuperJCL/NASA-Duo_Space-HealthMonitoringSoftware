const STYLES = {
  observed: { label: "Observed", className: "border-ok/60 text-ok" },
  interpreted: { label: "Interpreted", className: "border-sky-400/60 text-sky-300" },
  gap: { label: "Gap", className: "border-warn/60 text-warn" },
  assumed: { label: "Assumed", className: "border-violet-400/60 text-violet-300" },
  simulated: { label: "Simulated", className: "border-accent/70 text-accent" },
  later: { label: "Published later", className: "border-muted/60 text-muted" },
} as const;

export type EpistemicKind = keyof typeof STYLES;

/** Label that keeps the epistemic category of every record visible. */
export function EpistemicBadge({ kind, detail }: { kind: EpistemicKind; detail?: string }) {
  const style = STYLES[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider ${style.className}`}
    >
      {style.label}
      {detail ? ` · ${detail}` : ""}
    </span>
  );
}
