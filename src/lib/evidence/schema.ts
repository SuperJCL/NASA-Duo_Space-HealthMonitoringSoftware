import { z } from "zod";

/**
 * Zod schemas for curated evidence records. TypeScript types are inferred
 * from these schemas, so the runtime validation and the static types cannot
 * drift apart.
 *
 * Epistemic categories are separate record types (see
 * docs/PRODUCT_REQUIREMENTS.md §3): Observation, Interpretation, EvidenceGap,
 * Assumption, SimulatedResource. Nothing here is an LLM output.
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

export const Observation = z
  .object({
    id: RecordId,
    title: z.string().min(1),
    /** What was detected/measured/imaged, as reported. No inference. */
    statement: z.string().min(1),
    platform: Platform,
    mission: z.string().min(1),
    instruments: z.array(z.string().min(1)).min(1),
    /** Acquisition date if known (informational only; never used for filtering). */
    observedOn: IsoDate.optional(),
    /** Date the observation became public (earliest cited source). */
    availableFrom: IsoDate,
    /** Evidence gaps this observation bears on (used for retrospective review). */
    addressesGapIds: z.array(RecordId).default([]),
    citations: z.array(Citation).min(1),
  })
  .strict();

export const Interpretation = z
  .object({
    id: RecordId,
    title: z.string().min(1),
    claim: z.string().min(1),
    attributedTo: z.string().min(1),
    supportingObservationIds: z.array(RecordId).default([]),
    availableFrom: IsoDate,
    citations: z.array(Citation).min(1),
  })
  .strict();

export const GapOrigin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cited"), citations: z.array(Citation).min(1) }).strict(),
  z.object({ kind: z.literal("derived"), rule: z.string().min(1) }).strict(),
]);

export const EvidenceGap = z
  .object({
    id: RecordId,
    question: z.string().min(1),
    /** Competing interpretations that resolving this gap could tell apart. */
    discriminatesInterpretationIds: z.array(RecordId).min(1),
    availableFrom: IsoDate,
    origin: GapOrigin,
  })
  .strict();

export const Assumption = z
  .object({
    id: RecordId,
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
    /** Total simulated budget for the scenario. */
    budget: z.number().positive(),
    simulated: z.literal(true),
  })
  .strict();

export const CandidateTask = z
  .object({
    id: RecordId,
    title: z.string().min(1),
    description: z.string().min(1),
    platform: Platform,
    instruments: z.array(z.string().min(1)).min(1),
    addressesGapIds: z.array(RecordId).min(1),
    /** Simulated costs, keyed by SimulatedResource id. */
    costs: z.record(RecordId, z.number().nonnegative()),
    assumptionIds: z.array(RecordId).default([]),
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
    /** Limitations that apply to the whole scenario, shown with every recommendation. */
    limitations: z.array(z.string().min(1)),
  })
  .strict();

export const SourceList = z.array(Source).min(1);

export type Source = z.infer<typeof Source>;
export type Citation = z.infer<typeof Citation>;
export type Platform = z.infer<typeof Platform>;
export type Observation = z.infer<typeof Observation>;
export type Interpretation = z.infer<typeof Interpretation>;
export type EvidenceGap = z.infer<typeof EvidenceGap>;
export type Assumption = z.infer<typeof Assumption>;
export type SimulatedResource = z.infer<typeof SimulatedResource>;
export type CandidateTask = z.infer<typeof CandidateTask>;
export type Scenario = z.infer<typeof Scenario>;
