import { TREK_EQ_TILE_GRID, TREK_LAYERS, type Extent } from "./trek-layers";

/**
 * Named map views, expressed as extents the map fits to (so they adapt to the
 * viewport size).
 *
 * The Jezero view uses the bounding box of the Trek "MRO CTX, Jezero Mosaic,
 * Controlled" product, not a crater-centre coordinate. Published centre
 * coordinates for Jezero disagree between sources (see
 * docs/NASA_MAP_RESEARCH.md), so none is hard-coded here.
 */
export interface NamedView {
  label: string;
  extent: Extent;
  basis: string;
}

export const INITIAL_VIEWS = {
  jezero: {
    label: "Jezero",
    extent: TREK_LAYERS.jezeroCtx.extent,
    basis: `Extent of Trek product ${TREK_LAYERS.jezeroCtx.id}`,
  },
  global: {
    label: "Global",
    extent: TREK_EQ_TILE_GRID.extent,
    basis: "Full Mars 2000 geographic extent",
  },
} as const satisfies Record<string, NamedView>;

export type InitialViewId = keyof typeof INITIAL_VIEWS;

export const DEFAULT_VIEW: InitialViewId = "jezero";
