import Link from "next/link";

export function AppHeader() {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-surface px-4 py-2">
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight sm:text-lg">Mars Discovery Intelligence</h1>
        <span className="rounded border border-accent-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">Prototype</span>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted">Research workspace &middot; Jezero crater sample-site science briefings</p>
        <Link href="/" className="rounded border border-border px-2 py-1 text-xs hover:border-accent-muted" data-testid="link-mission-glass">
          &larr; Mission Glass
        </Link>
      </div>
    </header>
  );
}
