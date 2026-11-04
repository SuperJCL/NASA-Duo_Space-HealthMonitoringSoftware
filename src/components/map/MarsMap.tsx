"use client";

import "ol/ol.css";

import { useEffect, useRef, useState } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import MousePosition from "ol/control/MousePosition";
import ScaleLine from "ol/control/ScaleLine";
import { defaults as defaultControls } from "ol/control/defaults";
import type { Coordinate } from "ol/coordinate";

import { formatLonLat } from "@/lib/map/mars-geodesy";
import { getMarsProjection } from "@/lib/map/mars-projection";
import { createTrekSource } from "@/lib/map/create-trek-source";
import {
  BASEMAP_KEYS,
  DEFAULT_BASEMAP,
  DEFAULT_OVERLAYS,
  OVERLAY_KEYS,
  TREK_LAYERS,
  type BasemapKey,
  type OverlayKey,
  type TrekLayerKey,
} from "@/lib/map/trek-layers";
import {
  DEFAULT_VIEW,
  INITIAL_VIEWS,
  type InitialViewId,
} from "@/lib/map/initial-views";

type TileStats = { loaded: number; failed: number };

const VIEW_MAX_ZOOM = 18;
const FIT_PADDING = [24, 24, 24, 24];

export function MarsMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const coordinateRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const layersRef = useRef<Partial<Record<TrekLayerKey, TileLayer>>>({});

  const [basemap, setBasemap] = useState<BasemapKey>(DEFAULT_BASEMAP);
  const [overlays, setOverlays] = useState<ReadonlySet<OverlayKey>>(
    () => new Set(DEFAULT_OVERLAYS),
  );
  const [tileStats, setTileStats] = useState<TileStats>({ loaded: 0, failed: 0 });
  const [isLoading, setIsLoading] = useState(false);

  // Create the map and all Trek layers once. React Strict Mode runs effects
  // twice in development, so cleanup must fully dispose the map.
  useEffect(() => {
    const target = containerRef.current;
    const coordinateTarget = coordinateRef.current;
    if (!target || !coordinateTarget) return;

    const projection = getMarsProjection();
    const onTileLoaded = () =>
      setTileStats((prev) => ({ ...prev, loaded: prev.loaded + 1 }));
    const onTileFailed = () =>
      setTileStats((prev) => ({ ...prev, failed: prev.failed + 1 }));

    // Basemaps first, then overlays (CTX below the higher-resolution HiRISE).
    const orderedKeys: TrekLayerKey[] = [...BASEMAP_KEYS, ...OVERLAY_KEYS];
    const layers: Partial<Record<TrekLayerKey, TileLayer>> = {};
    for (const key of orderedKeys) {
      const definition = TREK_LAYERS[key];
      const source = createTrekSource(definition, projection);
      source.on("tileloadend", onTileLoaded);
      source.on("tileloaderror", onTileFailed);
      layers[key] = new TileLayer({
        source,
        visible: false,
        preload: definition.role === "basemap" ? 1 : 0,
        properties: { trekLayerId: definition.id },
      });
    }

    const map = new OlMap({
      target,
      layers: orderedKeys.map((key) => layers[key]!),
      controls: defaultControls({ rotate: false }).extend([
        new ScaleLine({ units: "metric" }),
        new MousePosition({
          projection,
          target: coordinateTarget,
          className: "mdi-pointer-coordinate font-mono",
          placeholder: "Move pointer over the map",
          coordinateFormat: (coordinate?: Coordinate) =>
            coordinate ? formatLonLat([coordinate[0], coordinate[1]]) : "",
        }),
      ]),
      view: new View({
        projection,
        center: [0, 0],
        zoom: 2,
        minZoom: 1,
        maxZoom: VIEW_MAX_ZOOM,
      }),
    });

    // Map-level load events stay consistent even when tiles are aborted.
    map.on("loadstart", () => setIsLoading(true));
    map.on("loadend", () => setIsLoading(false));

    map.getView().fit([...INITIAL_VIEWS[DEFAULT_VIEW].extent], {
      size: map.getSize(),
      padding: FIT_PADDING,
    });

    mapRef.current = map;
    layersRef.current = layers;

    return () => {
      map.setTarget(undefined);
      map.dispose();
      mapRef.current = null;
      layersRef.current = {};
    };
  }, []);

  // Keep layer visibility in sync with the controls.
  useEffect(() => {
    for (const key of BASEMAP_KEYS) {
      layersRef.current[key]?.setVisible(key === basemap);
    }
    for (const key of OVERLAY_KEYS) {
      layersRef.current[key]?.setVisible(overlays.has(key));
    }
  }, [basemap, overlays]);

  const toggleOverlay = (key: OverlayKey) =>
    setOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const fitView = (viewId: InitialViewId) => {
    mapRef.current?.getView().fit([...INITIAL_VIEWS[viewId].extent], {
      padding: FIT_PADDING,
      duration: 800,
    });
  };

  return (
    <div className="relative size-full bg-background">
      <div ref={containerRef} className="absolute inset-0" data-testid="mars-map" />

      {/* Layer and view controls */}
      <div className="absolute right-3 top-3 flex max-w-[calc(100%-4.5rem)] flex-col items-end gap-2 text-xs">
        <fieldset className="w-60 max-w-full space-y-1.5 rounded-md bg-surface/90 p-2 shadow">
          <legend className="sr-only">Map layers</legend>
          <label className="flex items-center justify-between gap-2">
            <span className="text-muted">Basemap</span>
            <select
              value={basemap}
              onChange={(event) => setBasemap(event.target.value as BasemapKey)}
              className="min-w-0 flex-1 rounded border border-border bg-surface-raised px-1.5 py-1 text-foreground"
            >
              {BASEMAP_KEYS.map((key) => (
                <option key={key} value={key}>
                  {TREK_LAYERS[key].title}
                </option>
              ))}
            </select>
          </label>
          {OVERLAY_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={overlays.has(key)}
                onChange={() => toggleOverlay(key)}
                className="accent-accent"
              />
              <span>{TREK_LAYERS[key].title}</span>
            </label>
          ))}
        </fieldset>
        <div className="flex gap-1">
          {(Object.keys(INITIAL_VIEWS) as InitialViewId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => fitView(id)}
              title={INITIAL_VIEWS[id].basis}
              className="rounded-md bg-surface/90 px-2 py-1.5 shadow hover:bg-surface-raised"
            >
              {INITIAL_VIEWS[id].label}
            </button>
          ))}
        </div>
      </div>

      {/* Pointer coordinate and tile health */}
      <div className="pointer-events-none absolute bottom-10 right-3 flex flex-col items-end gap-1 text-[11px]">
        <TileStatus stats={tileStats} isLoading={isLoading} />
        <div
          ref={coordinateRef}
          className="rounded bg-surface/90 px-2 py-1 text-foreground"
          aria-live="off"
        />
      </div>
    </div>
  );
}

function TileStatus({ stats, isLoading }: { stats: TileStats; isLoading: boolean }) {
  const allFailed = stats.failed > 0 && stats.loaded === 0;
  const tone = allFailed ? "text-error" : stats.failed > 0 ? "text-warn" : "text-muted";
  const label = allFailed
    ? "NASA tiles unavailable — check network access to trek.nasa.gov"
    : `NASA tiles: ${stats.loaded} loaded${stats.failed ? `, ${stats.failed} failed` : ""}${isLoading ? ", loading…" : ""}`;

  return (
    <div
      data-testid="tile-status"
      data-loaded={stats.loaded}
      data-failed={stats.failed}
      className={`rounded bg-surface/90 px-2 py-1 ${tone}`}
    >
      {label}
    </div>
  );
}
