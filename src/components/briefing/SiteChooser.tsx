/**
 * Starting point (BR-2): what the app does, and the real sample sites to
 * choose from. Selecting a site here does the same as clicking its map pin.
 */
export function SiteChooser({
  sites,
  onSelect,
}: {
  sites: readonly { id: string; name: string; hasBriefing: boolean }[];
  onSelect: (id: string) => void;
}) {
  return (
    <section className="px-4 py-3" aria-labelledby="chooser-title" data-testid="site-chooser">
      <h2 id="chooser-title" className="text-base font-semibold">
        {"Choose a real Mars sample site"}
      </h2>
      <p className="mt-1 text-xs">
        {"See what NASA’s Perseverance rover measured at a location in Jezero crater, what is still unknown about the rock, what was already done there, and what scientists propose next, with every point traced to its published source."}
      </p>
      <ul className="mt-3 space-y-1.5">
        {sites.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              data-testid={`choose-${s.id}`}
              className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-surface-raised ${
                s.hasBriefing ? "border-sky-300/70" : "border-border"
              }`}
            >
              <span className="font-medium">{s.name}</span>
              <span className={`text-[11px] ${s.hasBriefing ? "text-sky-200" : "text-muted"}`}>{s.hasBriefing ? "Science briefing" : "Location details only"}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted">{"You can also click a labelled site on the map."}</p>
    </section>
  );
}
