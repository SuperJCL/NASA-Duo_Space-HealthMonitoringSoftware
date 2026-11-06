"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CAMERA_PRESETS,
  CONTOUR_INTERVAL_M,
  DEFAULT_EXAGGERATION,
  EXAGGERATIONS,
  profileAlong,
  reliefHeadline,
  reliefStatement,
  reliefSummary,
  type CameraPreset,
  gridToLonLat,
  insideCrop,
  localRange,
  lonLatToLocal,
  lonLatToUv,
  sampleHeight,
  sourceLine,
  type Exaggeration,
  type Profile,
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
const PROFILE = 0xffd166;
type Surface = "imagery" | "relief" | "elevation";
const SURFACE_LABEL: Record<Surface, string> = { imagery: "Imagery", relief: "Relief shading", elevation: "Elevation colours" };
// Fixed low sun from the north-west (azimuth 315°, 25° above the horizon), x east / y up / z south.
const SUN = new THREE.Vector3(-Math.sin(Math.PI / 4) * Math.cos((25 * Math.PI) / 180), Math.sin((25 * Math.PI) / 180), -Math.cos(Math.PI / 4) * Math.cos((25 * Math.PI) / 180)).normalize();

/** Surface mode and contours are uniforms only: switching never rebuilds or changes the geometry. */
function applyLook(mat: THREE.ShaderMaterial, surface: Surface, contours: boolean) {
  mat.uniforms.uSurface.value = surface === "imagery" ? 0 : surface === "relief" ? 1 : 2;
  mat.uniforms.uContours.value = contours ? 1 : 0;
}

/**
 * MAP-3A.1 terrain material. Colours only: the geometry is the DTM. Shading
 * uses the mesh normals and a fixed low sun (contrast-enhanced for gentle
 * slopes, and labelled as such); elevation colours and contours use the TRUE
 * elevation attribute, so they do not change with exaggeration.
 */
function terrainMaterial(minM: number, maxM: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null as THREE.Texture | null },
      uHasMap: { value: 0 },
      uSurface: { value: 1 },
      uContours: { value: 1 },
      uInterval: { value: CONTOUR_INTERVAL_M },
      uMin: { value: minM },
      uMax: { value: maxM },
      uSun: { value: SUN },
      uFlat: { value: SUN.y },
    },
    vertexShader: `
      attribute float elev;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying float vElev;
      void main() {
        vUv = uv;
        vNormal = normal;
        vElev = elev;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uHasMap;
      uniform int uSurface;
      uniform float uContours;
      uniform float uInterval;
      uniform float uMin;
      uniform float uMax;
      uniform vec3 uSun;
      uniform float uFlat;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying float vElev;
      vec3 ramp(float t) {
        vec3 a = vec3(0.10, 0.30, 0.42), b = vec3(0.42, 0.58, 0.48), c = vec3(0.82, 0.70, 0.45), d = vec3(0.95, 0.90, 0.82);
        if (t < 0.333) return mix(a, b, t / 0.333);
        if (t < 0.666) return mix(b, c, (t - 0.333) / 0.333);
        return mix(c, d, (t - 0.666) / 0.334);
      }
      void main() {
        float lambert = max(dot(normalize(vNormal), normalize(uSun)), 0.0);
        vec3 img = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : vec3(0.55, 0.50, 0.45);
        vec3 col;
        if (uSurface == 0) {
          col = img * clamp(1.0 + 1.2 * (lambert - uFlat), 0.6, 1.4);
        } else if (uSurface == 1) {
          col = img * clamp(1.0 + 4.0 * (lambert - uFlat), 0.25, 1.9);
        } else {
          float t = clamp((vElev - uMin) / max(uMax - uMin, 1.0), 0.0, 1.0);
          col = ramp(t) * clamp(1.0 + 3.0 * (lambert - uFlat), 0.3, 1.6);
        }
        if (uContours > 0.5) {
          float f = vElev / uInterval;
          float d = abs(fract(f - 0.5) - 0.5) / max(fwidth(f), 1e-4);
          col = mix(col, vec3(1.0), (1.0 - min(d, 1.0)) * 0.55);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const defaultQuality = (): "standard" | "low" => {
  if (typeof window === "undefined") return "standard";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return window.innerWidth < 768 || (mem !== undefined && mem <= 4) ? "low" : "standard";
};
const fmt = (v: number) => `${Math.round(v).toLocaleString("en-US").replace("-", "−")} m`;
const fmtSigned = (v: number) => `${Math.round(v) > 0 ? "+" : ""}${fmt(v)}`;
const fmtDeg = ([lon, lat]: LonLat) => `${lon.toFixed(4)}° E, ${lat.toFixed(4)}° N`;
const RAMP_CSS = "linear-gradient(to right, rgb(26,77,107), rgb(107,148,122), rgb(209,179,115), rgb(242,230,209))";
// Profile chart geometry (SVG viewBox units; uniform scale).
const CH = { w: 320, h: 120, l: 46, r: 8, t: 8, b: 18 };

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
  const [aboutOpen, setAboutOpen] = useState(false);
  // On phones the button panel starts collapsed (touch already orbits, tilts and pinch-zooms).
  const [controlsOpen, setControlsOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);
  const [labels, setLabels] = useState<{ id: string; x: number; y: number; visible: boolean }[]>([]);
  const [camState, setCamState] = useState({ azDeg: 0, polarDeg: 0, distM: 0 });
  // MAP-3A.1: surface rendering, presets and the straight-line profile.
  const [surface, setSurface] = useState<Surface>("relief");
  const [contours, setContours] = useState(true);
  // Read when the terrain mesh is (re)built, so a rebuild keeps the chosen surface.
  const surfaceRef = useRef(surface);
  const contoursRef = useRef(contours);
  const [preset, setPreset] = useState<CameraPreset | "custom">("custom");
  type End = { id: string | null; name: string; position: LonLat };
  const [profileEnds, setProfileEnds] = useState<{ from: End; to: End } | null>(null);
  const [profileOpen, setProfileOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);
  const [picking, setPicking] = useState<LonLat[] | null>(null);
  const pickingRef = useRef<LonLat[] | null>(null);
  useEffect(() => {
    pickingRef.current = picking;
  }, [picking]);
  const [chartHover, setChartHover] = useState<number | null>(null);
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
  const relief = useMemo(() => (heights && reference ? reliefSummary(meta, heights, reference.position) : null), [heights, meta, reference]);
  // Default profile until the user chooses: Comet Geyser → Pelican Point (verified sites across the crop).
  const defaultEnds = useMemo(() => {
    const a = markerData.find((m) => m.id === "sample-comet-geyser");
    const b = markerData.find((m) => m.id === "sample-pelican-point");
    return a && b ? { from: { id: a.id, name: a.name, position: a.position }, to: { id: b.id, name: b.name, position: b.position } } : null;
  }, [markerData]);
  const ends = profileEnds ?? defaultEnds;
  const profile = useMemo(() => (heights && ends ? profileAlong(meta, heights, ends.from.position, ends.to.position) : null), [heights, meta, ends]);
  // Local elevation range (DTM posts within 300 m) around the selected marker, else Lefroy Bay.
  const LOCAL_RADIUS_M = 300;
  const localOf = markerData.find((m) => m.id === selectedId) ?? reference;
  const local = useMemo(() => (heights && localOf ? localRange(meta, heights, localOf.position, LOCAL_RADIUS_M) : null), [heights, meta, localOf]);
  // Escape cancels picking profile points.
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicking(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

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
    // Any direct drag, pinch or wheel leaves the named preset.
    controls.addEventListener("start", () => setPreset("custom"));
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

    // Local scene metres (x east, z south) back to lon/lat, on the same tangent plane as lonLatToLocal.
    const toLonLat = (p: THREE.Vector3): LonLat => {
      const lon0 = (meta.crop.bboxDeg[0] + meta.crop.bboxDeg[2]) / 2;
      const lat0 = (meta.crop.bboxDeg[1] + meta.crop.bboxDeg[3]) / 2;
      const R = 3396190;
      return [lon0 + ((p.x / (R * Math.cos((lat0 * Math.PI) / 180))) * 180) / Math.PI, lat0 + ((-p.z / R) * 180) / Math.PI];
    };
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
      // MAP-3A.1: picking profile end points on the terrain.
      if (pickingRef.current) {
        const t = sceneRef.current?.terrain;
        const hitT = t ? ray.intersectObject(t)[0] : undefined;
        if (hitT) {
          const p = toLonLat(hitT.point);
          const pts = [...pickingRef.current, p];
          if (pts.length >= 2) {
            setPicking(null);
            setProfileEnds({ from: { id: null, name: "Point 1", position: pts[0] }, to: { id: null, name: "Point 2", position: pts[1] } });
          } else setPicking(pts);
        }
        return;
      }
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
        setPointerElev(sampleHeight(meta, heights, toLonLat(hit.point)));
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
    const elev = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const gc = Math.min(c * step, meta.crop.cols - 1);
        const gr = Math.min(r * step, meta.crop.rows - 1);
        const ll = gridToLonLat(meta, gc + 0.5, gr + 0.5);
        const [e, n] = lonLatToLocal(meta, ll);
        const k = r * cols + c;
        pos[k * 3] = e;
        elev[k] = heights[gr * meta.crop.cols + gc];
        pos[k * 3 + 1] = (elev[k] - base) * exaggeration;
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
    geom.setAttribute("elev", new THREE.BufferAttribute(elev, 1));
    geom.setIndex(idx);
    geom.computeVertexNormals();
    const mat = terrainMaterial(meta.heights.minM, meta.heights.maxM);
    applyLook(mat, surfaceRef.current, contoursRef.current);
    new THREE.TextureLoader().load(
      meta.imagery.file,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        mat.uniforms.uMap.value = tex;
        mat.uniforms.uHasMap.value = 1;
        setImageryOk(true);
        render();
      },
      undefined,
      () => {
        // Imagery is optional: without it the terrain is shaded by its own slopes only.
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
      (mat.uniforms.uMap.value as THREE.Texture | null)?.dispose();
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

  // MAP-3A.1: surface and contours only change uniforms (no rebuild).
  useEffect(() => {
    surfaceRef.current = surface;
    contoursRef.current = contours;
    const ctx = sceneRef.current;
    const mat = ctx?.terrain?.material as THREE.ShaderMaterial | undefined;
    if (!ctx || !mat?.uniforms) return;
    applyLook(mat, surface, contours);
    ctx.render();
  }, [surface, contours, heights, quality, exaggeration]);

  // MAP-3A.1: the profile's straight sampling line in 3D (amber), drawn 6 m above the DTM samples.
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !profile) return;
    const base = meta.heights.minM;
    const pts = profile.samples.map((p) => {
      const [e, n] = lonLatToLocal(meta, [p.lon, p.lat]);
      return new THREE.Vector3(e, (p.elevationM - base) * exaggeration + 6, -n);
    });
    // A thin tube (5 m radius) so the line stays visible at any zoom; it follows the DTM samples.
    const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "centripetal"), Math.max(8, pts.length * 2), 5, 6, false), new THREE.MeshBasicMaterial({ color: PROFILE }));
    const endDots = [pts[0], pts[pts.length - 1]].map((v) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), new THREE.MeshBasicMaterial({ color: PROFILE }));
      s.position.copy(v);
      return s;
    });
    ctx.scene.add(line, ...endDots);
    ctx.render();
    return () => {
      ctx.scene.remove(line, ...endDots);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      for (const s of endDots) {
        s.geometry.dispose();
        (s.material as THREE.Material).dispose();
      }
      ctx.render();
    };
  }, [profile, exaggeration, meta, heights, quality]);

  // The chart's read-out point, shown on the terrain too (links the chart to the 3D position).
  useEffect(() => {
    const ctx = sceneRef.current;
    const p = profile && chartHover !== null ? profile.samples[chartHover] : undefined;
    if (!ctx || !p) return;
    const [e, n] = lonLatToLocal(meta, [p.lon, p.lat]);
    // A read-out cursor (like the HTML labels, drawn on top so hills never hide it).
    const dot = new THREE.Mesh(new THREE.SphereGeometry(16, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    dot.renderOrder = 10;
    dot.position.set(e, (p.elevationM - meta.heights.minM) * exaggeration + 6, -n);
    ctx.scene.add(dot);
    ctx.render();
    return () => {
      ctx.scene.remove(dot);
      dot.geometry.dispose();
      (dot.material as THREE.Material).dispose();
      ctx.render();
    };
  }, [chartHover, profile, exaggeration, meta, heights, quality]);

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

  /** MAP-3A.1 camera presets (instant: no animated flight, so reduced motion is respected). */
  const applyPreset = (name: CameraPreset) => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const p = CAMERA_PRESETS[name];
    const selMarker = markerData.find((m) => m.id === selectedId);
    const target = selMarker ? new THREE.Vector3(selMarker.east, (selMarker.elevation - meta.heights.minM) * exaggeration, -selMarker.north) : new THREE.Vector3(0, 0, 0);
    ctx.controls.target.copy(target);
    const sph = new THREE.Spherical(p.distanceM, (p.polarDeg * Math.PI) / 180, (p.azimuthDeg * Math.PI) / 180);
    ctx.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    ctx.controls.update();
    ctx.render();
    setPreset(name);
  };

  /** Explicit camera controls (keyboard and touch accessible): orbit, tilt, zoom, reset. */
  const move = (kind: "left" | "right" | "up" | "down" | "in" | "out" | "reset") => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    setPreset("custom");
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
    preset,
    surface,
    contours,
    picking: picking ? picking.length : null,
    profile: profile
      ? { from: ends?.from.id ?? ends?.from.name, to: ends?.to.id ?? ends?.to.name, lengthM: Math.round(profile.lengthM), startM: Math.round(profile.startM), endM: Math.round(profile.endM), minM: Math.round(profile.minM), maxM: Math.round(profile.maxM), netM: Math.round(profile.netChangeM) }
      : null,
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

      {picking ? (
        <p className="mg-glass absolute left-1/2 top-16 z-10 -translate-x-1/2 px-3 py-1.5 text-[12px] text-[var(--mg-text)]" role="status" data-testid="terrain-picking">
          {`Click point ${picking.length + 1} of 2 on the terrain for the profile. Esc cancels.`}
        </p>
      ) : null}

      {/* Bottom panels; the box stops below the toolbar and view-controls button, so panels never cover them. */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 top-28 flex flex-wrap-reverse content-start items-start gap-2 sm:top-3">
        {/* Source, resolution, exaggeration, real relief and caveats: always visible. */}
        {/* On phones the open profile takes this panel's place, so the terrain stays visible. */}
        <div className={`mg-glass pointer-events-auto w-full max-w-md p-3 text-[12px] text-[var(--mg-dim)] ${profileOpen ? "max-sm:hidden" : ""}`} data-testid="terrain-info">
          <p className="font-medium text-[var(--mg-text)] [overflow-wrap:anywhere]" data-testid="terrain-source">
            <span className="max-sm:hidden">{sourceLine(meta)}</span>
            {/* Narrow screens: the same source and resolutions; the DTM product id is in the notes. */}
            <span className="sm:hidden">{sourceLine(meta).replace(/ \([^)]*_DTM_[^)]*\)/, "")}</span>
          </p>
          <p className={`mt-0.5 ${exaggeration === 1 ? "" : "font-semibold text-[var(--mg-caution)]"}`} data-testid="terrain-exaggeration-label">
            {exaggeration === 1 ? "Vertical exaggeration: 1× (true scale)" : `Vertical exaggeration: ${exaggeration}× (heights stretched ${exaggeration} times; not true scale)`}
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
          {local && localOf ? (
            <p className="mt-0.5" data-testid="terrain-local-range">
              {`Local range within ${LOCAL_RADIUS_M} m of ${localOf.name}: ${fmt(local.minM)} to ${fmt(local.maxM)} (${Math.round(local.reliefM)} m).`}
            </p>
          ) : null}
          {relief ? (
            <>
              <p className="mt-1 text-[var(--mg-text)] max-sm:hidden" data-testid="terrain-relief-note">
                {reliefStatement(relief, "Lefroy Bay")}
              </p>
              <p className="mt-1 text-[var(--mg-text)] sm:hidden" data-testid="terrain-relief-short">
                {reliefHeadline(relief, "Lefroy Bay")}
              </p>
            </>
          ) : null}
          {surface === "elevation" ? (
            <div className="mt-1.5 flex items-center gap-2" data-testid="terrain-legend">
              <span>{fmt(meta.heights.minM)}</span>
              <span className="h-2 flex-1 rounded" style={{ background: RAMP_CSS }} aria-hidden="true" />
              <span>{fmt(meta.heights.maxM)}</span>
            </div>
          ) : null}
          <p className="mt-1">
            <span>{"Not a route or traversability model. "}</span>
            <button type="button" aria-expanded={aboutOpen} onClick={() => setAboutOpen((o) => !o)} className="text-[12px] text-[var(--mg-text)] underline underline-offset-2" data-testid="terrain-about">
              {aboutOpen ? "Hide notes" : "About this 3D view"}
            </button>
          </p>
          <div hidden={!aboutOpen} className="mt-0.5 space-y-0.5 text-[var(--mg-faint)]">
            {relief ? <p className="sm:hidden">{`${reliefStatement(relief, "Lefroy Bay")} DTM product: ${meta.dtm.productLabel}.`}</p> : null}
            <p data-testid="terrain-caveats">
              {`Differences under about 5 m are not meaningful (DTM vs PDS sample elevations: ${meta.validation.pdsSampleSites.map((p) => p.differenceM.toFixed(1)).join(", ")} m). Coral: simulated targets (scenario-defined); priorities provisional, not validated. Cyan: verified NASA/PDS sample sites and traverse. Amber: the profile's straight sampling line.`}
            </p>
            <p data-testid="terrain-shading-note">
              {`Relief shading uses a fixed low sun from the north-west and is contrast-enhanced so gentle slopes are readable; it changes colours only, never heights. Elevation colours and ${CONTOUR_INTERVAL_M} m contours use the true DTM elevations, so they do not change with exaggeration. The profile samples the 20 m DTM bilinearly every 10 m.`}
            </p>
          </div>
          {imageryOk === false ? <p className="mt-0.5 text-[var(--mg-caution)]">{"Orthoimage unavailable: the terrain is shown with slope shading only."}</p> : null}
        </div>

        {/* MAP-3A.1: real-DTM elevation profile along a straight sampling line. */}
        <section className="mg-glass pointer-events-auto max-h-full w-full overflow-y-auto p-3 text-[12px] text-[var(--mg-dim)] sm:ml-auto sm:w-[22rem]" aria-labelledby="terrain-profile-title" data-testid="terrain-profile">
          <div className="flex items-center justify-between gap-2">
            <h3 id="terrain-profile-title" className="text-[13px] font-semibold text-[var(--mg-text)]">
              {"Elevation profile (DTM)"}
            </h3>
            <button type="button" aria-expanded={profileOpen} onClick={() => setProfileOpen((o) => !o)} className="min-h-8 px-1 text-[12px] text-[var(--mg-text)] underline underline-offset-2" data-testid="terrain-profile-toggle">
              {profileOpen ? "Hide" : "Show"}
            </button>
          </div>
          <div hidden={!profileOpen}>
            {/* Phones: the info panel is hidden while the profile is open, so repeat the 3D scale here. */}
            <p className={`sm:hidden ${exaggeration === 1 ? "" : "font-semibold text-[var(--mg-caution)]"}`}>
              {exaggeration === 1 ? "3D view: 1× (true scale)." : `3D view: ${exaggeration}× exaggerated (not true scale).`}
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(["from", "to"] as const).map((end) => {
                const cur = ends?.[end];
                return (
                  <label key={end} className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[11px]">{end === "from" ? "From" : "To"}</span>
                    <select
                      value={cur ? (cur.id ?? "__picked") : ""}
                      onChange={(e) => {
                        const mk = markerData.find((m) => m.id === e.target.value);
                        if (!mk || !ends) return;
                        setChartHover(null);
                        setProfileEnds({ ...ends, [end]: { id: mk.id, name: mk.name, position: mk.position } });
                      }}
                      className="w-full min-w-0 rounded bg-[var(--mg-bg)] px-1 py-0.5 text-[var(--mg-text)]"
                      data-testid={`terrain-profile-${end}`}
                    >
                      {cur && cur.id === null ? <option value="__picked">{`${cur.name} (picked)`}</option> : null}
                      {markerData.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.kind === "verified" ? `${m.name} (verified)` : `SIM · ${m.name}`}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3">
              <button
                type="button"
                onClick={() => {
                  setChartHover(null);
                  setPicking((p) => (p ? null : []));
                }}
                aria-pressed={Boolean(picking)}
                className="min-h-8 text-[12px] text-[var(--mg-text)] underline underline-offset-2"
                data-testid="terrain-profile-pick"
              >
                {picking ? "Cancel picking" : "Pick two points on the terrain"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!ends) return;
                  setChartHover(null);
                  setProfileEnds({ from: ends.to, to: ends.from });
                }}
                className="min-h-8 text-[12px] text-[var(--mg-text)] underline underline-offset-2"
                data-testid="terrain-profile-swap"
              >
                {"Swap ends"}
              </button>
            </div>
            {ends && (ends.from.id === null || ends.to.id === null) ? (
              <p className="text-[11px]" data-testid="terrain-profile-points">
                {`${ends.from.name}: ${fmtDeg(ends.from.position)} · ${ends.to.name}: ${fmtDeg(ends.to.position)}`}
              </p>
            ) : null}
            {ends && ends.from.id !== null && ends.from.id === ends.to.id ? (
              <p className="mt-1.5 text-[var(--mg-caution)]" data-testid="terrain-profile-empty">
                {"Choose two different points."}
              </p>
            ) : profile ? (
              <ProfileChart profile={profile} fromName={ends?.from.name ?? ""} toName={ends?.to.name ?? ""} hover={chartHover} onHover={setChartHover} />
            ) : (
              <p className="mt-1.5 text-[var(--mg-caution)]" data-testid="terrain-profile-empty">
                {heights ? "This line leaves the 3 km DTM crop; no elevations are shown outside it." : "Loading…"}
              </p>
            )}
            <p className="mt-1.5 font-medium text-[var(--mg-text)]" data-testid="terrain-profile-caveat">
              {"Straight sampling line: not a route, not a safe path, no travel time or traversability."}
            </p>
          </div>
        </section>
      </div>

      {/* View controls: presets, camera, exaggeration, surface, contours, quality. */}
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
        <div hidden={!controlsOpen} className="mg-glass w-[12.5rem] space-y-1.5 p-1.5 text-[12px]">
          <div className="grid grid-cols-2 gap-1" role="group" aria-label="Camera presets">
            {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => applyPreset(k)}
                aria-pressed={preset === k}
                aria-label={CAMERA_PRESETS[k].label}
                className={`min-h-8 rounded-lg px-1 text-[11px] leading-tight ${preset === k ? "bg-[rgba(255,255,255,0.18)] font-semibold text-[var(--mg-text)]" : "bg-[rgba(255,255,255,0.05)]"}`}
                data-testid={`terrain-preset-${k}`}
              >
                {k === "overview" ? "Overview" : k === "oblique" ? "Oblique" : k === "lowEast" ? "Low · from E" : "Low · from S"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 justify-items-center gap-0.5" role="group" aria-label="Camera">
            <button type="button" onClick={() => move("left")} aria-label="Rotate left" className="size-9 rounded-lg text-lg" data-testid="terrain-rotate-left">
              {"◀"}
            </button>
            <button type="button" onClick={() => move("up")} aria-label="Tilt up" className="size-9 rounded-lg text-lg" data-testid="terrain-tilt-up">
              {"▲"}
            </button>
            <button type="button" onClick={() => move("down")} aria-label="Tilt down" className="size-9 rounded-lg text-lg" data-testid="terrain-tilt-down">
              {"▼"}
            </button>
            <button type="button" onClick={() => move("right")} aria-label="Rotate right" className="size-9 rounded-lg text-lg" data-testid="terrain-rotate-right">
              {"▶"}
            </button>
            <button type="button" onClick={() => move("in")} aria-label="Zoom in" className="size-9 rounded-lg text-lg" data-testid="terrain-zoom-in">
              {"+"}
            </button>
            <button type="button" onClick={() => move("out")} aria-label="Zoom out" className="size-9 rounded-lg text-lg" data-testid="terrain-zoom-out">
              {"−"}
            </button>
            <button type="button" onClick={() => move("reset")} aria-label="Reset view" className="size-9 rounded-lg text-sm" data-testid="terrain-reset">
              {"⟲"}
            </button>
          </div>
          <label className="flex items-center justify-between gap-2 px-1">
            <span>{"Vertical"}</span>
            <select value={exaggeration} onChange={(e) => setExaggeration(Number(e.target.value) as Exaggeration)} className="min-w-0 rounded bg-[var(--mg-bg)] px-1" aria-label="Vertical exaggeration" data-testid="terrain-exaggeration">
              {EXAGGERATIONS.map((x) => (
                <option key={x} value={x}>
                  {x === 1 ? "1× true scale" : `${x}× exaggerated`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 px-1">
            <span>{"Surface"}</span>
            <select value={surface} onChange={(e) => setSurface(e.target.value as Surface)} className="min-w-0 rounded bg-[var(--mg-bg)] px-1" aria-label="Terrain surface" data-testid="terrain-surface">
              {(Object.keys(SURFACE_LABEL) as Surface[]).map((k) => (
                <option key={k} value={k}>
                  {SURFACE_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 px-1">
            <input type="checkbox" checked={contours} onChange={(e) => setContours(e.target.checked)} data-testid="terrain-contours" />
            <span>{`${CONTOUR_INTERVAL_M} m contours`}</span>
          </label>
          <label className="flex items-center justify-between gap-2 px-1">
            <span>{"Quality"}</span>
            <select value={quality} onChange={(e) => setQuality(e.target.value as "standard" | "low")} className="min-w-0 rounded bg-[var(--mg-bg)] px-1" aria-label="Rendering quality" data-testid="terrain-quality">
              <option value="standard">{"Standard"}</option>
              <option value="low">{"Low"}</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

/** SVG elevation profile (true DTM metres; the chart's vertical axis is stretched to fit and says by how much). */
function ProfileChart({ profile, fromName, toName, hover, onHover }: { profile: Profile; fromName: string; toName: string; hover: number | null; onHover: (i: number | null) => void }) {
  const pw = CH.w - CH.l - CH.r;
  const ph = CH.h - CH.t - CH.b;
  // At least a 10 m tall chart, so differences under the DTM's ~5 m agreement never fill the chart.
  const MIN_SPAN_M = 10;
  const range = profile.maxM - profile.minM;
  const pad = Math.max(range * 0.08, (MIN_SPAN_M - range) / 2);
  const lo = profile.minM - pad;
  const hi = profile.maxM + pad;
  const x = (d: number) => CH.l + (d / Math.max(profile.lengthM, 1)) * pw;
  const y = (h: number) => CH.t + ((hi - h) / (hi - lo)) * ph;
  const pts = profile.samples.map((p) => `${x(p.distanceM).toFixed(1)},${y(p.elevationM).toFixed(1)}`).join(" ");
  // How much taller the chart draws heights than the same distance along the line.
  const stretch = (profile.lengthM / pw) / ((hi - lo) / ph);
  const n = profile.samples.length;
  const hv = hover !== null ? profile.samples[hover] : undefined;
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * CH.w;
    const t = Math.min(1, Math.max(0, (vx - CH.l) / pw));
    onHover(Math.round(t * (n - 1)));
  };
  const net = profile.netChangeM;
  return (
    <div className="mt-1.5" data-testid="terrain-profile-chart">
      <svg
        viewBox={`0 0 ${CH.w} ${CH.h}`}
        className="block w-full touch-none rounded bg-[rgba(0,0,0,0.25)] outline-offset-2"
        role="img"
        tabIndex={0}
        aria-label={`Elevation profile from ${fromName} to ${toName}: ${Math.round(profile.lengthM)} m long, from ${fmt(profile.startM)} to ${fmt(profile.endM)}. Use the left and right arrow keys to read elevations along the line.`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
        onBlur={() => onHover(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
          e.preventDefault();
          const stepN = Math.max(1, Math.round(n / 20));
          const cur = hover ?? (e.key === "ArrowLeft" ? n : -1);
          onHover(e.key === "Home" ? 0 : e.key === "End" ? n - 1 : Math.min(n - 1, Math.max(0, cur + (e.key === "ArrowRight" ? stepN : -stepN))));
        }}
        data-testid="terrain-profile-svg"
      >
        <line x1={CH.l} x2={CH.w - CH.r} y1={y(profile.maxM)} y2={y(profile.maxM)} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 3" />
        <line x1={CH.l} x2={CH.w - CH.r} y1={y(profile.minM)} y2={y(profile.minM)} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 3" />
        <polygon points={`${CH.l},${CH.h - CH.b} ${pts} ${CH.w - CH.r},${CH.h - CH.b}`} fill="rgba(255,209,102,0.16)" />
        <polyline points={pts} fill="none" stroke="#ffd166" strokeWidth={1.6} strokeLinejoin="round" />
        <text x={CH.l - 4} y={y(profile.maxM) + 3} textAnchor="end" fontSize={9} fill="currentColor">
          {fmt(profile.maxM)}
        </text>
        <text x={CH.l - 4} y={y(profile.minM) + 3} textAnchor="end" fontSize={9} fill="currentColor">
          {fmt(profile.minM)}
        </text>
        <text x={CH.l} y={CH.h - 5} fontSize={9} fill="currentColor">
          {"0 m"}
        </text>
        <text x={CH.w - CH.r} y={CH.h - 5} textAnchor="end" fontSize={9} fill="currentColor">
          {fmt(profile.lengthM)}
        </text>
        {hv ? (
          <g>
            <line x1={x(hv.distanceM)} x2={x(hv.distanceM)} y1={CH.t} y2={CH.h - CH.b} stroke="#fff" strokeWidth={0.8} />
            <circle cx={x(hv.distanceM)} cy={y(hv.elevationM)} r={3} fill="#fff" />
          </g>
        ) : null}
      </svg>
      <div className="mt-0.5 flex justify-between gap-2 text-[11px]">
        <span className="truncate">{`◀ ${fromName}`}</span>
        <span className="truncate text-right">{`${toName} ▶`}</span>
      </div>
      <p className="mt-1 min-h-4 text-[var(--mg-text)]" aria-live="polite" data-testid="terrain-profile-readout">
        {hv ? `At ${fmt(hv.distanceM)} along the line: ${fmt(hv.elevationM)} (DTM)` : "Point at the chart or use ←/→: a white dot marks the spot on the terrain."}
      </p>
      <p className="mt-1" data-testid="terrain-profile-stats">
        {`${fmt(profile.lengthM)} straight line · start ${fmt(profile.startM)} · end ${fmt(profile.endM)} · net ${fmtSigned(net)}${Math.abs(net) < 5 ? " (under 5 m: not meaningful)" : ""} · range ${fmt(profile.minM)} to ${fmt(profile.maxM)} (${Math.round(range)} m${range < 5 ? "; under 5 m: not meaningful" : ""})`}
      </p>
      <p className="mt-0.5 text-[var(--mg-faint)]" data-testid="terrain-profile-scale">
        {`Chart heights drawn about ${Math.round(stretch)}× taller than distance: slopes look steeper than they are. Numbers are true DTM metres.`}
      </p>
    </div>
  );
}
