export function AppHeader() {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-surface px-4 py-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight sm:text-lg">
          Mars Discovery Intelligence
        </h1>
        <span className="rounded border border-accent-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
          Prototype
        </span>
      </div>
      <p className="text-xs text-muted">
        Initial scope: Jezero Crater &middot; Margin Unit
      </p>
    </header>
  );
}
