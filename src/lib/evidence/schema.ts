import { z } from "zod";

/**
 * Zod schemas for curated evidence records. TypeScript types are inferred
 * from these schemas, so the runtime validation and the static types cannot
 * drift apart.
 *
 * Epistemic categories are separate record types (see
 * docs/PRODUCT_REQUIREMENTS.md §3). Two further distinctions (M3):
 *  - `relevance`: "local" records are explicitly about the target unit in
 *    their source; "regional-context" records describe the wider crater or
 *    region and must never be used as direct local evidence.
 *  - `stance`: an "interpretation" is an author's conclusion; a "hypothesis"
 *    is a candidate explanation still under consideration.
 *
 * Curated scientific judgements (task-gap links, discrimination assessments,
 * priority statements) carry a `review` record. Judgements drafted by an AI
 * agent are shown but do not produce scores until a human approves them.
 */

export const IsoDate = z.iso.date();
export const RecordId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lower-kebab-case id");

export const SourceKind = z.enum(["nasa", "usgs", "peer-reviewed", "abstract", "dataset"]);

export const Source = z
  .object({
    id: RecordId,
    title: z.string().min(1),
    publisher: z.string().min(1),
    authors: z.string().optional(),
    kind: SourceKind,
    url: z.url(),
    /** Documents to fetch when verifying quotes, if not `url` itself (e.g. PDFs behind a landing page). */
    fullTextUrls: z.array(z.url()).optional(),
    /** Date the source became public, as printed on it. */
    publishedOn: IsoDate,
    /** What `publishedOn` refers to, e.g. "release date", "online publication". */
    dateBasis: z.string().min(1),
    accessedOn: IsoDate,
  })
  .strict();

/** A pointer into a source with a verbatim supporting quote. */
export const Citation = z
  .object({
    sourceId: RecordId,
    quote: z.string().min(1).max(400),
    locator: z.string().optional(),
  })
  .strict();

export const Platform = z.enum(["orbital", "rover"]);
/** Tasks may also target Earth-laboratory analysis of returned samples. */
export const TaskPlatform = z.enum(["orbital", "rover", "lab"]);
export const Relevance = z.enum(["local", "regional-context"]);
export const Stance = z.enum(["interpretation", "hypothesis"]);

/** Human review state of a curated judgement. */
export const Review = z
  .object({
    draftedBy: z.enum(["ai-agent", "human"]),
    status: z.enum(["pending", "approved", "rejected"]),
    reviewedBy: z.string().min(1).optional(),
    reviewedOn: IsoDate.optional(),
    notes: z.string().min(1).optional(),
  })
  .strict()
  .refine((r) => r.status === "pending" || (r.reviewedBy && r.reviewedOn), {
    message: "approved/rejected judgements need reviewedBy and reviewedOn",
  });

export const Observation = z
  .object({
    id: RecordId,
    title: z.string().min(1),
    /** What was detected/measured/imaged, as reported. No inference. */
    statement: z.string().min(1),
    platform: Platform,
    relevance: Relevance,
    mission: z.string().min(1),
    instruments: z.array(z.string().min(1)).min(1),
    /** Acquisition date if known (informational only; never used for filtering). */
    observedOn: IsoDate.optional(),
    /** Public availability: the latest `publishedOn` among its cited sources. */
    availableFrom: IsoDate,
    /**
     * Gaps this observation supplies the evidence for (curated). A gap with a
     * visible addressing observation is no longer "open" in a snapshot.
     */
    addressesGapIds: z.array(RecordId).default([]),
    citations: z.array(Citation).min(1),
    /** MDI team note on how the record was curated (shown in the UI). */
    curationNote: z.string().min(1).optional(),
  })
  .strict();

export const Interpretation = z
  .object({
    id: RecordId,
    title: z.string().min(1),
    claim: z.string().min(1),
    stance: Stance,
    relevance: Relevance,
    attributedTo: z.string().min(1),
    /** Local observations the claim rests on (must be local and not later). */
    supportingObservationIds: z.array(RecordId).default([]),
    /** Regional-context records related to this claim (never counted as local support). */
    contextRecordIds: z.array(RecordId).default([]),
    /** Publication date (latest cited source). */
    availableFrom: IsoDate,
    citations: z.array(Citation).min(1),
    curationNote: z.string().min(1).optional(),
  })
  .strict();

export const GapOrigin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cited"), citations: z.array(Citation).min(1) }).strict(),
  z.object({ kind: z.literal("derived"), rule: z.string().min(1) }).strict(),
]);

/** A cited statement that resolving a gap is scientifically important. */
export const PriorityStatement = z
  .object({
    statement: z.string().min(1),
    citations: z.array(Citation).min(1),
    review: Review,
  })
  .strict();

export const EvidenceGap = z
  .object({
    id: RecordId,
    /** Short label used in explanations. */
    title: z.string().min(1).max(60),
    question: z.string().min(1),
    relevance: Relevance,
    /**
     * Competing local hypotheses/interpretations that resolving this gap could
     * bear on. May include records published later; snapshots drop those.
     */
    discriminatesInterpretationIds: z.array(RecordId).default([]),
    availableFrom: IsoDate,
    origin: GapOrigin,
    /** Optional cited priority; its quotes must be public by `availableFrom`. */
    priority: PriorityStatement.optional(),
    curationNote: z.string().min(1).optional(),
  })
  .strict();

export const Assumption = z
  .object({
    id: RecordId,
    /** "scenario": applies to every recommendation; "task": only when a ranked task uses it. */
    scope: z.enum(["scenario", "task"]).default("task"),
    statement: z.string().min(1),
    rationale: z.string().min(1),
    citations: z.array(Citation).default([]),
  })
  .strict();

export const SimulatedResource = z
  .object({
    id: RecordId,
    name: z.string().min(1),
    unit: z.string().min(1),
    description: z.string().min(1),
    /** Default simulated budget for the scenario (users may change it as a constraint). */
    budget: z.number().positive(),
    simulated: z.literal(true),
  })
  .strict();

/** Curated link: why a task addresses a gap. */
export const GapLink = z
  .object({
    gapId: RecordId,
    rationale: z.string().min(1),
    citations: z.array(Citation).default([]),
    /** Required when citations are given: latest cited source date. */
    availableFrom: IsoDate.optional(),
    review: Review,
  })
  .strict();

export const CandidateTask = z
  .object({
    id: RecordId,
    title: z.string().min(1),
    description: z.string().min(1),
    platform: TaskPlatform,
    instruments: z.array(z.string().min(1)).min(1),
    addresses: z.array(GapLink).min(1),
    /** Simulated costs, keyed by SimulatedResource id. A missing cost is "unknown", never 0. */
    costs: z.record(RecordId, z.number().nonnegative()),
    assumptionIds: z.array(RecordId).default([]),
  })
  .strict();

/** How a possible result of a task would bear on competing hypotheses. */
export const DiscriminationOutcome = z
  .object({
    ifObserved: z.string().min(1),
    favors: z.array(RecordId).default([]),
    weakens: z.array(RecordId).default([]),
  })
  .strict();

/**
 * Curated assessment of a task's power to discriminate between hypotheses.
 * Only approved assessments produce a discrimination score.
 */
export const DiscriminationAssessment = z
  .object({
    id: RecordId,
    taskId: RecordId,
    hypothesisIds: z.array(RecordId).min(2),
    outcomes: z.array(DiscriminationOutcome).min(1),
    rationale: z.string().min(1),
    citations: z.array(Citation).default([]),
    /** Latest of: cited source dates and the publication dates of the hypotheses. */
    availableFrom: IsoDate,
    review: Review,
  })
  .strict();

export const Scenario = z
  .object({
    id: RecordId,
    title: z.string().min(1),
    site: z
      .object({
        name: z.string().min(1),
        parentFeature: z.string().min(1),
        description: z.string().min(1),
        citations: z.array(Citation).min(1),
      })
      .strict(),
    defaultSnapshotDate: IsoDate,
    /** Earliest selectable snapshot date. */
    minSnapshotDate: IsoDate,
    observations: z.array(Observation),
    interpretations: z.array(Interpretation),
    gaps: z.array(EvidenceGap),
    assumptions: z.array(Assumption),
    resources: z.array(SimulatedResource).min(1),
    tasks: z.array(CandidateTask).min(1),
    discriminationAssessments: z.array(DiscriminationAssessment).default([]),
    /** Limitations that apply to the whole scenario, shown with every recommendation. */
    limitations: z.array(z.string().min(1)),
  })
  .strict();

export const SourceList = z.array(Source).min(1);

export type Source = z.infer<typeof Source>;
export type Citation = z.infer<typeof Citation>;
export type Platform = z.infer<typeof Platform>;
export type TaskPlatform = z.infer<typeof TaskPlatform>;
export type Relevance = z.infer<typeof Relevance>;
export type Review = z.infer<typeof Review>;
export type Observation = z.infer<typeof Observation>;
export type Interpretation = z.infer<typeof Interpretation>;
export type EvidenceGap = z.infer<typeof EvidenceGap>;
export type PriorityStatement = z.infer<typeof PriorityStatement>;
export type Assumption = z.infer<typeof Assumption>;
export type SimulatedResource = z.infer<typeof SimulatedResource>;
export type GapLink = z.infer<typeof GapLink>;
export type CandidateTask = z.infer<typeof CandidateTask>;
export type DiscriminationAssessment = z.infer<typeof DiscriminationAssessment>;
export type Scenario = z.infer<typeof Scenario>;

export const isApproved = (review: Review) => review.status === "approved";
