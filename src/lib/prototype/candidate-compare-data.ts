/**
 * Server-side loader for the candidate comparison: reads the comparison
 * summaries and the SCI-1 evidence, checks them, and returns plain text for
 * the client. Imported only by the Mission Glass page (a Server Component),
 * so neither JSON file is sent to the browser. Never imported by the
 * decision engine or the evidence loader.
 */
import compareJson from "@/data/prototype/candidate-compare.json";
import sci1Json from "@/data/scenarios/jezero-margin-unit.sci1-proposals.json";
import type { Source } from "@/lib/evidence/schema";
import { Sci1Proposals } from "@/lib/evidence/sci1-proposals";
import { buildCompareView, CandidateCompareData, type CompareView } from "./candidate-compare";

export function loadCandidateCompare(args: { asOf: string; sources: readonly Source[]; actionTaskIds: readonly string[] }): CompareView | null {
  return buildCompareView({ data: CandidateCompareData.parse(compareJson), sci1: Sci1Proposals.parse(sci1Json), ...args });
}
