/**
 * SYNTHETIC TEST FIXTURE — NOT SCIENTIFIC DATA.
 *
 * Abstract placeholder records ("Observation A", "example.org") used only to
 * exercise the schema, integrity checks, snapshot filter and decision engine.
 * Never import this from application code.
 */
import type { Scenario, Source } from "@/lib/evidence/schema";

export const syntheticSources: Source[] = [
  {
    id: "src-2010",
    title: "Synthetic source 2010",
    publisher: "Test",
    kind: "peer-reviewed",
    url: "https://example.org/2010",
    publishedOn: "2010-01-01",
    dateBasis: "fixture",
    accessedOn: "2026-11-04",
  },
  {
    id: "src-2015",
    title: "Synthetic source 2015",
    publisher: "Test",
    kind: "peer-reviewed",
    url: "https://example.org/2015",
    publishedOn: "2015-06-01",
    dateBasis: "fixture",
    accessedOn: "2026-11-04",
  },
  {
    id: "src-2024",
    title: "Synthetic source 2024",
    publisher: "Test",
    kind: "nasa",
    url: "https://example.org/2024",
    publishedOn: "2024-03-01",
    dateBasis: "fixture",
    accessedOn: "2026-11-04",
  },
];

const cite = (sourceId: string) => [{ sourceId, quote: "fixture quote" }];

export function syntheticScenario(): Scenario {
  return {
    id: "synthetic",
    title: "Synthetic scenario",
    site: { name: "Site X", parentFeature: "Crater Y", description: "fixture", citations: cite("src-2010") },
    defaultSnapshotDate: "2020-01-01",
    minSnapshotDate: "2010-01-01",
    observations: [
      {
        id: "obs-orbital-a",
        title: "Orbital observation A",
        statement: "fixture",
        platform: "orbital",
        mission: "Orbiter",
        instruments: ["Spectrometer"],
        availableFrom: "2010-01-01",
        addressesGapIds: [],
        citations: cite("src-2010"),
      },
      {
        id: "obs-rover-later",
        title: "Rover observation (later)",
        statement: "fixture",
        platform: "rover",
        mission: "Rover",
        instruments: ["Arm instrument"],
        availableFrom: "2024-03-01",
        addressesGapIds: ["gap-origin", "gap-later-only"],
        citations: cite("src-2024"),
      },
    ],
    interpretations: [
      {
        id: "interp-1",
        title: "Hypothesis 1",
        claim: "fixture",
        attributedTo: "Team 1",
        supportingObservationIds: ["obs-orbital-a"],
        availableFrom: "2010-01-01",
        citations: cite("src-2010"),
      },
      {
        id: "interp-2",
        title: "Hypothesis 2",
        claim: "fixture",
        attributedTo: "Team 2",
        supportingObservationIds: ["obs-orbital-a"],
        availableFrom: "2015-06-01",
        citations: cite("src-2015"),
      },
    ],
    gaps: [
      {
        id: "gap-origin",
        question: "Which hypothesis is right?",
        discriminatesInterpretationIds: ["interp-1", "interp-2"],
        availableFrom: "2015-06-01",
        origin: { kind: "cited", citations: cite("src-2015") },
      },
      {
        id: "gap-context",
        question: "Context question",
        discriminatesInterpretationIds: ["interp-1"],
        availableFrom: "2015-06-01",
        origin: { kind: "derived", rule: "fixture rule" },
      },
      {
        id: "gap-later-only",
        question: "A gap first identified later",
        discriminatesInterpretationIds: ["interp-1"],
        availableFrom: "2024-03-01",
        origin: { kind: "cited", citations: cite("src-2024") },
      },
    ],
    assumptions: [
      { id: "asm-rover-access", statement: "The rover can reach the site.", rationale: "fixture", citations: [] },
    ],
    resources: [
      {
        id: "res-time",
        name: "Operations time",
        unit: "points",
        description: "fixture",
        budget: 100,
        simulated: true,
      },
    ],
    tasks: [
      {
        id: "task-rover-insitu",
        title: "Rover in-situ analysis",
        description: "fixture",
        platform: "rover",
        instruments: ["Arm instrument"],
        addressesGapIds: ["gap-origin", "gap-context"],
        costs: { "res-time": 60 },
        assumptionIds: ["asm-rover-access"],
      },
      {
        id: "task-orbital-repeat",
        title: "Repeat orbital observation",
        description: "fixture",
        platform: "orbital",
        instruments: ["Spectrometer"],
        addressesGapIds: ["gap-context"],
        costs: { "res-time": 10 },
        assumptionIds: [],
      },
      {
        id: "task-too-expensive",
        title: "Over-budget task",
        description: "fixture",
        platform: "rover",
        instruments: ["Drill"],
        addressesGapIds: ["gap-origin"],
        costs: { "res-time": 150 },
        assumptionIds: [],
      },
      {
        id: "task-later-gap",
        title: "Task for a gap not yet identified",
        description: "fixture",
        platform: "rover",
        instruments: ["Camera"],
        addressesGapIds: ["gap-later-only"],
        costs: { "res-time": 5 },
        assumptionIds: [],
      },
    ],
    limitations: ["fixture limitation"],
  };
}
