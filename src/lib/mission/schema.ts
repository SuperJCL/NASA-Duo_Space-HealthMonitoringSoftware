import { z } from "zod";
import { RecordId } from "@/lib/evidence/schema";

/**
 * Mission framing (MF-0): the simulated experience wrapped around a
 * scientific scenario. It holds copy and the default mode only. It holds no
 * scientific data, and changes nothing in the evidence model or the engine.
 *
 * "astronaut" is the user's simulated role. It is NOT an observation
 * platform: tasks keep their rover / orbital / lab platforms.
 */
export const MissionMode = z.enum(["present-day", "historical-replay"]);

export const MissionConfig = z
  .object({
    id: RecordId,
    scenarioId: RecordId,
    defaultMode: MissionMode,
    missionYear: z.number().int().min(2026),
    persona: z.literal("astronaut"),
    title: z.string().min(1),
    disclaimer: z.string().min(1),
    presentDay: z.object({ evidenceNote: z.string().includes("{latestRecordDate}") }).strict(),
    historicalReplay: z.object({ label: z.string().min(1), evidenceNote: z.string().includes("{replayDate}") }).strict(),
    actionFraming: z.string().min(1),
    caveats: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type MissionMode = z.infer<typeof MissionMode>;
export type MissionConfig = z.infer<typeof MissionConfig>;
