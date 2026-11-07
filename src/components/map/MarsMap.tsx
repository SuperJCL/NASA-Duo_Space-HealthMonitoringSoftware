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
import LineString from "ol/geom/LineString";
import GeoJSON from "ol/format/GeoJSON";
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from "ol/style";
import MousePosition from "ol/control/MousePosition";
import ScaleLine from "ol/control/ScaleLine";
import { defaults as defaultControls } from "ol/control/defaults";
import { boundingExtent, buffer, type Extent } from "ol/extent";
import { easeOut } from "ol/easing";
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

/** Decision state drawn on a simulated target (MAP-1). Computed by the caller; the map only renders it. */
export type SimTargetTone = "candidate" | "added" | "planned" | "active" | "done" | "skipped" | "infeasible";
export type SimTarget = {
  id: string;
  name: string;
  position: readonly [number, number];
  /** Short text inside the marker (e.g. a provisional rank, "✓", "–"). */
  badge?: string;
  /** Short state word under the name (e.g. "planned", "not feasible"). */
  status?: string;
  tone?: SimTargetTone;
};

/**
 * MAP-2: a conceptual mission sequence (plan order only, never a route).
 * Computed by the caller; the map only draws it, under the simulated targets.
 */
export type MapSequence = {
  phase: "draft" | "confirmed";
  segments: readonly {
    id: string;
    from: readonly [number, number];
    to: readonly [number, number];
    state: "draft" | "history" | "current" | "remaining";
    infeasible: boolean;
  }[];
  /** Sequence-number chips next to the targets ("Seq 2", or "Draft 2" for a preview). */
  nodes: readonly { targetId: string; order: number; onLine: boolean; state: string }[];
};

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
  simulatedTargets?: readonly SimTarget[];
  /**
   * Centre the map on a simulated target (a card or list selection). Bump
   * `n` to repeat. The zoom stays near the level that shows all targets.
   */
  focusRequest?: { id: string; n: number } | null;
  /** Pixels covered by other UI, [top, right, bottom, left]: focusing centres in the visible part. */
  focusPadding?: readonly [number, number, number, number];
  /** Accessible name of the map region (describes the keyboard alternative). */
  ariaLabel?: string;
  /** "selected": only the selected target gets a text label (small maps, where labels would overlap). Read at mount. */
  simLabels?: "all" | "selected";
  /** "minimal": only zoom buttons (EVA HUD); "full": layer panel, view buttons, tile status. */
  chrome?: "full" | "minimal";
  /** Imagery overlays shown at start (default: the CTX mosaic). */
  initialOverlays?: readonly OverlayKey[];
  /** MAP-2: the conceptual mission sequence (null: none). */
  sequence?: MapSequence | null;
  selectedSegmentId?: string | null;
  onSelectSegment?: (id: string) => void;
  /** MAP-2: simulated targets to ring as well (the two ends of a selected connection). */
  highlightIds?: readonly string[];
};

const SIM = "#ff8a6b";
const SELECT_MS = 180;
const FOCUS_MS = 280;
// Simulated-target tones. Coral family only, so they never resemble the
// blue verified data; feasibility and progress change line and fill.
const TONE: Record<SimTargetTone, { stroke: string; fill: string; dash?: number[]; text: string; badge: string }> = {
  candidate: { stroke: SIM, fill: "rgba(14, 21, 32, 0.78)", dash: [4, 3], text: SIM, badge: "#ffe3da" },
  added: { stroke: SIM, fill: "rgba(255, 138, 107, 0.32)", text: SIM, badge: "#ffffff" },
  planned: { stroke: SIM, fill: "rgba(255, 138, 107, 0.32)", text: SIM, badge: "#ffffff" },
  active: { stroke: "#ffffff", fill: SIM, text: "#ffffff", badge: "#1a0f0c" },
  done: { stroke: "#84d8a6", fill: "rgba(132, 216, 166, 0.28)", text: "#84d8a6", badge: "#ffffff" },
  skipped: { stroke: "#8b97a8", fill: "rgba(14, 21, 32, 0.7)", dash: [2, 3], text: "#a3b3c8", badge: "#a3b3c8" },
  infeasible: { stroke: "#f1c878", fill: "rgba(14, 21, 32, 0.78)", dash: [4, 3], text: "#f1c878", badge: "#f1c878" },
};
// MAP-2 sequence lines: coral family like the targets (never the blue of the verified traverse);
// green = leads to completed work, yellow dashed = leads to work that does not fit.
const SEQ_COLOR = { draft: SIM, history: "#84d8a6", current: SIM, remaining: SIM, infeasible: "#f1c878" } as const;
const SEQ_WIDTH = { draft: 2, history: 2.5, current: 3.5, remaining: 2.5 } as const;
function sequenceStyle(f: FeatureLike, selected: boolean): Style[] {
  const kind = f.get("kind");
  if (kind === "seq-node") {
    const on = Boolean(f.get("onLine"));
    return [
      new Style({
        zIndex: 1,
        text: new Text({
          text: `${f.get("phase") === "draft" ? "Draft" : "Seq"} ${String(f.get("order"))}`,
          // Right of the marker: the target's own label sits above it, and neighbours' labels often below.
          offsetX: 19,
          textAlign: "left",
          font: "600 11px ui-sans-serif, system-ui, sans-serif",
          fill: new Fill({ color: on ? "#ffffff" : "#a3b3c8" }),
          backgroundFill: new Fill({ color: "rgba(14, 21, 32, 0.88)" }),
          backgroundStroke: new Stroke({ color: on ? SIM : "#8b97a8", width: 1, lineDash: on ? undefined : [2, 2] }),
          padding: [1, 4, 0, 4],
        }),
      }),
    ];
  }
  const state = f.get("state") as keyof typeof SEQ_WIDTH;
  const infeasible = Boolean(f.get("infeasible"));
  const color = infeasible ? SEQ_COLOR.infeasible : SEQ_COLOR[state];
  const width = SEQ_WIDTH[state] + (selected ? 1 : 0);
  const dash = state === "draft" ? [7, 6] : infeasible ? [5, 4] : undefined;
  const geom = f.getGeometry() as LineString | undefined;
  const styles: Style[] = [];
  if (selected) styles.push(new Style({ zIndex: 0, stroke: new Stroke({ color: "rgba(255, 255, 255, 0.85)", width: width + 5 }) }));
  if (state === "current" && !selected) styles.push(new Style({ zIndex: 0, stroke: new Stroke({ color: "rgba(255, 255, 255, 0.55)", width: width + 3 }) }));
  styles.push(new Style({ zIndex: 0, stroke: new Stroke({ color: "rgba(14, 21, 32, 0.55)", width: width + 2, lineDash: dash }) }));
  styles.push(new Style({ zIndex: 1, stroke: new Stroke({ color, width, lineDash: dash, lineCap: "round" }) }));
  // Direction of plan order: one small arrowhead past the middle (static, no animation).
  if (geom) {
    const [a, b] = geom.getCoordinates();
    const at = [a[0] + (b[0] - a[0]) * 0.58, a[1] + (b[1] - a[1]) * 0.58];
    styles.push(
      new Style({
        zIndex: 1,
        geometry: new Point(at),
        image: new RegularShape({ points: 3, radius: selected ? 7 : 6, rotation: Math.atan2(b[0] - a[0], b[1] - a[1]), fill: new Fill({ color }), stroke: new Stroke({ color: "rgba(14, 21, 32, 0.8)", width: 1 }) }),
      }),
    );
  }
  return styles;
}

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  focusRequest = null,
  focusPadding = [0, 0, 0, 0],
  simLabels = "all",
  sequence = null,
  selectedSegmentId = null,
  onSelectSegment,
  highlightIds = [],
  ariaLabel = "Mars map of Jezero crater. Arrow keys pan, plus and minus zoom. Use the feature list in the layer panel to select features with the keyboard.",
}: MarsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const coordinateRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const layersRef = useRef<Partial<Record<TrekLayerKey, TileLayer>>>({});
  const geoLayersRef = useRef<Partial<Record<GeoLayerKey, VectorLayer>>>({});
  const simLayerRef = useRef<VectorLayer | null>(null);
  const seqLayerRef = useRef<VectorLayer | null>(null);
  const selectedSegmentRef = useRef<string | null>(selectedSegmentId);
  const highlightRef = useRef<ReadonlySet<string>>(new Set(highlightIds));
  const onSelectSegmentRef = useRef(onSelectSegment);
  const [sequenceAttr, setSequenceAttr] = useState("null");
  const [viewExtent, setViewExtent] = useState<string>("");
  const selectedRef = useRef<string | null>(selectedId);
  /** Start time of the selection-ring transition (0 = settled). */
  const selectAnimRef = useRef(0);
  const [markerAttr, setMarkerAttr] = useState("[]");
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const simLabelsRef = useRef(simLabels);
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
    onSelectSegmentRef.current = onSelectSegment;
  }, [onSelect, onSelectSegment]);

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

    // Simulated targets: coral diamonds with a "SIM" label, never styled like
    // verified data. MAP-1: the badge (provisional rank, ✓, –) sits inside;
    // tone shows plan state and feasibility; the selected target gets a white
    // outline that grows in briefly (no pulsing, none with reduced motion).
    const simLayer = new VectorLayer({
      source: new VectorSource(),
      style: (f) => {
        // MAP-2: the two ends of a selected connection are ringed like a selection.
        const selected = f.getId() === selectedRef.current || highlightRef.current.has(String(f.getId()));
        const dimmed = Boolean(selectedRef.current) && !selected;
        const tone = TONE[(f.get("tone") as SimTargetTone | undefined) ?? "candidate"];
        const badge = String(f.get("badge") ?? "");
        const status = String(f.get("status") ?? "");
        const r = selected ? 15 : 12;
        const t = selected && selectAnimRef.current ? Math.min(1, (performance.now() - selectAnimRef.current) / SELECT_MS) : 1;
        const styles = [
          new Style({
            zIndex: selected ? 3 : 1,
            image: new RegularShape({
              points: 4,
              radius: r,
              angle: 0,
              fill: new Fill({ color: tone.fill }),
              stroke: new Stroke({ color: tone.stroke, width: selected ? 3 : 2, lineDash: tone.dash }),
            }),
            text: badge
              ? new Text({
                  text: badge,
                  font: `700 ${selected ? 14 : 12}px ui-sans-serif, system-ui, sans-serif`,
                  fill: new Fill({ color: tone.badge }),
                  stroke: tone.fill === SIM ? undefined : new Stroke({ color: "rgba(14, 21, 32, 0.9)", width: 2 }),
                })
              : undefined,
          }),
          new Style({
            zIndex: selected ? 3 : 1,
            text: new Text({
              text: `SIM · ${String(f.get("name") ?? "")}${status ? `\n${status}` : ""}`,
              offsetY: -(r + 8),
              textBaseline: "bottom",
              font: `${selected ? 700 : 600} 12px ui-sans-serif, system-ui, sans-serif`,
              fill: new Fill({ color: selected ? "#ffffff" : dimmed ? `${tone.text}cc` : tone.text }),
              stroke: new Stroke({ color: "rgba(14, 21, 32, 0.9)", width: 3 }),
            }),
          }),
        ];
        // On small maps only the selected target keeps its text label.
        if (simLabelsRef.current === "selected" && !selected) styles.pop();
        if (selected)
          styles.push(
            new Style({
              zIndex: 2,
              image: new RegularShape({
                points: 4,
                radius: r + 1 + 5 * t,
                angle: 0,
                stroke: new Stroke({ color: `rgba(255, 255, 255, ${0.35 + 0.6 * t})`, width: 2.5 }),
              }),
            }),
          );
        return styles;
      },
      properties: { simulated: true },
    });

    // MAP-2: conceptual sequence lines and number chips, under the simulated targets.
    const seqLayer = new VectorLayer({
      source: new VectorSource(),
      style: (f) => sequenceStyle(f, f.getId() === selectedSegmentRef.current),
      properties: { sequence: true },
    });

    const map = new OlMap({
      target,
      layers: [...orderedKeys.map((key) => layers[key]!), ...GEO_LAYERS.map((g) => geoLayers[g.key]!), seqLayer, simLayer],
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

    const vectorLayers = new Set<VectorLayer>([...Object.values(geoLayers).filter((l): l is VectorLayer => Boolean(l)), seqLayer, simLayer]);
    const hitsAt = (pixel: number[]) =>
      map
        .getFeaturesAtPixel(pixel, { hitTolerance: 6, layerFilter: (l) => vectorLayers.has(l as VectorLayer) })
        .map((f) => ({ id: String(f.getId()), kind: f.get("kind") as FeatureKind }))
        // Sequence-number chips are labels, not click targets.
        .filter((h) => !h.id.startsWith("seqnode:"));
    map.on("singleclick", (e) => {
      const hits = hitsAt(e.pixel);
      // A simulated target wins over a sequence connection, which wins over verified features under the same pixel.
      const sim = hits.find((h) => h.id.startsWith("sim-"));
      const seg = hits.find((h) => h.id.startsWith("seq:"));
      if (!sim && seg && onSelectSegmentRef.current) return onSelectSegmentRef.current(seg.id);
      onSelectRef.current(sim ? sim.id : (pickFeature(hits.filter((h) => h.kind && !h.id.startsWith("seq:")))?.id ?? null));
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
    seqLayerRef.current = seqLayer;
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

  // MAP-1: decision state on the targets. Updated in place whenever the
  // budget, constraints or plan change; the attribute mirrors what is drawn.
  const markerKey = simulatedTargets.map((t) => `${t.id}:${t.badge ?? ""}:${t.tone ?? ""}:${t.status ?? ""}`).join("|");
  useEffect(() => {
    const layer = simLayerRef.current;
    const source = layer?.getSource();
    if (!layer || !source) return;
    for (const t of simulatedTargets) {
      const f = source.getFeatureById(t.id);
      f?.setProperties({ badge: t.badge ?? "", status: t.status ?? "", tone: t.tone ?? "candidate" });
    }
    layer.changed();
    setMarkerAttr(
      JSON.stringify(
        source
          .getFeatures()
          .map((f) => ({ id: String(f.getId()), badge: f.get("badge") ?? "", tone: f.get("tone") ?? "candidate", status: f.get("status") ?? "", selected: f.getId() === selectedId }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    );
    // markerKey and simKey capture the content of simulatedTargets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerKey, simKey, selectedId]);

  // MAP-2: (re)draw the conceptual sequence whenever the plan state changes it.
  const sequenceKey = JSON.stringify(sequence);
  useEffect(() => {
    const source = seqLayerRef.current?.getSource();
    if (!source) return;
    source.clear();
    const posOf = new Map(simulatedTargets.map((t) => [t.id, t.position]));
    if (sequence) {
      for (const x of sequence.segments) {
        const f = new Feature({ geometry: new LineString([[x.from[0], x.from[1]], [x.to[0], x.to[1]]]), kind: "seq-segment", state: x.state, infeasible: x.infeasible });
        f.setId(x.id);
        source.addFeature(f);
      }
      for (const n of sequence.nodes) {
        const at = posOf.get(n.targetId);
        if (!at) continue; // no position: no chip (never inferred)
        const f = new Feature({ geometry: new Point([at[0], at[1]]), kind: "seq-node", order: n.order, onLine: n.onLine, state: n.state, phase: sequence.phase });
        f.setId(`seqnode:${n.targetId}`);
        source.addFeature(f);
      }
    }
    // sequenceKey and simKey capture the content of sequence and simulatedTargets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceKey, simKey]);

  // MAP-2: selected connection and highlighted ends; the attribute mirrors what is drawn.
  const highlightKey = highlightIds.join("|");
  useEffect(() => {
    selectedSegmentRef.current = selectedSegmentId;
    highlightRef.current = new Set(highlightIds);
    seqLayerRef.current?.changed();
    simLayerRef.current?.changed();
    const source = seqLayerRef.current?.getSource();
    const drawn = source?.getFeatures() ?? [];
    setSequenceAttr(
      sequence
        ? JSON.stringify({
            phase: sequence.phase,
            segments: drawn
              .filter((f) => f.get("kind") === "seq-segment")
              .map((f) => {
                const [a, b] = (f.getGeometry() as LineString).getCoordinates();
                return { id: String(f.getId()), state: f.get("state"), infeasible: f.get("infeasible"), selected: f.getId() === selectedSegmentId, from: a, to: b };
              }),
            nodes: drawn
              .filter((f) => f.get("kind") === "seq-node")
              .map((f) => ({ targetId: String(f.getId()).replace("seqnode:", ""), order: f.get("order"), onLine: f.get("onLine"), state: f.get("state") }))
              .sort((x, y) => x.order - y.order),
            highlighted: [...highlightIds],
          })
        : "null",
    );
    // sequenceKey and highlightKey capture the content of sequence and highlightIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceKey, selectedSegmentId, highlightKey, simKey]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Restyle when the selection changes, and bring a selected point into view
  // (no animation, and no zoom change) if it is outside the visible area.
  useEffect(() => {
    selectedRef.current = selectedId;
    for (const layer of Object.values(geoLayersRef.current)) layer?.changed();
    const simLayer = simLayerRef.current;
    const map = mapRef.current;
    const sim = selectedId ? simulatedTargets.find((t) => t.id === selectedId) : undefined;
    // Brief selection transition for a simulated target (skipped with reduced motion).
    selectAnimRef.current = sim && !prefersReducedMotion() ? performance.now() : 0;
    simLayer?.changed();
    let frame = 0;
    if (selectAnimRef.current && simLayer) {
      const tick = () => {
        simLayer.changed();
        if (performance.now() - selectAnimRef.current < SELECT_MS) frame = requestAnimationFrame(tick);
        else selectAnimRef.current = 0;
      };
      frame = requestAnimationFrame(tick);
    }
    const f = selectedId ? featureById.get(selectedId) : undefined;
    const point = sim ? sim.position : f?.geometry.type === "Point" ? f.geometry.coordinates : null;
    // A focus request for this target moves the map itself (see below).
    if (!map || !point || (sim && focusRequest?.id === sim.id)) return () => cancelAnimationFrame(frame);
    const [lon, lat] = point;
    const [w, s, e, n] = map.getView().calculateExtent(map.getSize());
    const mx = (e - w) * 0.1;
    const my = (n - s) * 0.1;
    if (lon < w + mx || lon > e - mx || lat < s + my || lat > n - my) map.getView().setCenter([lon, lat]);
    return () => cancelAnimationFrame(frame);
    // simulatedTargets is read for its positions only; simKey tracks changes.
    // focusRequest is read only to leave the move to the focus effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, featureById, simKey]);

  // MAP-1 focus: centre the requested target in the visible part of the map
  // with a short transition. The zoom is clamped near the level that shows
  // all simulated targets, so focusing never zooms in excessively or loses
  // the surrounding context.
  useEffect(() => {
    const map = mapRef.current;
    const size = map?.getSize();
    const t = focusRequest ? simulatedTargets.find((x) => x.id === focusRequest.id) : undefined;
    if (!map || !size || !t) return;
    const view = map.getView();
    const [pt, pr, pb, pl] = focusPadding;
    const inner = [Math.max(1, size[0] - pl - pr), Math.max(1, size[1] - pt - pb)];
    const all = boundingExtent(simulatedTargets.map((x) => [x.position[0], x.position[1]]));
    const overview = view.getZoomForResolution(view.getResolutionForExtent(buffer(all, 0.0015), inner)) ?? view.getZoom() ?? 15;
    const current = view.getZoom() ?? overview;
    const zoom = Math.min(Math.max(current, overview - 0.5), overview + 1, VIEW_MAX_ZOOM);
    const res = view.getResolutionForZoom(zoom);
    const center = [t.position[0] + ((pr - pl) / 2) * res, t.position[1] + ((pt - pb) / 2) * res];
    view.cancelAnimations();
    view.animate({ center, zoom, duration: prefersReducedMotion() ? 0 : FOCUS_MS, easing: easeOut });
    // Runs once per request; positions are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.n]);

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
        data-sim-markers={markerAttr}
        data-sequence={sequenceAttr}
        data-selected-id={selectedId ?? ""}
        data-motion={reducedMotion ? "reduced" : "full"}
        tabIndex={0}
        role="application"
        aria-label={ariaLabel}
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
