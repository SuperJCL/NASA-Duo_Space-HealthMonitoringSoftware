import type { Briefing } from "@/lib/briefing/schema";
import { CLASSIFICATION_LABEL } from "@/lib/briefing/view";

/** "Methods & audit" for a briefing: how it was built, verified and what was left out. */
export function BriefingMethods({ briefing }: { briefing: Briefing }) {
  const citations = briefing.items.flatMap((i) => i.citations);
  const shared = briefing.items.filter((i) => i.citations.some((c) => c.sharedWith.length));
  const counts = Object.entries(CLASSIFICATION_LABEL).map(([k, label]) => `${label}: ${briefing.items.filter((i) => i.classification === k).length}`);
  return (
    <div className="space-y-3 px-4 py-3 text-xs" data-testid="briefing-methods">
      <section>
        <h3 className="text-sm font-semibold">{"How this briefing was built"}</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>{`${briefing.items.length} points, each quoting its source verbatim (${citations.length} quotes). Every point has exactly one label.`}</li>
          <li>{counts.join(" · ")}</li>
          <li>{`Report quotes are verified inside the ${briefing.report.title} report (pages ${briefing.report.pagePrefix}-N) and inside the stated section, not just anywhere in the PDS volume (npm run verify:briefing).`}</li>
          <li>{"The briefing is not an input to the ranking engine and contains no scientific review approvals. Simulated ideas are AI-drafted and await review."}</li>
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-semibold">{"Wording shared with other sample reports"}</h3>
        <p className="mt-1 text-muted">{"Some sentences appear word for word in another sample’s report. They are used only as Margin-unit-wide statements:"}</p>
        <ul className="mt-1 list-disc pl-4" data-testid="methods-shared">
          {shared.map((i) => (
            <li key={i.id}>{`${i.claim} (also in ${[...new Set(i.citations.flatMap((c) => c.sharedWith))].join(", ")})`}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-semibold">{"Left out (cannot be attributed reliably)"}</h3>
        <ul className="mt-1 list-disc pl-4" data-testid="methods-quarantine">
          {briefing.quarantine.map((q) => (
            <li key={q.id}>{`“${q.quote}” (p. ${q.pages.join("–")}): ${q.reason}`}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-semibold">{"Source notes (kept as printed)"}</h3>
        <ul className="mt-1 list-disc pl-4" data-testid="methods-notes">
          {briefing.sourceNotes.map((n) => (
            <li key={n.id}>{n.text}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
