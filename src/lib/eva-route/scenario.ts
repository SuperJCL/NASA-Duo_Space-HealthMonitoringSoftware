// EVA route & scouting scenario (src/data/prototype/eva-scouting.json): Zod schema and
// resolution of its scenario-defined positions. EVERYTHING in that file is SIMULATED: the base,
// the surveyed areas, the rover start and charge, and the hidden ground hazards. Positions are
// offsets in metres from a verified anchor sample site, like the Mission Glass targets, so they
// are never mistaken for NASA coordinates. Real data used with it: the CTX DTM crop (terrain),
// the verified sample sites and Perseverance's historical traverse (src/data/geo/).

import { z } from "zod";
import type { LonLat } from "@/lib/terrain/terrain";
import { MARS_METERS_PER_DEGREE } from "@/lib/map/mars-geodesy";
import type { SurfaceName } from "./knowledge";

const Offset = z.object({ east: z.number(), north: z.number() }).strict();
const Label = z.string().min(1);
const SurfaceEnum = z.enum(["firm", "sand", "ripples", "boulders"]);

const KnownArea = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disk"), label: Label, centreM: Offset, radiusM: z.number().positive() }).strict(),
  z.object({ kind: z.literal("band"), label: Label, fromM: Offset, toM: Offset, widthM: z.number().positive() }).strict(),
  // Perseverance's historical traverse (real NASA data, src/data/geo/): treating a corridor
  // along it as observed walkable ground is a SIMULATION ASSUMPTION, stated in `label`.
  z.object({ kind: z.literal("traverse"), label: Label, halfWidthM: z.number().positive() }).strict(),
]);

const Hazard = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disk"), label: Label, surface: SurfaceEnum, centreM: Offset, radiusM: z.number().positive(), slopeDeg: z.number().min(0).max(60).optional() }).strict(),
  z.object({ kind: z.literal("band"), label: Label, surface: SurfaceEnum, fromM: Offset, toM: Offset, widthM: z.number().positive(), slopeDeg: z.number().min(0).max(60).optional() }).strict(),
]);

const Variant = z
  .object({
    id: z.string().regex(/^[A-Z]$/),
    title: Label,
    summary: Label,
    hazards: z.array(Hazard),
    rover: z.object({ startM: Offset, chargePct: z.number().min(1).max(100), note: Label }).strict(),
  })
  .strict();

export const EvaScoutingScenario = z
  .object({
    id: z.string().min(1),
    label: Label,
    basis: z.literal("simulated"),
    anchorId: z.string().min(1),
    base: z.object({ id: z.string().min(1), name: Label, offsetM: Offset }).strict(),
    knownAreas: z.array(KnownArea).min(1),
    defaultPrimaryId: z.string().min(1),
    defaultAlternativeId: z.string().min(1),
    variants: z.array(Variant).min(1),
  })
  .strict();
export type EvaScoutingScenario = z.infer<typeof EvaScoutingScenario>;
export type Offset = z.infer<typeof Offset>;

/** Resolved shapes, in lon/lat (the anchor is a verified sample site; the offsets are simulated). */
export type ResolvedArea =
  | { kind: "disk"; label: string; centre: LonLat; radiusM: number }
  | { kind: "band"; label: string; from: LonLat; to: LonLat; widthM: number }
  | { kind: "traverse"; label: string; halfWidthM: number };
export type ResolvedHazard =
  | { kind: "disk"; label: string; surface: SurfaceName; centre: LonLat; radiusM: number; slopeDeg?: number }
  | { kind: "band"; label: string; surface: SurfaceName; from: LonLat; to: LonLat; widthM: number; slopeDeg?: number };
export type ResolvedVariant = {
  id: string;
  title: string;
  summary: string;
  hazards: ResolvedHazard[];
  rover: { start: LonLat; chargePct: number; note: string };
};
export type ResolvedScouting = {
  id: string;
  label: string;
  base: { id: string; name: string; position: LonLat };
  knownAreas: ResolvedArea[];
  defaultPrimaryId: string;
  defaultAlternativeId: string;
  variants: ResolvedVariant[];
};

export function parseEvaScouting(raw: unknown): EvaScoutingScenario {
  const parsed = EvaScoutingScenario.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid EVA scouting scenario:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Resolve the offsets against the anchor's verified position (same flat-offset method as the Mission Glass targets). */
export function resolveScouting(s: EvaScoutingScenario, anchor: LonLat): ResolvedScouting {
  const [lon0, lat0] = anchor;
  const kLon = MARS_METERS_PER_DEGREE * Math.cos((lat0 * Math.PI) / 180);
  const at = (o: Offset): LonLat => [lon0 + o.east / kLon, lat0 + o.north / MARS_METERS_PER_DEGREE];
  return {
    id: s.id,
    label: s.label,
    base: { id: s.base.id, name: s.base.name, position: at(s.base.offsetM) },
    knownAreas: s.knownAreas.map((a): ResolvedArea =>
      a.kind === "disk" ? { kind: "disk", label: a.label, centre: at(a.centreM), radiusM: a.radiusM } : a.kind === "band" ? { kind: "band", label: a.label, from: at(a.fromM), to: at(a.toM), widthM: a.widthM } : { ...a },
    ),
    defaultPrimaryId: s.defaultPrimaryId,
    defaultAlternativeId: s.defaultAlternativeId,
    variants: s.variants.map((v) => ({
      id: v.id,
      title: v.title,
      summary: v.summary,
      hazards: v.hazards.map((h): ResolvedHazard =>
        h.kind === "disk"
          ? { kind: "disk", label: h.label, surface: h.surface, centre: at(h.centreM), radiusM: h.radiusM, slopeDeg: h.slopeDeg }
          : { kind: "band", label: h.label, surface: h.surface, from: at(h.fromM), to: at(h.toM), widthM: h.widthM, slopeDeg: h.slopeDeg },
      ),
      rover: { start: at(v.rover.startM), chargePct: v.rover.chargePct, note: v.rover.note },
    })),
  };
}
