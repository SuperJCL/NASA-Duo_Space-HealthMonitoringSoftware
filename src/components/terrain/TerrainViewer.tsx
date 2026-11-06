"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  DEFAULT_EXAGGERATION,
  EXAGGERATIONS,
  gridToLonLat,
  insideCrop,
  lonLatToLocal,
  lonLatToUv,
  sampleHeight,
  sourceLine,
  type Exaggeration,
  type LonLat,
  type TerrainMeta,
} from "@/lib/terrain/terrain";

export type TerrainMarkerTone = "candidate" | "added" | "planned" | "active" | "done" | "skipped" | "infeasible";
export type TerrainMarker = {
  id: string;
  /** "verified": NASA/PDS record; "simulated": scenario-defined target. Never mixed up. */
  kind: "verified" | "simulated";
  name: string;
  position: LonLat;
  badge?: string;
  status?: string;
  tone?: TerrainMarkerTone;
};

export type TerrainViewerProps = {
  meta: TerrainMeta;
  markers: readonly TerrainMarker[];
  /** Verified historical rover traverse (lines), clipped to the crop. */
  traverse?: readonly (readonly LonLat[])[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called when 3D cannot be shown (no WebGL, data failed, checksum mismatch, context lost). */
  onFallback: (reason: string) => void;
};

const TONE_COLOR: Record<TerrainMarkerTone, number> = {
  candidate: 0xff8a6b,
  added: 0xff8a6b,
  planned: 0xff8a6b,
  active: 0xffffff,
  done: 0x84d8a6,
  skipped: 0x8b97a8,
  infeasible: 0xf1c878,
};
const VERIFIED = 0x8ecae6;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const defaultQuality = (): "standard" | "low" => {
  if (typeof window === "undefined") return "standard";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return window.innerWidth < 768 || (mem !== undefined && mem <= 4) ? "low" : "standard";
};
const fmt = (v: number) => `${Math.round(v).toLocaleString("en-US").replace("-", "−")} m`;

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // non-secure contexts: skip, the size check still applies
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * MAP-3A local 3D terrain: the verified CTX DTM crop (real elevations, 20 m
 * posts), draped with the matching CTX orthomosaic. Verified sample sites and
 * simulated targets are drawn with distinct markers. Not a route, travel-time
 * or traversability model.
 */
export function TerrainViewer({ meta, markers, traverse = [], selectedId, onSelect, onFallback }: TerrainViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<Float32Array | null>(null);
  const [imageryOk, setImageryOk] = useState<boolean | null>(null);
  const [exaggeration, setExaggeration] = useState<Exaggeration>(DEFAULT_EXAGGERATION);
  const [quality, setQuality] = useState<"standard" | "low">(defaultQuality);
  const [pointerElev, setPointerElev] = useState<number | null>(null);
  // Caveats are always available; on narrow screens they start collapsed so the terrain stays visible.
  const [aboutOpen, setAboutOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);
  // On phones the button panel starts collapsed (touch already orbits, tilts and pinch-zooms).
  const [controlsOpen, setControlsOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);
  const [labels, setLabels] = useState<{ id: string; x: number; y: number; visible: boolean }[]>([]);
  const [camState, setCamState] = useState({ azDeg: 0, polarDeg: 0, distM: 0 });
  const onSelectRef = useRef(onSelect);
  const onFallbackRef = useRef(onFallback);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onFallbackRef.current = onFallback;
  }, [onSelect, onFallback]);

  // Three.js objects live in refs; React state only drives the HTML overlay.
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    terrain: THREE.Mesh | null;
    markerGroup: THREE.Group;
    ring: THREE.Mesh;
    render: () => void;
  } | null>(null);

  const markerData = useMemo(
    () =>
      heights
        ? markers
            .filter((mk) => insideCrop(meta, mk.position))
            .map((mk) => {
              const h = sampleHeight(meta, heights, mk.position) ?? meta.heights.minM;
              const [e, n] = lonLatToLocal(meta, mk.position);
              return { ...mk, elevation: h, east: e, north: n };
            })
        : [],
    [markers, heights, meta],
  );
  const reference = markerData.find((m) => m.id === "sample-lefroy-bay");

  // 1. Load and verify the data (heights checksum), create the renderer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(meta.heights.file);
        if (!res.ok) throw new Error(`the terrain data could not be loaded (HTTP ${res.status})`);
        const buf = await res.arrayBuffer();
        if (buf.byteLength !== meta.crop.cols * meta.crop.rows * 4) throw new Error("terrain data has an unexpected size");
        const digest = await sha256Hex(buf);
        if (digest && digest !== meta.heights.sha256) throw new Error("terrain data does not match its recorded checksum");
        if (!cancelled) setHeights(new Float32Array(buf));
      } catch (e) {
        // A network failure surfaces as a TypeError ("Failed to fetch"): say it in plain words.
        if (!cancelled) onFallbackRef.current(e instanceof TypeError ? "the terrain data could not be downloaded" : e instanceof Error ? e.message : "the terrain data could not be loaded");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta]);

  // 2. Scene setup once the heights are available.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !heights) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      onFallbackRef.current("WebGL is not available in this browser");
      return;
    }
    renderer.setClearColor(0x0b111c);
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("data-testid", "terrain-canvas");
    renderer.domElement.style.display = "block";
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 10, 50000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(-3000, 2500, 1500);
    scene.add(sun);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reducedMotion();
    controls.minDistance = 250;
    controls.maxDistance = 7000;
    controls.maxPolarAngle = (85 * Math.PI) / 180;
    controls.screenSpacePanning = false;
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(34, 4, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    scene.add(ring);

    let frame = 0;
    const render = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (controls.enableDamping) controls.update();
        renderer.render(scene, camera);
        // Project markers for the HTML labels and expose camera state.
        const w = renderer.domElement.clientWidth;
        const h = renderer.domElement.clientHeight;
        const projected = markerGroup.children.map((o) => {
          const v = o.position.clone().add(new THREE.Vector3(0, 30, 0)).project(camera);
          return { id: String(o.userData.id), x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z < 1 && v.z > -1 };
        });
        // Keep labels readable: stack a label above any earlier one it would overlap (nearest first).
        const placed: { x: number; y: number }[] = [];
        for (const l of [...projected].sort((a, b) => b.y - a.y)) {
          if (!l.visible) continue;
          while (placed.some((q) => Math.abs(q.x - l.x) < 130 && Math.abs(q.y - l.y) < 22)) l.y -= 22;
          placed.push(l);
        }
        setLabels(projected);
        const off = camera.position.clone().sub(controls.target);
        const sph = new THREE.Spherical().setFromVector3(off);
        setCamState({ azDeg: Math.round((sph.theta * 180) / Math.PI), polarDeg: Math.round((sph.phi * 180) / Math.PI), distM: Math.round(sph.radius) });
      });
    };
    controls.addEventListener("change", render);
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    renderer.domElement.addEventListener("webglcontextlost", () => onFallbackRef.current("the WebGL context was lost"));

    // Initial camera: looking north-east-ish at the crop centre, tilted, the whole crop in view.
    camera.position.set(-1400, 2200, 2400);
    controls.target.set(0, 0, 0);
    controls.update();
    sceneRef.current = { renderer, scene, camera, controls, terrain: null, markerGroup, ring, render };
    resize();

    // Clicking a marker selects it (the HTML labels do the same, accessibly).
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; // a drag, not a click
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(markerGroup.children, true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && o.userData.id === undefined) o = o.parent;
      if (o) onSelectRef.current(String(o.userData.id));
    };
    // Elevation under the pointer, read back from the DTM (not from the mesh).
    let pending = 0;
    const onMove = (e: PointerEvent) => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const t = sceneRef.current?.terrain;
        if (!t) return;
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObject(t)[0];
        if (!hit) return setPointerElev(null);
        const [lon0, lat0] = [(meta.crop.bboxDeg[0] + meta.crop.bboxDeg[2]) / 2, (meta.crop.bboxDeg[1] + meta.crop.bboxDeg[3]) / 2];
        const R = 3396190;
        const lon = lon0 + ((hit.point.x / (R * Math.cos((lat0 * Math.PI) / 180))) * 180) / Math.PI;
        const lat = lat0 + ((-hit.point.z / R) * 180) / Math.PI;
        setPointerElev(sampleHeight(meta, heights, [lon, lat]));
      });
    };
    const onLeave = () => setPointerElev(null);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    return () => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (pending) cancelAnimationFrame(pending);
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            (m as THREE.MeshStandardMaterial).map?.dispose();
            m.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [heights, meta]);

  // 3. Terrain mesh, markers and traverse; rebuilt when exaggeration or quality changes.
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !heights) return;
    const { scene, markerGroup, render } = ctx;
    const step = quality === "low" ? 2 : 1;
    const cols = Math.floor((meta.crop.cols - 1) / step) + 1;
    const rows = Math.floor((meta.crop.rows - 1) / step) + 1;
    const base = meta.heights.minM;
    const pos = new Float32Array(cols * rows * 3);
    const uv = new Float32Array(cols * rows * 2);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const gc = Math.min(c * step, meta.crop.cols - 1);
        const gr = Math.min(r * step, meta.crop.rows - 1);
        const ll = gridToLonLat(meta, gc + 0.5, gr + 0.5);
        const [e, n] = lonLatToLocal(meta, ll);
        const k = r * cols + c;
        pos[k * 3] = e;
        pos[k * 3 + 1] = (heights[gr * meta.crop.cols + gc] - base) * exaggeration;
        pos[k * 3 + 2] = -n;
        const [u, v] = lonLatToUv(meta, ll);
        uv[k * 2] = u;
        uv[k * 2 + 1] = 1 - v;
      }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geom.setIndex(idx);
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    new THREE.TextureLoader().load(
      meta.imagery.file,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        mat.map = tex;
        mat.needsUpdate = true;
        setImageryOk(true);
        render();
      },
      undefined,
      () => {
        // Imagery is optional: without it the terrain is shaded by its own slopes only.
        mat.color.set(0xc9b8a6);
        setImageryOk(false);
        render();
      },
    );
    const terrain = new THREE.Mesh(geom, mat);
    terrain.name = "terrain";
    scene.add(terrain);
    ctx.terrain = terrain;

    // Markers sit on the DTM surface (same exaggeration as the terrain).
    for (const mk of markerData) {
      const y = (mk.elevation - base) * exaggeration;
      const g = new THREE.Group();
      g.userData.id = mk.id;
      g.position.set(mk.east, y, -mk.north);
      if (mk.kind === "verified") {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 12), new THREE.MeshBasicMaterial({ color: VERIFIED }));
        ball.position.y = 14;
        g.add(ball);
      } else {
        const d = new THREE.Mesh(new THREE.OctahedronGeometry(20), new THREE.MeshBasicMaterial({ color: TONE_COLOR[mk.tone ?? "candidate"] }));
        d.position.y = 26;
        g.add(d);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 26, 6), new THREE.MeshBasicMaterial({ color: TONE_COLOR[mk.tone ?? "candidate"] }));
        stem.position.y = 13;
        g.add(stem);
      }
      markerGroup.add(g);
    }
    // Verified traverse, draped 2 m above the DTM.
    const lines: THREE.Line[] = [];
    for (const seg of traverse) {
      const pts = seg
        .filter((p) => insideCrop(meta, p))
        .map((p) => {
          const [e, n] = lonLatToLocal(meta, p);
          return new THREE.Vector3(e, ((sampleHeight(meta, heights, p) ?? base) - base) * exaggeration + 2, -n);
        });
      if (pts.length < 2) continue;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: VERIFIED }));
      scene.add(line);
      lines.push(line);
    }
    render();
    return () => {
      scene.remove(terrain);
      geom.dispose();
      mat.map?.dispose();
      mat.dispose();
      for (const child of [...markerGroup.children]) {
        markerGroup.remove(child);
        child.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
      }
      for (const l of lines) {
        scene.remove(l);
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
      ctx.terrain = null;
    };
  }, [heights, meta, exaggeration, quality, markerData, traverse]);

  // 4. Selection: highlight ring, and keep the selected target as the orbit centre.
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const sel = markerData.find((m) => m.id === selectedId);
    ctx.ring.visible = Boolean(sel);
    if (sel) {
      const y = (sel.elevation - meta.heights.minM) * exaggeration;
      ctx.ring.position.set(sel.east, y + 3, -sel.north);
      const delta = new THREE.Vector3(sel.east, y, -sel.north).sub(ctx.controls.target);
      ctx.controls.target.add(delta);
      ctx.camera.position.add(delta);
      // Come closer if far away, so nearby targets separate (bounded: never nearer than 1.4 km on selection).
      const off = ctx.camera.position.clone().sub(ctx.controls.target);
      if (off.length() > 1400) ctx.camera.position.copy(ctx.controls.target).add(off.setLength(1400));
      ctx.controls.update();
    }
    ctx.render();
  }, [selectedId, markerData, exaggeration, meta]);

  /** Explicit camera controls (keyboard and touch accessible): orbit, tilt, zoom, reset. */
  const move = (kind: "left" | "right" | "up" | "down" | "in" | "out" | "reset") => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { camera, controls } = ctx;
    if (kind === "reset") {
      controls.target.set(0, 0, 0);
      camera.position.set(-1400, 2200, 2400);
    } else {
      const off = camera.position.clone().sub(controls.target);
      const s = new THREE.Spherical().setFromVector3(off);
      if (kind === "left") s.theta -= Math.PI / 12;
      if (kind === "right") s.theta += Math.PI / 12;
      if (kind === "up") s.phi = Math.max(0.05, s.phi - Math.PI / 18);
      if (kind === "down") s.phi = Math.min(controls.maxPolarAngle, s.phi + Math.PI / 18);
      if (kind === "in") s.radius = Math.max(controls.minDistance, s.radius * 0.8);
      if (kind === "out") s.radius = Math.min(controls.maxDistance, s.radius * 1.25);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
    }
    controls.update();
    ctx.render();
  };

  const sel = markerData.find((m) => m.id === selectedId);
  const state = JSON.stringify({
    loaded: Boolean(heights),
    imagery: imageryOk === null ? "loading" : imageryOk ? "ortho" : "shaded",
    exaggeration,
    quality,
    selected: selectedId,
    markers: markerData.map((m) => ({ id: m.id, kind: m.kind, elevationM: Math.round(m.elevation) })),
    camera: camState,
  });

  return (
    <div className="relative size-full overflow-hidden bg-[#0b111c]" data-testid="terrain-viewer" data-terrain-state={state} data-motion={reducedMotion() ? "reduced" : "full"}>
      <div
        ref={hostRef}
        className="absolute inset-0 touch-none"
        role="img"
        aria-label="3D view of the CTX elevation model around Lefroy Bay. Use the buttons to rotate, tilt and zoom; the marker labels select targets."
      />
      {!heights ? <p className="absolute inset-0 flex items-center justify-center text-sm text-[var(--mg-dim)]">{"Loading verified CTX terrain…"}</p> : null}

      {/* Marker labels: HTML buttons, so they are keyboard accessible and translation-safe. */}
      {labels.map((l) => {
        const m = markerData.find((x) => x.id === l.id);
        if (!m || !l.visible) return null;
        const selected = m.id === selectedId;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            aria-pressed={selected}
            aria-label={m.kind === "verified" ? `${m.name}, verified NASA/PDS sample site, elevation ${fmt(m.elevation)}` : `${m.name}, simulated target (scenario-defined position), elevation ${fmt(m.elevation)}${m.status ? `, ${m.status}` : ""}`}
            className={`absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[12px] font-semibold ${
              m.kind === "verified" ? "border-[#8ecae6] bg-[rgba(11,17,28,0.8)] text-[#8ecae6]" : "border-[var(--mg-coral)] bg-[rgba(11,17,28,0.8)] text-[var(--mg-coral)]"
            } ${selected ? "ring-2 ring-white" : ""}`}
            style={{ left: l.x, top: l.y }}
            data-testid={`terrain-label-${m.id}`}
            data-kind={m.kind}
          >
            {m.kind === "verified" ? `${m.name} · ${fmt(m.elevation)}` : `SIM · ${m.name}${m.badge ? ` #${m.badge}` : ""}`}
          </button>
        );
      })}

      {/* Source, resolution, exaggeration and caveats: always visible. */}
      <div className="mg-glass absolute bottom-3 left-3 right-3 max-w-xl p-3 text-[12px] text-[var(--mg-dim)] sm:right-auto" data-testid="terrain-info">
        <p className="font-medium text-[var(--mg-text)] [overflow-wrap:anywhere]" data-testid="terrain-source">
          {sourceLine(meta)}
        </p>
        <p className="mt-0.5" data-testid="terrain-exaggeration-label">
          {exaggeration === 1 ? "Vertical exaggeration: 1× (true scale)" : `Vertical exaggeration: ${exaggeration}× (heights stretched; not true scale)`}
        </p>
        <p className="mt-0.5" data-testid="terrain-elevation">
          {pointerElev !== null
            ? `Pointer: ${fmt(pointerElev)} (DTM, areoid)`
            : sel
              ? `${sel.name}: ${fmt(sel.elevation)} (DTM)${
                  reference && sel.id !== reference.id
                    ? Math.abs(sel.elevation - reference.elevation) < 5
                      ? " · within 5 m of the Lefroy Bay site (not a meaningful difference at this resolution)"
                      : ` · ${Math.abs(Math.round(sel.elevation - reference.elevation))} m ${sel.elevation >= reference.elevation ? "above" : "below"} the Lefroy Bay site (DTM)`
                    : ""
                }`
              : `Elevations in this crop: ${fmt(meta.heights.minM)} to ${fmt(meta.heights.maxM)} (areoid)`}
        </p>
        <button type="button" aria-expanded={aboutOpen} onClick={() => setAboutOpen((o) => !o)} className="mt-1 text-[12px] text-[var(--mg-text)] underline underline-offset-2" data-testid="terrain-about">
          {aboutOpen ? "Hide notes" : "About this 3D view"}
        </button>
        <p hidden={!aboutOpen} className="mt-0.5 text-[var(--mg-faint)]" data-testid="terrain-caveats">
          {`Differences under about 5 m are not meaningful (DTM vs PDS sample elevations: ${meta.validation.pdsSampleSites.map((p) => p.differenceM.toFixed(1)).join(", ")} m). Not a route or traversability model. Coral: simulated targets (scenario-defined); priorities provisional, not validated. Cyan: verified NASA/PDS sample sites and traverse.`}
        </p>
        {imageryOk === false ? <p className="mt-0.5 text-[var(--mg-caution)]">{"Orthoimage unavailable: the terrain is shown with slope shading only."}</p> : null}
      </div>

      {/* Camera, exaggeration and quality controls. */}
      <div className="absolute right-3 top-16 flex flex-col items-end gap-2 sm:top-3" data-testid="terrain-controls">
        <button
          type="button"
          aria-expanded={controlsOpen}
          onClick={() => setControlsOpen((o) => !o)}
          className="mg-glass min-h-9 px-3 text-[12px] sm:hidden"
          data-testid="terrain-controls-toggle"
        >
          {controlsOpen ? "Hide view controls" : "View controls"}
        </button>
        <div hidden={!controlsOpen} className="mg-glass grid grid-cols-3 gap-1 p-1.5" role="group" aria-label="Camera">
          <button type="button" onClick={() => move("up")} aria-label="Tilt up" className="size-9 rounded-lg text-lg" data-testid="terrain-tilt-up">
            {"▲"}
          </button>
          <button type="button" onClick={() => move("in")} aria-label="Zoom in" className="size-9 rounded-lg text-lg" data-testid="terrain-zoom-in">
            {"+"}
          </button>
          <button type="button" onClick={() => move("reset")} aria-label="Reset view" className="size-9 rounded-lg text-sm" data-testid="terrain-reset">
            {"⟲"}
          </button>
          <button type="button" onClick={() => move("left")} aria-label="Rotate left" className="size-9 rounded-lg text-lg" data-testid="terrain-rotate-left">
            {"◀"}
          </button>
          <button type="button" onClick={() => move("down")} aria-label="Tilt down" className="size-9 rounded-lg text-lg" data-testid="terrain-tilt-down">
            {"▼"}
          </button>
          <button type="button" onClick={() => move("right")} aria-label="Rotate right" className="size-9 rounded-lg text-lg" data-testid="terrain-rotate-right">
            {"▶"}
          </button>
          <span />
          <button type="button" onClick={() => move("out")} aria-label="Zoom out" className="size-9 rounded-lg text-lg" data-testid="terrain-zoom-out">
            {"−"}
          </button>
          <span />
        </div>
        <label hidden={!controlsOpen} className="mg-glass flex items-center gap-2 px-2 py-1.5 text-[12px]">
          <span>{"Vertical"}</span>
          <select value={exaggeration} onChange={(e) => setExaggeration(Number(e.target.value) as Exaggeration)} className="rounded bg-[var(--mg-bg)] px-1" aria-label="Vertical exaggeration" data-testid="terrain-exaggeration">
            {EXAGGERATIONS.map((x) => (
              <option key={x} value={x}>
                {x === 1 ? "1× true" : `${x}×`}
              </option>
            ))}
          </select>
        </label>
        <label hidden={!controlsOpen} className="mg-glass flex items-center gap-2 px-2 py-1.5 text-[12px]">
          <span>{"Quality"}</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value as "standard" | "low")} className="rounded bg-[var(--mg-bg)] px-1" aria-label="Rendering quality" data-testid="terrain-quality">
            <option value="standard">{"Standard"}</option>
            <option value="low">{"Low"}</option>
          </select>
        </label>
      </div>
    </div>
  );
}
