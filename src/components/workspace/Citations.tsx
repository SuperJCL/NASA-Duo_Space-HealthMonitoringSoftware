import type { Citation, Source } from "@/lib/evidence/schema";

/** Verbatim quotes with links to their sources. */
export function Citations({
  citations,
  sourceById,
}: {
  citations: readonly Citation[];
  sourceById: ReadonlyMap<string, Source>;
}) {
  if (citations.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2">
      {citations.map((c, index) => {
        const source = sourceById.get(c.sourceId);
        return (
          <li key={`${c.sourceId}-${index}`} className="border-l-2 border-border pl-2">
            <blockquote className="text-xs italic text-foreground/85">&ldquo;{c.quote}&rdquo;</blockquote>
            {source ? (
              <p className="mt-0.5 text-[11px] text-muted">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-border underline-offset-2 hover:text-foreground"
                >
                  {source.title}
                </a>{" "}
                — {source.publisher}, {source.publishedOn}
                {c.locator ? `, ${c.locator}` : ""}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
