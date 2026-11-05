import { STEPS } from "./steps";

/**
 * Five-step navigation indicator. Every step is a real button (keyboard and
 * screen-reader operable); the current one carries aria-current="step".
 */
export function Stepper({ current, onSelect }: { current: number; onSelect: (index: number) => void }) {
  return (
    <nav aria-label="Investigation steps" className="overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1">
        {STEPS.map((s, i) => {
          const active = i === current;
          const done = i < current;
          return (
            <li key={s.id} className="flex items-center gap-1">
              {i > 0 ? <span aria-hidden className="h-px w-3 bg-border sm:w-5" /> : null}
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={active ? "step" : undefined}
                data-testid={`step-${s.id}`}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  active
                    ? "border-accent bg-accent text-background"
                    : done
                      ? "border-accent-muted text-foreground hover:bg-surface-raised"
                      : "border-border text-muted hover:bg-surface-raised"
                }`}
              >
                <span className="font-mono">{`${i + 1}`}</span>
                <span>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
