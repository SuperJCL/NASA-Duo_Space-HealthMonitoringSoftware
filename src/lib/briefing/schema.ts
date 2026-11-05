import { z } from "zod";
import { IsoDate, RecordId } from "@/lib/evidence/schema";

/**
 * Location science briefings (BR-1). A briefing is a small, curated,
 * source-grounded summary of one real location. It is deliberately separate
 * from the scientific scenario: nothing here is an input to the decision
 * engine, and nothing here is a scientific review approval.
 *
 * Every item carries ONE classification, and classifications never mix:
 *  - measured: an instrument result or a documented rover operation, as the
 *    source reports it (historical record);
 *  - interpreted: the source's own (here: preliminary) interpretation;
 *  - open-question: an unresolved question stated by the source;
 *  - proposed-by-source: a future investigation the source itself discusses;
 *  - simulated-idea: an MDI-drafted suggestion. It is AI-drafted with review
 *    pending; it is not a NASA plan and has no location or ranking.
 */
export const Classification = z.enum(["measured", "interpreted", "open-question", "proposed-by-source", "simulated-idea"]);
export const Topic = z.enum(["why-here", "measured", "interpreted", "uncertain", "already-done", "next"]);
/** "sample": about this rock. "margin-unit": a statement about the whole unit (often shared verbatim across reports). */
export const Scope = z.enum(["sample", "margin-unit"]);

/** Allowed classifications per briefing topic. */
export const TOPIC_CLASSIFICATIONS: Record<z.infer<typeof Topic>, readonly z.infer<typeof Classification>[]> = {
  "why-here": ["measured", "interpreted"],
  measured: ["measured"],
  interpreted: ["interpreted"],
  uncertain: ["open-question"],
  "already-done": ["measured"],
  next: ["proposed-by-source", "simulated-idea", "measured"],
};

const PageLabel = z.string().regex(/^\d+-\d+$/, "page label such as 26-1");

export const BriefingCitation = z
  .object({
    sourceId: RecordId,
    sourceUrl: z.url(),
    quote: z.string().min(1).max(400),
    /** Report section heading the quote must lie in (null for non-report sources). */
    section: z.string().min(1).nullable(),
    /** Report page labels where the quote occurs (empty for non-report sources). */
    pages: z.array(PageLabel),
    /** Other sample reports in which the identical wording also occurs. */
    sharedWith: z.array(z.string().min(1)),
  })
  .strict();

const SourceStatement = z.object({ kind: z.literal("source-statement") }).strict();
const SimulatedIdea = z
  .object({
    kind: z.literal("mdi-simulated-idea"),
    // Only a human may change this; the agent never approves its own ideas.
    review: z.object({ draftedBy: z.literal("ai-agent"), status: z.literal("pending") }).strict(),
    addressesItemIds: z.array(RecordId).min(1),
    rationale: z.string().min(1),
  })
  .strict();

export const BriefingItem = z
  .object({
    id: RecordId,
    locationId: RecordId,
    topic: Topic,
    classification: Classification,
    scope: Scope,
    /** Concise paraphrase shown to the user; the quote is the evidence. */
    claim: z.string().min(1).max(300),
    sols: z.array(z.number().int().nonnegative()).optional(),
    citations: z.array(BriefingCitation).min(1),
    limitations: z.array(z.string().min(1)),
    provenance: z.discriminatedUnion("kind", [SourceStatement, SimulatedIdea]),
  })
  .strict();

const Located = {
  quote: z.string().min(1).max(400),
  section: z.string().min(1),
  pages: z.array(PageLabel).min(1),
  sharedWith: z.array(z.string().min(1)),
};

export const Briefing = z
  .object({
    id: RecordId,
    locationId: RecordId,
    title: z.string().min(1),
    subtitle: z.string().min(1),
    whyItMattersItemId: RecordId,
    keyQuestionItemId: RecordId,
    report: z
      .object({
        id: z.string().min(1),
        title: z.string().min(1),
        sourceId: RecordId,
        pagePrefix: z.string().regex(/^\d+$/),
        reportDate: IsoDate,
        reportDateQuote: z.string().min(1),
        /** Ordered section headings as printed; a section runs to the next heading. */
        sections: z.array(z.string().min(1)).min(2),
        otherReports: z.array(z.object({ id: z.string(), title: z.string(), pagePrefix: z.string().regex(/^\d+$/) }).strict()),
      })
      .strict(),
    items: z.array(BriefingItem).min(1),
    /** Statements that cannot be attributed reliably to this location: verified, documented, never shown as briefing content. */
    quarantine: z.array(z.object({ id: RecordId, ...Located, reason: z.string().min(1) }).strict()),
    /** Source typos and ambiguities, documented rather than silently corrected. */
    sourceNotes: z.array(z.object({ id: RecordId, kind: z.string().min(1), text: z.string().min(1), ...Located }).strict()),
  })
  .strict();

export type Briefing = z.infer<typeof Briefing>;
export type BriefingItem = z.infer<typeof BriefingItem>;
export type Classification = z.infer<typeof Classification>;
export type Topic = z.infer<typeof Topic>;
