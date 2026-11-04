import ImageTile from "ol/source/ImageTile";
import TileGrid from "ol/tilegrid/TileGrid";
import type Projection from "ol/proj/Projection";

import {
  TREK_EQ_TILE_GRID,
  trekAttribution,
  trekResolutions,
  trekTileUrlTemplate,
  type TrekLayer,
} from "./trek-layers";

/**
 * Tile grid for one Trek layer. Restricting `extent` to the layer's bounding
 * box stops OpenLayers requesting tiles outside regional mosaics, which Trek
 * answers with HTTP 404.
 */
export function createTrekTileGrid(layer: TrekLayer): TileGrid {
  return new TileGrid({
    origin: [...TREK_EQ_TILE_GRID.origin],
    extent: [...layer.extent],
    resolutions: trekResolutions(layer.maxNativeZoom),
    tileSize: TREK_EQ_TILE_GRID.tileSize,
  });
}

/**
 * OpenLayers source for a Trek layer. `ImageTile` always sets
 * `crossOrigin="anonymous"`; Trek tiles send `Access-Control-Allow-Origin: *`
 * (verified 2026-11-04), which also keeps the canvas exportable later.
 */
export function createTrekSource(layer: TrekLayer, projection: Projection): ImageTile {
  return new ImageTile({
    url: trekTileUrlTemplate(layer),
    projection,
    tileGrid: createTrekTileGrid(layer),
    attributions: trekAttribution(layer),
    attributionsCollapsible: true,
    wrapX: true,
  });
}
