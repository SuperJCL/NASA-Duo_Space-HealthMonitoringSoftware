"use client";

import "ol/ol.css";

import { useEffect, useMemo, useRef, useState } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import GeoJSON from "ol/format/GeoJSON";
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from "ol/style";
import MousePosition from "ol/control/MousePosition";
import ScaleLine from "ol/control/ScaleLine";
import { defaults as defaultControls } from "ol/control/defaults";
import { boundingExtent, type Extent } from "ol/extent";
import type { Coordinate } from "ol/coordinate";
import type { FeatureLike } from "ol/Feature";

import { toGeoJson, type FeatureKind, type MapFeature } from "@/lib/geo/features";
import { formatLonLat } from "@/lib/map/mars-geodesy";
import { getMarsProjection } from "@/lib/map/mars-projection";
import { createTrekSource } from "@/lib/map/create-trek-source";
import { GEO_LAYERS, geoLayerFor, pickFeature, type GeoLayerKey } from "@/lib/map/geo-layers";
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
import { DEFAULT_VIEW, INITIAL_VIEWS } from "@/lib/map/initial-views";

type TileStats = { loaded: number; failed: number };

export type MarsMapProps = {
  /** Verified geographic features to draw (already filtered for the mission mode). */
  features: readonly MapFeature[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Feature kinds whose labels are always shown (e.g. sample sites in the briefing view). */
  labelKinds?: readonly FeatureKind[];
  /** [west, south, east, north] to fit on first render; defaults to the Jezero view. */
  initialExtent?: readonly [number, number, number, number];
  /** Whether the layer panel starts open on wide screens (default true). */
  layerPanelOpenOnDesktop?: boolean;
  /**
   * Scenario-defined (simulated) target positions. They are drawn in their
   * own layer and style, apart from verified features; selection ids are
   * shared through `selectedId` / `onSelect`.
   */
  simulatedTargets?: readonly { id: string; name: string; position: readonly [number, number] }[];
  /** "minimal": only zoom buttons (EVA HUD); "full": layer panel, view buttons, tile status. */
  chrome?: "full" | "minimal";
  /** Imagery overlays shown at start (default: the CTX mosaic). */
  initialOverlays?: readonly OverlayKey[];
};

const SIM = "#ff8a6b";

const VIEW_MAX_ZOOM = 18;
const FIT_PADDING = [24, 24, 24, 24];

// Historical rover data share one hue; reference data are neutral. The
// accent colour is reserved for simulated actions, which are never drawn.
const HISTORICAL = "#8ecae6";
const REFERENCE = "#ede6e0";
const SELECTED = "#ffffff";
const HALO = "rgba(13, 11, 10, 0.85)";

const label = (text: string, offsetY: number) =>
  new Text({
    text,
    offsetY,
    font: "11px ui-sans-serif, system-ui, sans-serif",
    fill: new Fill({ color: REFERENCE }),
    stroke: new Stroke({ color: HALO, width: 3 }),
  });

/** Dashed outer ring = coordinate convention inferred by cross-validation. */
const inferredRing = (radius: number) =>
  new Style({ image: new CircleStyle({ radius, stroke: new Stroke({ color: REFERENCE, width: 1.5, lineDash: [3, 3] }) }) });

/** Labels appear only when zoomed in (≈ 7 m per pixel or closer) or for the selected feature, so close sites stay readable. */
const LABEL_MAX_RESOLUTION = 0.00012;

function styleFor(feature: FeatureLike, selected: boolean, resolution: number, alwaysLabel: ReadonlySet<FeatureKind>): Style[] {
  const showLabel = selected || resolution <= LABEL_MAX_RESOLUTION || alwaysLabel.has(feature.get("kind") as FeatureKind);
  const kind = feature.get("kind") as FeatureKind;
  const inferred = feature.get("conventionBasis") === "inferred-cross-validation";
  const name = String(feature.get("name") ?? "");
  switch (kind) {
    case "traverse-segment":
      return [
        new Style({ stroke: new Stroke({ color: HALO, width: selected ? 8 : 5 }) }),
        new Style({ stroke: new Stroke({ color: selected ? SELECTED : HISTORICAL, width: selected ? 4.5 : 2.5 }) }),
      ];
    case "sample-site":
      return [
        ...(inferred ? [inferredRing(selected ? 13 : 11)] : []),
        new Style({
          image: new CircleStyle({
            radius: selected ? 8 : 6,
            fill: new Fill({ color: selected ? SELECTED : HISTORICAL }),
            stroke: new Stroke({ color: HALO, width: 2 }),
          }),
          text: showLabel ? label(name, 22) : undefined,
        }),
      ];
    case "rover-last-position":
      return [
        ...(inferred ? [inferredRing(selected ? 15 : 13)] : []),
        new Style({
          image: new RegularShape({
            points: 4,
            radius: selected ? 11 : 9,
            angle: 0,
            fill: new Fill({ color: selected ? SELECTED : HISTORICAL }),
            stroke: new Stroke({ color: HALO, width: 2 }),
          }),
          text: showLabel ? label(name, -22) : undefined,
        }),
      ];
    case "crater-centre":
      return [
        new Style({
          image: new RegularShape({
            points: 4,
            radius: selected ? 12 : 9,
            radius2: 0,
            angle: 0,
            stroke: new Stroke({ color: selected ? SELECTED : REFERENCE, width: selected ? 3 : 2 }),
          }),
          text: showLabel ? label(name, 20) : undefined,
        }),
      ];
    case "product-extent":
      return [
        new Style({
          stroke: new Stroke({ color: selected ? SELECTED : "rgba(237, 230, 224, 0.75)", width: selected ? 3 : 1.5, lineDash: [6, 4] }),
          text: selected ? label(name, 0) : undefined,
        }),
      ];
  }
}

export function MarsMap({
  features,
  selectedId,
  onSelect,
  labelKinds = [],
  initialExtent,
  layerPanelOpenOnDesktop = true,
  simulatedTargets = [],
  chrome = "full",
  initialOverlays = DEFAULT_OVERLAYS,
}: MarsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const coordinateRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const layersRef = useRef<Partial<Record<TrekLayerKey, TileLayer>>>({});
  const geoLayersRef = useRef<Partial<Record<GeoLayerKey, VectorLayer>>>({});
  const simLayerRef = useRef<VectorLayer | null>(null);
  const [viewExtent, setViewExtent] = useState<string>("");
  const selectedRef = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  const alwaysLabelRef = useRef<ReadonlySet<FeatureKind>>(new Set(labelKinds));
  const initialExtentRef = useRef(initialExtent);

  const [basemap, setBasemap] = useState<BasemapKey>(DEFAULT_BASEMAP);
  const [overlays, setOverlays] = useState<ReadonlySet<OverlayKey>>(() => new Set(initialOverlays));
  const [geoVisible, setGeoVisible] = useState<Record<GeoLayerKey, boolean>>(
    () => Object.fromEntries(GEO_LAYERS.map((l) => [l.key, l.defaultVisible])) as Record<GeoLayerKey, boolean>,
  );
  // The panel starts open on wide screens and collapsed on phones (the map is client-only).
  const [panelOpen, setPanelOpen] = useState(() => layerPanelOpenOnDesktop && window.matchMedia("(min-width: 1024px)").matches);
  const [tileStats, setTileStats] = useState<TileStats>({ loaded: 0, failed: 0 });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const featureById = useMemo(() => new Map(features.map((f) => [f.id, f])), [features]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(GEO_LAYERS.map((l) => [l.key, 0])) as Record<GeoLayerKey, number>;
    for (const f of features) c[geoLayerFor(f.kind)]++;
    return c;
  }, [features]);
  const solRange = useMemo(() => {
    const sols = features.filter((f) => f.kind === "traverse-segment").map((f) => f.event?.sol ?? 0);
    return sols.length ? `${Math.min(...sols)}–${Math.max(...sols)}` : null;
  }, [features]);
  const traverseExtent = useMemo<Extent | null>(() => {
    const pts = features.flatMap((f) => (f.geometry.type === "MultiLineString" ? f.geometry.coordinates.flat() : []));
    return pts.length ? boundingExtent(pts.map((p) => [p[0], p[1]])) : null;
  }, [features]);

  // Create the map, the Trek tile layers and the empty vector layers once.
  // React Strict Mode runs effects twice in development, so cleanup disposes the map.
  useEffect(() => {
    const target = containerRef.current;
    const coordinateTarget = coordinateRef.current;
    if (!target || !coordinateTarget) return;

    const projection = getMarsProjection();
    const onTileLoaded = () => setTileStats((prev) => ({ ...prev, loaded: prev.loaded + 1 }));
    const onTileFailed = () => setTileStats((prev) => ({ ...prev, failed: prev.failed + 1 }));

    const orderedKeys: TrekLayerKey[] = [...BASEMAP_KEYS, ...OVERLAY_KEYS];
    const layers: Partial<Record<TrekLayerKey, TileLayer>> = {};
    for (const key of orderedKeys) {
      const definition = TREK_LAYERS[key];
      const source = createTrekSource(definition, projection);
      source.on("tileloadend", onTileLoaded);
      source.on("tileloaderror", onTileFailed);
      layers[key] = new TileLayer({ source, visible: false, preload: definition.role === "basemap" ? 1 : 0, properties: { trekLayerId: definition.id } });
    }

    const geoLayers: Partial<Record<GeoLayerKey, VectorLayer>> = {};
    for (const g of GEO_LAYERS) {
      geoLayers[g.key] = new VectorLayer({
        source: new VectorSource(),
        style: (f, resolution) => styleFor(f, f.getId() === selectedRef.current, resolution, alwaysLabelRef.current),
        properties: { geoLayer: g.key },
      });
    }

    // Simulated targets: coral hollow diamond with a "SIM" label. Never styled like verified data.
    const simLayer = new VectorLayer({
      source: new VectorSource(),
      style: (f) => {
        const selected = f.getId() === selectedRef.current;
        return [
          new Style({
            image: new RegularShape({
              points: 4,
              radius: selected ? 13 : 10,
              angle: 0,
              fill: new Fill({ color: selected ? "rgba(255, 138, 107, 0.35)" : "rgba(14, 21, 32, 0.55)" }),
              stroke: new Stroke({ color: selected ? "#ffffff" : SIM, width: selected ? 3 : 2, lineDash: [4, 3] }),
            }),
            text: new Text({
              text: `SIM · ${String(f.get("name") ?? "")}`,
              offsetY: selected ? -24 : -20,
              font: "600 12px ui-sans-serif, system-ui, sans-serif",
              fill: new Fill({ color: selected ? "#ffffff" : SIM }),
              stroke: new Stroke({ color: "rgba(14, 21, 32, 0.9)", width: 3 }),
            }),
          }),
        ];
      },
      properties: { simulated: true },
    });

    const map = new OlMap({
      target,
      layers: [...orderedKeys.map((key) => layers[key]!), ...GEO_LAYERS.map((g) => geoLayers[g.key]!), simLayer],
      controls: defaultControls({ rotate: false }).extend([
        new ScaleLine({ units: "metric" }),
        new MousePosition({
          projection,
          target: coordinateTarget,
          className: "mdi-pointer-coordinate font-mono",
          placeholder: "Move pointer over the map",
          coordinateFormat: (coordinate?: Coordinate) => (coordinate ? formatLonLat([coordinate[0], coordinate[1]]) : ""),
        }),
      ]),
      view: new View({ projection, center: [0, 0], zoom: 2, minZoom: 1, maxZoom: VIEW_MAX_ZOOM }),
    });

    const vectorLayers = new Set<VectorLayer>([...Object.values(geoLayers).filter((l): l is VectorLayer => Boolean(l)), simLayer]);
    const hitsAt = (pixel: number[]) =>
      map
        .getFeaturesAtPixel(pixel, { hitTolerance: 6, layerFilter: (l) => vectorLayers.has(l as VectorLayer) })
        .map((f) => ({ id: String(f.getId()), kind: f.get("kind") as FeatureKind }));
    map.on("singleclick", (e) => {
      const hits = hitsAt(e.pixel);
      // A simulated target wins over verified features under the same pixel.
      const sim = hits.find((h) => h.kind === undefined || String(h.id).startsWith("sim-"));
      onSelectRef.current(sim ? sim.id : (pickFeature(hits.filter((h) => h.kind))?.id ?? null));
    });
    // Exposes the visible extent (Mars degrees) for tests and debugging.
    map.on("moveend", () => setViewExtent(map.getView().calculateExtent(map.getSize()).map((v) => v.toFixed(6)).join(",")));
    map.on("pointermove", (e) => {
      if (e.dragging) return;
      target.style.cursor = hitsAt(e.pixel).length ? "pointer" : "";
    });
    map.on("loadstart", () => setIsLoading(true));
    map.on("loadend", () => setIsLoading(false));

    map.getView().fit([...(initialExtentRef.current ?? INITIAL_VIEWS[DEFAULT_VIEW].extent)], { size: map.getSize(), padding: FIT_PADDING });

    mapRef.current = map;
    layersRef.current = layers;
    geoLayersRef.current = geoLayers;
    simLayerRef.current = simLayer;
    return () => {
      map.setTarget(undefined);
      map.dispose();
      mapRef.current = null;
      layersRef.current = {};
      geoLayersRef.current = {};
    };
  }, []);

  // Load the features into their layers whenever the mission mode changes them.
  useEffect(() => {
    const projection = getMarsProjection();
    // Coordinates are Mars degrees: read them with the Mars projection, never EPSG:4326.
    const format = new GeoJSON({ dataProjection: projection, featureProjection: projection });
    for (const g of GEO_LAYERS) {
      const source = geoLayersRef.current[g.key]?.getSource();
      if (!source) continue;
      source.clear();
      const subset = features.filter((f) => (g.kinds as readonly FeatureKind[]).includes(f.kind));
      source.addFeatures(format.readFeatures(toGeoJson(subset)));
    }
  }, [features]);

  // Load scenario-defined targets (kept apart from verified features).
  const simKey = simulatedTargets.map((t) => `${t.id}:${t.position.join(",")}`).join("|");
  useEffect(() => {
    const source = simLayerRef.current?.getSource();
    if (!source) return;
    source.clear();
    for (const t of simulatedTargets) {
      const f = new Feature({ geometry: new Point([t.position[0], t.position[1]]), name: t.name });
      f.setId(t.id);
      source.addFeature(f);
    }
    // simKey captures the content of simulatedTargets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simKey]);

  // Restyle when the selection changes, and bring a selected point into view
  // (no animation, and no zoom change) if it is outside the visible area.
  useEffect(() => {
    selectedRef.current = selectedId;
    for (const layer of Object.values(geoLayersRef.current)) layer?.changed();
    simLayerRef.current?.changed();
    const map = mapRef.current;
    const f = selectedId ? featureById.get(selectedId) : undefined;
    const sim = selectedId ? simulatedTargets.find((t) => t.id === selectedId) : undefined;
    const point = sim ? sim.position : f?.geometry.type === "Point" ? f.geometry.coordinates : null;
    if (!map || !point) return;
    const [lon, lat] = point;
    const [w, s, e, n] = map.getView().calculateExtent(map.getSize());
    const mx = (e - w) * 0.1;
    const my = (n - s) * 0.1;
    if (lon < w + mx || lon > e - mx || lat < s + my || lat > n - my) map.getView().setCenter([lon, lat]);
    // simulatedTargets is read for its positions only; simKey tracks changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, featureById, simKey]);

  useEffect(() => {
    for (const key of BASEMAP_KEYS) layersRef.current[key]?.setVisible(key === basemap);
    for (const key of OVERLAY_KEYS) layersRef.current[key]?.setVisible(overlays.has(key));
  }, [basemap, overlays]);

  useEffect(() => {
    for (const g of GEO_LAYERS) geoLayersRef.current[g.key]?.setVisible(geoVisible[g.key]);
  }, [geoVisible]);

  const toggleOverlay = (key: OverlayKey) =>
    setOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleGeo = (key: GeoLayerKey) => {
    const next = !geoVisible[key];
    setGeoVisible((prev) => ({ ...prev, [key]: next }));
    // A hidden feature cannot stay selected.
    const sel = selectedId ? featureById.get(selectedId) : undefined;
    if (!next && sel && geoLayerFor(sel.kind) === key) onSelect(null);
  };

  const fitExtent = (extent: Extent, maxZoom = 16) =>
    mapRef.current?.getView().fit(extent, { padding: [80, 80, 80, 80], maxZoom, duration: 0 });

  /** Keyboard path to every feature: selecting one shows its layer and centres the map on it. */
  const selectFromList = (id: string) => {
    const f = featureById.get(id);
    if (!f) return;
    const key = geoLayerFor(f.kind);
    if (!geoVisible[key]) setGeoVisible((prev) => ({ ...prev, [key]: true }));
    onSelect(id);
    const coords =
      f.geometry.type === "Point" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates.flat() : f.geometry.coordinates[0];
    // Zoom 15 stays close to the native resolution of the CTX imagery (z13) so the view is not misleadingly blurry.
    fitExtent(boundingExtent(coords.map((p) => [p[0], p[1]])), 15);
  };

  const listed = (kinds: readonly FeatureKind[]) => features.filter((f) => kinds.includes(f.kind));

  return (
    <div className="relative size-full bg-background">
      <div
        ref={containerRef}
        className="absolute inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
        data-testid="mars-map"
        data-view-extent={viewExtent}
        tabIndex={0}
        role="application"
        aria-label="Mars map of Jezero crater. Arrow keys pan, plus and minus zoom. Use the feature list in the layer panel to select features with the keyboard."
      />

      <div hidden={chrome === "minimal"} className="absolute right-3 top-3 flex max-h-[calc(100%-8rem)] max-w-[calc(100%-4.5rem)] flex-col items-end gap-2 text-xs">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
            aria-controls="map-layer-panel"
            data-testid="layers-toggle"
            className="rounded-md bg-surface/90 px-2 py-1.5 shadow hover:bg-surface-raised"
          >
            {panelOpen ? "Hide layers" : "Layers & legend"}
          </button>
          <button type="button" onClick={() => fitExtent([...INITIAL_VIEWS.jezero.extent], 18)} title={INITIAL_VIEWS.jezero.basis} className="rounded-md bg-surface/90 px-2 py-1.5 shadow hover:bg-surface-raised">
            {INITIAL_VIEWS.jezero.label}
          </button>
          {traverseExtent ? (
            <button type="button" onClick={() => fitExtent(traverseExtent, 18)} className="rounded-md bg-surface/90 px-2 py-1.5 shadow hover:bg-surface-raised">
              {"Traverse"}
            </button>
          ) : null}
          <button type="button" onClick={() => fitExtent([...INITIAL_VIEWS.global.extent], 18)} title={INITIAL_VIEWS.global.basis} className="rounded-md bg-surface/90 px-2 py-1.5 shadow hover:bg-surface-raised">
            {INITIAL_VIEWS.global.label}
          </button>
        </div>

        <div id="map-layer-panel" hidden={!panelOpen} className="w-72 max-w-full overflow-y-auto rounded-md bg-surface/95 p-2 shadow" data-testid="layer-panel">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{"NASA imagery"}</legend>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted">{"Basemap"}</span>
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
                <input type="checkbox" checked={overlays.has(key)} onChange={() => toggleOverlay(key)} className="accent-accent" />
                <span>{TREK_LAYERS[key].title}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="mt-3 space-y-1.5" data-testid="geo-legend">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{"Historical rover data (verified)"}</legend>
            {GEO_LAYERS.filter((g) => g.group === "historical-rover").map((g) => (
              <LayerToggle
                key={g.key}
                layerKey={g.key}
                label={g.label}
                detail={
                  g.key === "traverse"
                    ? `${counts.traverse} drives${solRange ? `, sols ${solRange}` : ""}`
                    : g.key === "lastPosition"
                      ? "historical, not live"
                      : `${counts[g.key]} site(s)`
                }
                checked={geoVisible[g.key]}
                disabled={counts[g.key] === 0}
                onChange={() => toggleGeo(g.key)}
              />
            ))}
            <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{"Reference"}</p>
            {GEO_LAYERS.filter((g) => g.group === "reference").map((g) => (
              <LayerToggle
                key={g.key}
                layerKey={g.key}
                label={g.label}
                detail={g.key === "extents" ? `${counts.extents} products` : "USGS Gazetteer"}
                checked={geoVisible[g.key]}
                disabled={counts[g.key] === 0}
                onChange={() => toggleGeo(g.key)}
              />
            ))}
            <p className="flex items-start gap-1.5 pt-1 text-[11px] text-muted">
              <LegendSymbol kind="inferred" />
              <span>{"Dashed ring: coordinates inferred by cross-validation. No ring: convention stated by the source."}</span>
            </p>
            <p className="text-[11px] text-muted" data-testid="no-task-markers">
              {"Simulated observation actions are not drawn: they have no verified location, and no Margin Unit boundary is available."}
            </p>
          </fieldset>

          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">{"Select a feature"}</span>
            <select
              value={selectedId && featureById.has(selectedId) ? selectedId : ""}
              onChange={(e) => (e.target.value ? selectFromList(e.target.value) : onSelect(null))}
              className="w-full rounded border border-border bg-surface-raised px-1.5 py-1 text-foreground"
              data-testid="feature-select"
            >
              <option value="">{"None selected"}</option>
              <optgroup label="Historical rover data">
                {listed(["rover-last-position", "sample-site"]).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.kind === "sample-site" ? `Sample site: ${f.name}` : f.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Reference">
                {listed(["crater-centre", "product-extent"]).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Traverse drives">
                {listed(["traverse-segment"]).map((f) => (
                  <option key={f.id} value={f.id}>
                    {`Drive on sol ${f.event?.sol ?? "?"}`}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>
      </div>

      <div hidden={chrome === "minimal"} className="pointer-events-none absolute bottom-10 right-3 flex flex-col items-end gap-1 text-[11px]">
        <TileStatus stats={tileStats} isLoading={isLoading} />
        <div ref={coordinateRef} className="rounded bg-surface/90 px-2 py-1 text-foreground" aria-live="off" />
      </div>
    </div>
  );
}

function LayerToggle({
  layerKey,
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  layerKey: GeoLayerKey;
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`} data-testid={`layer-${layerKey}`}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={onChange} className="accent-accent" />
      <LegendSymbol kind={layerKey} />
      <span className="min-w-0">
        <span className="block">{label}</span>
        <span className="block text-[10px] text-muted">{disabled ? "not available in this mode" : detail}</span>
      </span>
    </label>
  );
}

function LegendSymbol({ kind }: { kind: GeoLayerKey | "inferred" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": true as const, className: "shrink-0" };
  switch (kind) {
    case "traverse":
      return (
        <svg {...common}>
          <path d="M2 13 L7 8 L11 11 L16 4" fill="none" stroke={HALO} strokeWidth={5} />
          <path d="M2 13 L7 8 L11 11 L16 4" fill="none" stroke={HISTORICAL} strokeWidth={2.5} />
        </svg>
      );
    case "samples":
      return (
        <svg {...common}>
          <circle cx={9} cy={9} r={7.5} fill="none" stroke={REFERENCE} strokeWidth={1.2} strokeDasharray="2.5 2.5" />
          <circle cx={9} cy={9} r={4} fill={HISTORICAL} stroke={HALO} strokeWidth={1.5} />
        </svg>
      );
    case "lastPosition":
      return (
        <svg {...common}>
          <circle cx={9} cy={9} r={8} fill="none" stroke={REFERENCE} strokeWidth={1.2} strokeDasharray="2.5 2.5" />
          <path d="M9 3 L15 9 L9 15 L3 9 Z" fill={HISTORICAL} stroke={HALO} strokeWidth={1.5} />
        </svg>
      );
    case "craterCentre":
      return (
        <svg {...common}>
          <path d="M9 2 V16 M2 9 H16" stroke={REFERENCE} strokeWidth={2} />
        </svg>
      );
    case "extents":
      return (
        <svg {...common}>
          <rect x={2.5} y={3.5} width={13} height={11} fill="none" stroke={REFERENCE} strokeWidth={1.3} strokeDasharray="3 2" />
        </svg>
      );
    case "inferred":
      return (
        <svg {...common}>
          <circle cx={9} cy={9} r={7} fill="none" stroke={REFERENCE} strokeWidth={1.2} strokeDasharray="2.5 2.5" />
        </svg>
      );
  }
}

function TileStatus({ stats, isLoading }: { stats: TileStats; isLoading: boolean }) {
  const allFailed = stats.failed > 0 && stats.loaded === 0;
  const tone = allFailed ? "text-error" : stats.failed > 0 ? "text-warn" : "text-muted";
  const text = allFailed
    ? "NASA tiles unavailable — check network access to trek.nasa.gov"
    : `NASA tiles: ${stats.loaded} loaded${stats.failed ? `, ${stats.failed} failed` : ""}${isLoading ? ", loading…" : ""}`;
  return (
    <div data-testid="tile-status" data-loaded={stats.loaded} data-failed={stats.failed} className={`rounded bg-surface/90 px-2 py-1 ${tone}`}>
      {text}
    </div>
  );
}
