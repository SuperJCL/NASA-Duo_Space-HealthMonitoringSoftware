/*
 * MyoMars astronaut HUD · illustrative 3D Mars scene (integration mode only: hud.html?mode=integration).
 *
 * SOURCE of the committed bundle myomars-hud/scene/mars-scene.js. After any edit, rebuild it:
 *   npm run hud:scene      (scripts/build-hud-scene.mjs: rolldown, tree-shaken, minified IIFE → window.MyoMarsScene)
 *
 * What it shows: a fixed standing viewpoint over a PROCEDURAL landscape: noise heightfields (near ground, dunes,
 * low ridges, a butte, a crater wall on the horizon), self-built rock and habitat geometry and procedural textures.
 * No external assets, no network. It is an illustration only: never a reconstruction of the task site and never
 * measured terrain. Markers carry no distances.
 *
 * How it stays cheap: the eye position and the sun never move, so sunlight, sky light, terrain cast shadows, rock
 * contact shading and aerial perspective (distance haze) are computed once, on the CPU, into vertex colours. Every
 * material is a tiny ShaderMaterial (the bundle is a ShaderMaterial-only three.js build, see the build script). The
 * scene renders on demand only (a drag, a resize, a short Reset ease); it never runs an idle loop, and it does not
 * render while the page is hidden or the canvas is not visible.
 *
 * three.js (MIT, © 2010-2026 three.js authors): LICENSES/MIT-three.js.txt, NOTICE.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  IcosahedronGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  RepeatWrapping,
  ClampToEdgeWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
  WebGLRenderer,
} from 'three';

const DEG = Math.PI / 180;

/** Look-around limits (degrees). Yaw 0 = the default view; the view never leaves this window. */
export const LIMITS = { yaw: 35, pitchMin: -16, pitchMax: 7, pitch0: -3.5 };

/** Quality levels: pixel-ratio cap, MSAA, geometry and texture budgets. No real-time shadows at any level. */
export const QUALITY = {
  low: { pr: 1, aa: false, near: [70, 120], far: [40, 260], rocks: 160, pebbles: 420, steps: 9, farSteps: 5, tex: 256, aniso: 1 },
  standard: { pr: 1.5, aa: true, near: [100, 176], far: [56, 400], rocks: 340, pebbles: 900, steps: 13, farSteps: 7, tex: 512, aniso: 4 },
  high: { pr: 2, aa: true, near: [136, 240], far: [72, 560], rocks: 560, pebbles: 1700, steps: 18, farSteps: 9, tex: 1024, aniso: 8 },
};

/* Sun: low, from the left and slightly behind the viewer (never in view). Warm light, long shadows. */
const SUN_AZ = -104 * DEG, SUN_EL = 13 * DEG;
const SUN = new Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL));
const SUN_XZ = Math.hypot(SUN.x, SUN.z), SUN_TAN = SUN.y / SUN_XZ, SX = SUN.x / SUN_XZ, SZ = SUN.z / SUN_XZ;

/* Where things are, as (yaw degrees, ground distance metres) from the viewpoint. Illustrative placements only. */
const SITES = { base: { yaw: 12.5, dist: 250 }, task: { yaw: -11, dist: 84 } };
const BUTTE = siteXZ(-31, 3500);
const DUNES = siteXZ(-27, 165); // centre of a dark dune field, mid-ground left
const CRATER = { x: 2400, z: 6800, R: 16200 }; // the viewpoint is inside a large crater: its wall wraps the horizon

function siteXZ(yawDeg, dist) {
  return { x: Math.sin(yawDeg * DEG) * dist, z: -Math.cos(yawDeg * DEG) * dist };
}

/* ------------------------------------------------------------------ small math */
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(ix, iy, s) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const GX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071];
const GY = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];
/** 2D gradient noise, about −1…1. */
function noise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let h = hash(ix, iy, s) & 7;
  const a = GX[h] * fx + GY[h] * fy;
  h = hash(ix + 1, iy, s) & 7;
  const b = GX[h] * (fx - 1) + GY[h] * fy;
  h = hash(ix, iy + 1, s) & 7;
  const c = GX[h] * fx + GY[h] * (fy - 1);
  h = hash(ix + 1, iy + 1, s) & 7;
  const d = GX[h] * (fx - 1) + GY[h] * (fy - 1);
  return 1.45 * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
}
function fbm(x, y, oct, s) {
  let t = 0, amp = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    t += amp * noise(x, y, s + i * 101);
    norm += amp;
    amp *= 0.5;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
  }
  return t / norm;
}
function ridge(x, y, oct, s) {
  let t = 0, amp = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise(x, y, s + i * 57));
    t += amp * n * n;
    norm += amp;
    amp *= 0.5;
    x = x * 2.07 + 3.3;
    y = y * 2.07 + 5.1;
  }
  return t / norm;
}

/* ------------------------------------------------------------------ terrain height */
const AUX = { dune: 0, rim: 0 };
let PAD = null; // flattened pad under the habitat

/**
 * Ground height (metres) at (x, z). `fine` adds the small-scale terms (skipped for far shadow samples).
 * Writes the dune and crater-wall masks of the last call into AUX (used for colour).
 */
export function heightAt(x, z, fine = true) {
  const r = Math.hypot(x, z);
  // broad undulation; flattened around the standing spot so the viewpoint is level
  let h = r > 4 ? fbm(x * 0.0019, z * 0.0019, fine ? 4 : 3, 11) * 8 * smooth(4, 170, r) : 0;
  // low ridges and rises in the mid distance
  const rg = ridge(x * 0.00072 + 3.1, z * 0.00072 - 1.7, fine ? 4 : 3, 23);
  h += rg * rg * 52 * smooth(240, 1700, r);
  // a flat-topped butte, far left
  const bq = Math.hypot(x - BUTTE.x, z - BUTTE.z);
  if (bq < 1100) {
    const q = bq + fbm(x * 0.0045, z * 0.0045, 2, 41) * 150;
    if (q < 900) h += 140 * (1 - smooth(470, 760, q)) + 18 * (1 - smooth(0, 520, q));
  }
  // dark sand dunes: patchy field, gentle windward and steep lee slopes
  AUX.dune = 0;
  if (r > 22 && r < 1350) {
    const field = 1 - smooth(60, 150, Math.hypot((x - DUNES.x) * 0.75, (z - DUNES.z) * 1.3) + fbm(x * 0.012, z * 0.012, 2, 3) * 45);
    const patches = smooth(-0.02, 0.36, fbm(x * 0.0042 + 7.3, z * 0.0042 - 2.1, 2, 5)) * 0.65;
    // keep the lines of sight to the base and the task site clear
    const yawDeg = Math.atan2(x, -z) / DEG;
    let clear = 1;
    for (const k in SITES) if (r < SITES[k].dist + 40) clear = Math.min(clear, smooth(4, 10, Math.abs(yawDeg - SITES[k].yaw)));
    const mask = Math.max(field, patches) * clear * smooth(35, 95, r) * (1 - smooth(700, 1350, r));
    if (mask > 0.002) {
      const u = (x * 0.83 + z * 0.56) / 34 + fbm(x * 0.011, z * 0.011, fine ? 2 : 1, 9) * 1.35;
      const s = u - Math.floor(u);
      const p = s < 0.72 ? smooth(0, 1, s / 0.72) : smooth(0, 1, (1 - s) / 0.28);
      h += p * p * 5.2 * mask;
      AUX.dune = mask * (0.6 + 0.4 * p);
    }
  }
  // the ground you stand on: small bumps and hollows
  if (fine && r < 150) {
    h += fbm(x * 0.22, z * 0.22, 3, 31) * 0.17 * (1 - smooth(45, 150, r));
    if (r < 40) h += fbm(x * 0.95, z * 0.95, 2, 37) * 0.035 * (1 - smooth(12, 40, r));
  }
  // crater wall on the horizon: crest wanders in and out, spurs and gullies run down the inner wall
  AUX.rim = 0;
  const dx = x - CRATER.x, dz = z - CRATER.z, q = Math.hypot(dx, dz);
  if (q > CRATER.R - 5200) {
    const ang = Math.atan2(dz, dx);
    const crest = CRATER.R + fbm(ang * 8, 0.5, 3, 61) * 650;
    const top = 620 + fbm(ang * 11 + 4, 1.3, 4, 63) * 330;
    const t = smooth(crest - 4600, crest, q);
    const g = fine ? ridge(ang * 95, q * 0.0015, 3, 67) : 0.45;
    let rim = top * Math.pow(t, 1.7) * (0.84 + 0.3 * g);
    if (q > crest) rim = top * (1.0 - 0.9 * smooth(crest, crest + 3500, q));
    h += rim;
    AUX.rim = t;
  }
  if (PAD) {
    const pd = Math.hypot(x - PAD.x, z - PAD.z);
    if (pd < PAD.r) h = lerp(PAD.h, h, smooth(PAD.r * 0.5, PAD.r, pd));
  }
  return h;
}

/** 0 = fully in the shadow of the terrain, 1 = in sunlight (soft penumbra that widens with distance). */
function sunShadow(x, y, z, steps, t0, grow) {
  let s = 1, t = t0;
  for (let k = 0; k < steps; k++) {
    const hy = heightAt(x + SX * t, z + SZ * t, t < 25);
    const d = (y + t * SUN_TAN - hy) / (0.25 + t * 0.07);
    if (d < s) {
      s = d;
      if (s <= 0) return 0;
    }
    t *= grow;
  }
  return s;
}

/* ------------------------------------------------------------------ colour (linear light → display) */
const lin = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255].map((c) => Math.pow(c, 2.2));
const SUN_C = lin(0xffd3a8).map((c) => c * 2.2);
const SKY_C = lin(0xc39a7a).map((c) => c * 0.62);
const BOUNCE_C = lin(0x8a4a2c).map((c) => c * 0.3);
const HAZE_C = lin(0xae8268).map((c) => c * 0.84);
const EXPOSURE = 1.55;
const A = {
  regolith: lin(0x925a3a),
  dust: lin(0xb57c56),
  gravel: lin(0x6e4a37),
  darkSand: lin(0x4e3b31),
  layered: lin(0xa98466),
  wall: lin(0xa06a48),
  basalt: lin(0x3c312b),
  basalt2: lin(0x55423a),
  rockDust: lin(0xa86c46),
  hab: lin(0xd8d4cd),
  habDark: lin(0x5a5e66),
  accent: lin(0xc8643c),
  panel: lin(0x26303f),
};
const toDisplayExact = (c) => Math.pow(1 - Math.exp(-c * EXPOSURE), 1 / 2.2);
const LUT_MAX = 4, LUT_N = 4096, LUT = new Float32Array(LUT_N + 2);
for (let i = 0; i <= LUT_N + 1; i++) LUT[i] = toDisplayExact((i / LUT_N) * LUT_MAX);
/** Filmic-ish tone map + gamma, linear light → display value (table lookup). */
function toDisplay(c) {
  const f = (clamp(c, 0, LUT_MAX) / LUT_MAX) * LUT_N, i = f | 0;
  return LUT[i] + (LUT[i + 1] - LUT[i]) * (f - i);
}
const HORIZON_DISPLAY = HAZE_C.map(toDisplayExact);
let EYE = [0, 1.7, 0];

/** Lit, hazed display colour into out[o..o+2]. n = unit normal; shadow and ao in 0..1. Returns the haze transmittance. */
function shade(out, o, alb, nx, ny, nz, shadow, ao, x, y, z) {
  const ndl = Math.max(0, nx * SUN.x + ny * SUN.y + nz * SUN.z) * shadow;
  const sky = (0.58 + 0.42 * ny) * ao, bounce = (0.5 - 0.5 * ny) * ao;
  const d = Math.hypot(x - EYE[0], y - EYE[1], z - EYE[2]);
  const T = Math.exp(-(d / 7200) / (1 + Math.max(0, y) / 900)); // thinner haze higher up
  for (let k = 0; k < 3; k++) {
    const c = alb[k] * (SUN_C[k] * ndl + SKY_C[k] * sky + BOUNCE_C[k] * bounce);
    out[o + k] = toDisplay(c * T + HAZE_C[k] * (1 - T));
  }
  return T;
}

/* ------------------------------------------------------------------ geometry helpers */
class Batch {
  constructor() {
    this.n = 0;
    this.p = new Float32Array(3 * 4096);
    this.c = new Float32Array(4 * 4096);
  }
  grow(add) {
    if (this.n + add <= this.p.length / 3) return;
    const cap = Math.max(this.p.length / 3 * 2, this.n + add);
    const p = new Float32Array(cap * 3), c = new Float32Array(cap * 4);
    p.set(this.p);
    c.set(this.c);
    this.p = p;
    this.c = c;
  }
  /** Append a lit, flat-shaded triangle soup (positions already in world space). */
  addFaces(pos, albedoOf, aoOf, shadow) {
    const col = [0, 0, 0];
    this.grow(pos.length / 3);
    const P = this.p, C = this.c;
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i], ay = pos[i + 1], az = pos[i + 2], bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5], cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const alb = albedoOf(nx, ny, nz, i / 9);
      for (let v = 0; v < 3; v++) {
        const x = pos[i + v * 3], y = pos[i + v * 3 + 1], z = pos[i + v * 3 + 2];
        shade(col, 0, alb, nx, ny, nz, shadow, aoOf(x, y, z), x, y, z);
        const n = this.n++;
        P[n * 3] = x;
        P[n * 3 + 1] = y;
        P[n * 3 + 2] = z;
        C[n * 4] = col[0];
        C[n * 4 + 1] = col[1];
        C[n * 4 + 2] = col[2];
      }
    }
  }
  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.p.slice(0, this.n * 3), 3));
    g.setAttribute('bake', new BufferAttribute(this.c.slice(0, this.n * 4), 4));
    return g;
  }
}

/** Unit icosphere triangle soups (non-indexed), shared by all rocks. */
const ICO = [0, 1, 2].map((d) => new IcosahedronGeometry(1, d).attributes.position.array);

/**
 * One rock: an icosphere chipped by random planar cuts (angular faces), lightly jittered, scaled, rotated,
 * sunk into the ground. Returns world-space triangle positions and the rock's footprint and height.
 */
function rockFaces(rand, detail, size, flat, x, z, cut = 0.62, lift = 0) {
  const src = ICO[detail], out = new Float32Array(src.length);
  const cuts = [];
  const nc = 5 + Math.floor(rand() * 5);
  for (let i = 0; i < nc; i++) {
    const th = rand() * Math.PI * 2, ph = Math.acos(lerp(-0.6, 1, rand()));
    cuts.push([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th), lerp(cut, 0.95, rand())]);
  }
  const sx = size * lerp(0.75, 1.3, rand()), sz = size * lerp(0.75, 1.3, rand()), sy = size * flat * lerp(0.8, 1.2, rand());
  const yaw = rand() * Math.PI * 2, tilt = (rand() - 0.5) * 0.35, cy = Math.cos(yaw), syw = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
  const seed = Math.floor(rand() * 1e6);
  const ground = heightAt(x, z) + lift, sink = sy * lerp(0.25, 0.45, rand());
  for (let i = 0; i < src.length; i += 3) {
    let px = src[i], py = src[i + 1], pz = src[i + 2];
    for (const [nx, ny, nz, d] of cuts) {
      const e = px * nx + py * ny + pz * nz - d;
      if (e > 0) {
        px -= nx * e;
        py -= ny * e;
        pz -= nz * e;
      }
    }
    const j = 1 + 0.07 * noise(px * 3.1 + seed, pz * 3.1 + py * 2.3, 5);
    px *= j * sx;
    py *= j * sy;
    pz *= j * sz;
    if (py < -sy * 0.55) py = -sy * 0.55; // flat underside
    // tilt about x, then yaw
    const ty = py * ct - pz * st, tz = py * st + pz * ct;
    out[i] = x + px * cy + tz * syw;
    out[i + 1] = ground - sink + ty + sy * 0.55;
    out[i + 2] = z - px * syw + tz * cy;
  }
  return { pos: out, ground, height: sy * 1.55 - sink, radius: Math.max(sx, sz) };
}

/* ------------------------------------------------------------------ procedural textures */
/**
 * Ground detail, tileable, size n×n. R: fine grain, sand ripples and small pebbles shaded for this scene's sun
 * (mean ≈ 0.5); B: coarse mottling. Both are applied as multipliers (×2) in the terrain shader.
 */
function groundTexture(n) {
  const R = new Float32Array(n * n).fill(0.5), B = new Float32Array(n * n).fill(0.5);
  const rand = rng(97);
  // light direction in texture space (u = +x, v = +z)
  const lx = SX, lz = SZ;
  // tileable low-frequency noise: bilinear grid with wrap
  const lowNoise = (cells, seed) => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = (hash(i, cells, seed) / 4294967296) * 2 - 1;
    return (u, v) => {
      const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const at = (a, b) => g[((b % cells) + cells) % cells * cells + ((a % cells) + cells) % cells];
      return lerp(lerp(at(ix, iy), at(ix + 1, iy), sx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), sx), sy);
    };
  };
  const n1 = lowNoise(8, 3), n2 = lowNoise(16, 5), n3 = lowNoise(4, 7), w1 = lowNoise(6, 9);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n, i = y * n + x;
      // sand ripples (integer wave numbers keep the texture tileable), shaded by their slope toward the sun
      const ph = 2 * Math.PI * (9 * u + 5 * v) + w1(u, v) * 3.2;
      const amp = smooth(-0.05, 0.6, n3(u, v));
      const slope = Math.cos(ph) * ((9 * lx + 5 * lz) / Math.hypot(9, 5)) * amp;
      R[i] += 0.07 * slope + (rand() - 0.5) * 0.13 + n2(u, v) * 0.05;
      B[i] += n1(u, v) * 0.1 + n2(u, v) * 0.05 + n3(u, v) * 0.06;
    }
  }
  // pebbles: lit on the sun side, dark on the far side, with a short cast shadow
  const pebbles = Math.round(n * n * 0.003);
  const px = n / 512;
  for (let k = 0; k < pebbles; k++) {
    const cx = rand() * n, cy = rand() * n;
    if (n1(cx / n + 0.3, cy / n) < -0.25 && rand() < 0.7) continue; // fewer pebbles in the sandy patches
    const r = (1.2 + Math.pow(rand(), 2.2) * 5.5) * px, tone = (rand() - 0.5) * 0.14;
    const R2 = Math.ceil(r * 3.2);
    for (let oy = -R2; oy <= R2; oy++) {
      for (let ox = -R2; ox <= R2; ox++) {
        const x = (((Math.floor(cx) + ox) % n) + n) % n, y = (((Math.floor(cy) + oy) % n) + n) % n, i = y * n + x;
        const dx = (ox + 0.5 - (cx % 1)) / r, dy = (oy + 0.5 - (cy % 1)) / r, d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          const nz = Math.sqrt(1 - d2), lit = -dx * lx * 0.8 - dy * lz * 0.8 + nz * 0.25;
          R[i] = 0.36 + tone + 0.3 * Math.max(-0.2, lit);
        } else {
          // cast shadow: offset away from the sun
          const sx2 = dx + lx * 1.4, sy2 = dy + lz * 1.4, s2 = sx2 * sx2 * 0.8 + sy2 * sy2 * 0.8;
          if (s2 < 1.6) R[i] -= 0.09 * (1 - s2 / 1.6);
          else if (d2 < 2.2) R[i] -= 0.03 * (1 - (d2 - 1) / 1.2);
        }
      }
    }
  }
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = clamp(Math.round(R[i] * 255), 0, 255);
    data[i * 4 + 1] = 128;
    data[i * 4 + 2] = clamp(Math.round(B[i] * 255), 0, 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** Soft rock shadow: u along the shadow (rock at u≈0.2), v across. Alpha in R. */
function shadowTexture(w, h) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w, v = (y + 0.5) / h - 0.5;
      const width = lerp(0.42, 0.18, smooth(0.2, 1, u));
      const across = Math.exp(-(v * v) / (2 * width * width * 0.25));
      const along = smooth(0, 0.16, u) * (1 - smooth(0.45, 1, u));
      const contact = Math.exp(-((u - 0.2) ** 2 + v * v * 1.5) / 0.012) * 0.6;
      const a = clamp(across * along * 0.9 + contact, 0, 1);
      data[(y * w + x) * 4] = Math.round(a * 255);
      data[(y * w + x) * 4 + 3] = 255;
    }
  }
  return data;
}

function makeTexture(data, w, h, wrap, aniso, trilinear = true) {
  const t = new DataTexture(data, w, h);
  t.wrapS = t.wrapT = wrap;
  t.magFilter = LinearFilter;
  t.minFilter = trilinear ? LinearMipmapLinearFilter : LinearMipmapNearestFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ shaders */
const BAKED_VS = `attribute vec4 bake;
varying vec4 vBake;
void main(){ vBake = bake; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BAKED_FS = `varying vec4 vBake;
void main(){ gl_FragColor = vec4(vBake.rgb, 1.0); }`;
const GROUND_VS = `attribute vec4 bake;
varying vec4 vBake; varying vec2 vUv;
void main(){ vBake = bake; vUv = position.xz * 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GROUND_FS = `uniform sampler2D detail;
varying vec4 vBake; varying vec2 vUv;
void main(){
  float k = vBake.a;
  vec3 col = vBake.rgb;
  if (k > 0.002) {
    col *= mix(1.0, texture2D(detail, vUv).r * 2.0, k);
#ifdef COARSE
    col *= mix(1.0, texture2D(detail, vUv * 0.153 + vec2(0.31, 0.77)).b * 2.0, k * 0.8);
#endif
  }
  gl_FragColor = vec4(col, 1.0);
}`;
const DECAL_VS = `attribute vec4 bake; attribute vec2 duv;
varying float vA; varying vec2 vUv;
void main(){ vA = bake.a; vUv = duv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DECAL_FS = `uniform sampler2D tex; uniform vec3 tint;
varying float vA; varying vec2 vUv;
void main(){ gl_FragColor = vec4(tint, texture2D(tex, vUv).r * vA); }`;
// sky: drawn at the far plane after the ground, so only uncovered pixels are shaded; colour comes per vertex
const SKY_VS = `attribute vec3 skyc;
varying vec3 vC;
void main(){ vC = skyc; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = `varying vec3 vC;
void main(){
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); // dither against banding
  gl_FragColor = vec4(vC + (n - 0.5) / 255.0, 1.0);
}`;

/* Sky colours (display values): a darker dusty band at the horizon (it matches the distance haze of the ground),
   butterscotch a little higher, darker toward the zenith, and a warm glow toward the low sun. */
const SKY_L = [0.74, 0.555, 0.43], SKY_M = [0.8, 0.6, 0.45], SKY_Z = [0.5, 0.36, 0.285], SKY_SUN = [1.0, 0.85, 0.66];
function skyDome() {
  const els = [-12, -3, -1, -0.4, 0, 0.4, 0.9, 1.5, 2.2, 3, 4, 5.5, 7.5, 10, 13, 17, 22, 28, 36, 46, 58, 72, 90];
  const segs = 120, W = segs + 1, pos = new Float32Array(els.length * W * 3), col = new Float32Array(els.length * W * 3);
  for (let i = 0; i < els.length; i++) {
    const el = els[i] * DEG, ce = Math.cos(el), e = Math.sin(el);
    const k1 = smooth(-0.004, 0.035, e), k2 = smooth(0.035, 0.2, e), k3 = smooth(0.2, 1, e);
    for (let j = 0; j <= segs; j++) {
      const az = (j / segs) * Math.PI * 2, x = Math.sin(az) * ce, z = -Math.cos(az) * ce, k = (i * W + j) * 3;
      const sd = Math.max(0, x * SUN.x + e * SUN.y + z * SUN.z);
      const glow = (sd ** 3 * 0.2 + sd ** 24 * 0.22) * (1 - 0.6 * smooth(0, 0.5, e));
      pos[k] = x;
      pos[k + 1] = e;
      pos[k + 2] = z;
      for (let c = 0; c < 3; c++) col[k + c] = lerp(lerp(lerp(HORIZON_DISPLAY[c], SKY_L[c], k1), SKY_M[c], k2), SKY_Z[c], k3) + SKY_SUN[c] * glow;
    }
  }
  const idx = [];
  for (let i = 0; i < els.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * W + j;
      idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('skyc', new BufferAttribute(col, 3));
  g.setIndex(new Uint16BufferAttribute(idx, 1));
  return g;
}

/* ------------------------------------------------------------------ world */
function polarTerrain(r0, r1, rings, segs, a0, a1, far, Q, rocksNear) {
  const nv = (rings + 1) * (segs + 1);
  const pos = new Float32Array(nv * 3), dune = new Float32Array(nv), rim = new Float32Array(nv);
  for (let i = 0; i <= rings; i++) {
    const r = r0 * Math.pow(r1 / r0, i / rings);
    for (let j = 0; j <= segs; j++) {
      const a = lerp(a0, a1, j / segs), x = Math.sin(a) * r, z = -Math.cos(a) * r, k = i * (segs + 1) + j;
      let y = heightAt(x, z, !far || r < 3000);
      if (far) y -= 2 * (1 - smooth(r0, r0 + 140, r)); // tuck under the near mesh where the two overlap
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      dune[k] = AUX.dune;
      rim[k] = AUX.rim;
    }
  }
  const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(rings * segs * 6);
  let n = 0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1;
      idx[n++] = a; idx[n++] = b; idx[n++] = c;
      idx[n++] = b; idx[n++] = d; idx[n++] = c;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // terrain cast shadows: ray-marched toward the sun on every vertex within 20 m, beyond that on every other ring
  // and segment, then interpolated (the penumbra is wide there anyway)
  const shadow = new Float32Array(nv).fill(-1), W = segs + 1;
  const rOf = (i) => r0 * Math.pow(r1 / r0, i / rings);
  for (let i = 0; i <= rings; i++) {
    const r = rOf(i), dense = !far && r < 20;
    if (!dense && i % 2 && i !== rings) continue;
    for (let j = 0; j <= segs; j++) {
      if (!dense && j % 2 && j !== segs) continue;
      const k = i * W + j, x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
      if (!far) shadow[k] = clamp(sunShadow(x, y + 0.04, z, Q.steps, 0.6, 1.62), 0, 1);
      else shadow[k] = r < 9000 ? clamp(sunShadow(x, y + 1, z, Q.farSteps, 30, 1.85), 0, 1) : 1;
    }
  }
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= segs; j++) {
      const k = i * W + j;
      if (shadow[k] < 0 && j > 0 && j < segs && shadow[k - 1] >= 0) shadow[k] = (shadow[k - 1] + shadow[k + 1]) / 2;
    }
  }
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j <= segs; j++) {
      const k = i * W + j;
      if (shadow[k] < 0) shadow[k] = (shadow[k - W] + shadow[k + W]) / 2;
    }
  }
  // rock contact darkening on the ground near the viewpoint (1 m buckets)
  const grid = new Map();
  for (const rk of rocksNear) {
    const R = rk.radius * 1.8;
    for (let gx = Math.floor(rk.x - R); gx <= Math.floor(rk.x + R); gx++) {
      for (let gz = Math.floor(rk.z - R); gz <= Math.floor(rk.z + R); gz++) {
        const key = gx * 4096 + gz;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(rk);
      }
    }
  }
  const nor = g.attributes.normal.array, bake = new Float32Array(nv * 4), col = [0, 0, 0], alb = [0, 0, 0];
  for (let k = 0; k < nv; k++) {
    const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2], nx = nor[k * 3], ny = nor[k * 3 + 1], nz = nor[k * 3 + 2];
    const r = Math.hypot(x, z);
    // albedo: ochre regolith, bright dust patches, dark basaltic dune sand, rocky steep slopes, paler crater wall
    const m = fbm(x * 0.021, z * 0.021, far ? 2 : 3, 71), m2 = far || r > 200 ? 0 : fbm(x * 0.12, z * 0.12, 2, 73);
    const dustK = smooth(-0.15, 0.55, m) * 0.65, sandK = clamp(dune[k] * 0.95, 0, 1), steep = smooth(0.92, 0.7, ny);
    const gravelK = far ? 0 : smooth(0.1, 0.55, m2) * 0.55;
    for (let c = 0; c < 3; c++) {
      let v = lerp(lerp(A.regolith[c], A.dust[c], dustK), A.gravel[c], gravelK) * (1 + 0.12 * m2);
      v = lerp(v, A.darkSand[c], sandK);
      v = lerp(v, A.basalt2[c], steep * 0.45);
      alb[c] = lerp(v, A.wall[c], rim[k] * 0.7);
    }
    let ao = 1;
    if (!far && r < 60) {
      const cell = grid.get(Math.floor(x) * 4096 + Math.floor(z));
      if (cell) for (const rk of cell) {
        const dd = Math.hypot(x - rk.x, z - rk.z) / rk.radius;
        if (dd < 1.8) ao = Math.min(ao, lerp(0.72, 1, smooth(0.7, 1.8, dd)));
      }
    }
    const T = shade(col, 0, alb, nx, ny, nz, lerp(0.12, 1, shadow[k]) * ao, ao, x, y, z);
    bake[k * 4] = col[0];
    bake[k * 4 + 1] = col[1];
    bake[k * 4 + 2] = col[2];
    bake[k * 4 + 3] = far ? 0 : Math.pow(clamp(1 - r / 150, 0, 1), 1.3) * T;
  }
  g.setAttribute('bake', new BufferAttribute(bake, 4));
  g.deleteAttribute('normal');
  return g;
}

/** Place rocks: clumpy, none on dune sand or the habitat pad, sizes growing with distance. Largest first. */
function scatterRocks(count, seed) {
  const rand = rng(seed), list = [];
  let guard = 0;
  while (list.length < count * 1.6 && guard++ < count * 40) {
    const r = 1.8 * Math.pow(320 / 1.8, Math.pow(rand(), 0.85)), a = lerp(-82, 82, rand()) * DEG;
    const x = Math.sin(a) * r, z = -Math.cos(a) * r;
    heightAt(x, z, false);
    if (AUX.dune > 0.18) continue;
    if (PAD && Math.hypot(x - PAD.x, z - PAD.z) < PAD.r * 1.1) continue;
    const clump = smooth(-0.25, 0.45, fbm(x * 0.045, z * 0.045, 2, 13));
    if (rand() > 0.25 + 0.75 * clump) continue;
    const big = 0.22 + 0.75 * smooth(3, 40, r);
    const size = 0.05 + big * Math.pow(rand(), 2.6);
    list.push({ x, z, r, size, seed: Math.floor(rand() * 1e9) });
  }
  list.sort((p, q) => q.size - p.size);
  return list.slice(0, count);
}

function buildWorld(Q) {
  const t0 = performance.now();
  // habitat pad (flattened ground under the base)
  const b = siteXZ(SITES.base.yaw, SITES.base.dist);
  PAD = null;
  PAD = { x: b.x, z: b.z, r: 34, h: heightAt(b.x, b.z) };
  EYE = [0, heightAt(0, 0) + 1.7, 0];

  const rocks = scatterRocks(Q.rocks, 1234);
  const near = rocks.filter((rk) => rk.r < 60).map((rk) => ({ x: rk.x, z: rk.z, radius: rk.size * 1.1 }));
  const nearGeo = polarTerrain(0.35, 900, Q.near[0], Q.near[1], -95 * DEG, 95 * DEG, false, Q, near);
  const farGeo = polarTerrain(780, 24000, Q.far[0], Q.far[1], -100 * DEG, 100 * DEG, true, Q, near);
  const tTerrain = performance.now();

  // rocks, pebbles and the task-site outcrop: one merged, flat-shaded batch
  const batch = new Batch(), decals = [];
  const rockAlbedo = (rand) => {
    const base = rand() < 0.5 ? A.basalt : A.basalt2, dust = 0.25 + 0.5 * rand(), out = [0, 0, 0];
    return (nx, ny) => {
      const k = smooth(0.35, 0.95, ny) * dust;
      for (let c = 0; c < 3; c++) out[c] = lerp(base[c], A.rockDust[c], k);
      return out;
    };
  };
  const addRock = (rand, detail, size, flat, x, z, cut, withDecal) => {
    const rk = rockFaces(rand, detail, size, flat, x, z, cut);
    const sh = clamp(sunShadow(x, rk.ground + rk.height * 0.6, z, 6, 0.5, 1.8), 0, 1);
    const g0 = rk.ground, hh = Math.max(0.01, rk.height);
    batch.addFaces(rk.pos, rockAlbedo(rand), (px, py) => lerp(0.45, 1, smooth(-0.05, 0.75, (py - g0) / hh)), lerp(0.15, 1, sh));
    if (withDecal) decals.push({ x, z, radius: rk.radius, height: rk.height, sh });
  };
  for (const rk of rocks) {
    const rand = rng(rk.seed);
    const detail = rk.size > 0.6 || (rk.r < 8 && rk.size > 0.12) ? 2 : rk.size > 0.12 ? 1 : 0;
    addRock(rand, detail, rk.size, lerp(0.45, 0.8, rand()), rk.x, rk.z, 0.6, rk.size > 0.07);
  }
  // pebbles near the feet
  {
    const rand = rng(77);
    for (let i = 0; i < Q.pebbles; i++) {
      const r = 0.9 * Math.pow(16 / 0.9, rand()), a = lerp(-78, 78, rand()) * DEG, x = Math.sin(a) * r, z = -Math.cos(a) * r;
      heightAt(x, z, false);
      if (AUX.dune > 0.3) continue;
      addRock(rand, 0, 0.012 + Math.pow(rand(), 2) * 0.05, 0.6, x, z, 0.55, false);
    }
  }
  // task site: a low, light-toned layered outcrop (stacked slabs) with dark boulders around it
  const t = siteXZ(SITES.task.yaw, SITES.task.dist);
  let taskTop = heightAt(t.x, t.z);
  {
    const rand = rng(4242);
    const layered = (nx, ny, nz, f) => {
      const k = smooth(0.4, 0.95, ny) * 0.35;
      return [0, 1, 2].map((c) => lerp(A.layered[c], A.rockDust[c], k) * (0.92 + 0.16 * ((f * 7) % 3) / 2));
    };
    const slabs = [[0, 0, 3.4, 0.3, 0], [0.4, -0.3, 2.5, 0.34, 0.75], [-0.2, 0.2, 1.5, 0.4, 1.35], [3.6, 1.0, 1.9, 0.32, 0], [-3.4, 0.6, 1.7, 0.36, 0], [1.4, -2.6, 1.2, 0.4, 0], [-1.6, 2.6, 1.0, 0.45, 0]];
    for (const [ox, oz, sz, f, lift] of slabs) {
      const rk = rockFaces(rand, 2, sz, f, t.x + ox, t.z + oz, 0.45, lift);
      const g0 = rk.ground - lift, hh = rk.height + lift;
      batch.addFaces(rk.pos, layered, (px, py) => lerp(0.5, 1, smooth(-0.05, 0.8, (py - g0) / hh)), 1);
      if (!lift) decals.push({ x: t.x + ox, z: t.z + oz, radius: rk.radius, height: rk.height, sh: 1 });
      taskTop = Math.max(taskTop, rk.ground + rk.height);
    }
    for (let i = 0; i < 30; i++) {
      const a = rand() * Math.PI * 2, d = 4 + rand() * 10;
      addRock(rand, 1, 0.12 + rand() * 0.4, 0.6, t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 0.6, true);
    }
  }
  const tRocks = performance.now();

  // habitat: two modules, a dome, a connector, an antenna mast and solar arrays (illustrative)
  const hab = new Batch();
  {
    const m = new Matrix4(), rot = new Matrix4().makeRotationY(-SITES.base.yaw * DEG + 0.35);
    const put = (geo, mx, albedo, ao = 1) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      const p = g.attributes.position.clone().applyMatrix4(mx).array;
      hab.addFaces(p, typeof albedo === 'function' ? albedo : () => albedo, () => ao, 1);
    };
    const at = (x, y, z) => new Matrix4().makeTranslation(b.x, PAD.h, b.z).multiply(rot).multiply(new Matrix4().makeTranslation(x, y, z));
    const cylX = (r, len, segs) => new CylinderGeometry(r, r, len, segs, 1).rotateZ(Math.PI / 2);
    put(cylX(2.3, 10, 16), at(-5.5, 2.6, 0), A.hab);
    for (const sx of [-9.6, -5.5, -1.4]) put(cylX(2.36, 0.4, 16), at(sx, 2.6, 0), A.accent);
    put(new CylinderGeometry(2.3, 2.3, 8, 16, 1).rotateX(Math.PI / 2), at(4.2, 2.6, -2.5), A.hab);
    put(new CylinderGeometry(2.36, 2.36, 0.4, 16, 1).rotateX(Math.PI / 2), at(4.2, 2.6, 1.3), A.accent);
    put(cylX(1.0, 3.2, 10), at(0.6, 2.2, 0), A.habDark);
    put(new SphereGeometry(3.4, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), at(-1.0, 0.25, 6.0), A.hab);
    for (const [x, z] of [[-9, 1.6], [-9, -1.6], [-2, 1.6], [-2, -1.6], [2.5, -5.5], [6, -5.5], [2.5, 0.5], [6, 0.5]]) put(new BoxGeometry(0.5, 0.6, 0.5), at(x, 0.3, z), A.habDark, 0.8);
    put(new CylinderGeometry(0.11, 0.16, 15, 6, 1), at(-13.5, 7.5, -2.5), A.habDark);
    put(new CylinderGeometry(1.5, 0.12, 0.7, 14, 1).rotateZ(-0.9), at(-13.2, 13.6, -2.5), A.hab);
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < 4; k++) {
        const panel = new BoxGeometry(3.0, 0.08, 2.2).rotateX(-0.42);
        put(panel, at(11.5 + k * 3.25, 1.5, -1.0 + row * 3.4), (nx, ny) => (ny > 0.5 ? A.panel : A.habDark));
        put(new BoxGeometry(0.12, 1.2, 0.12), at(11.5 + k * 3.25, 0.6, -1.0 + row * 3.4), A.habDark);
      }
    }
    for (const [ox, oz, s] of [[-2, 0, 6], [6, -3, 5], [-12, -2.5, 2.5], [-1, 6, 4.5], [15.5, 0.6, 7]]) decals.push({ x: b.x + ox, z: b.z + oz, radius: s, height: s * 0.6, sh: 1, soft: true });
  }
  const tHab = performance.now();

  // shadow decals (ground-hugging, soft, cast away from the sun), faded by the same haze as the ground
  const dp = [], dc = [], du = [], di = [];
  {
    const ax = -SX, az = -SZ, bx = -az, bz = ax; // along the shadow, across it
    for (const d of decals) {
      const len = Math.min(d.height / SUN_TAN, d.radius * 7) + d.radius;
      const back = d.radius * 1.15, wid = d.radius * (d.soft ? 1.6 : 1.25);
      const base = dp.length / 3, nu = 4, nv = 2;
      const dist = Math.hypot(d.x, d.z), T = Math.exp(-(dist / 7200));
      for (let iu = 0; iu <= nu; iu++) {
        for (let iv = 0; iv <= nv; iv++) {
          const u = iu / nu, v = iv / nv, s = lerp(-back, len, u), w = lerp(-wid, wid, v);
          const x = d.x + ax * s + bx * w, z = d.z + az * s + bz * w;
          dp.push(x, heightAt(x, z) + 0.015 + dist * 0.00012, z);
          dc.push(0, 0, 0, (d.soft ? 0.5 : 0.78) * T * lerp(0.3, 1, d.sh));
          du.push(lerp(0, 1, u) * 0.82 + 0.03, v);
        }
      }
      for (let iu = 0; iu < nu; iu++) {
        for (let iv = 0; iv < nv; iv++) {
          const a = base + iu * (nv + 1) + iv, b2 = a + 1, c = a + nv + 1, e = c + 1;
          di.push(a, b2, c, b2, e, c);
        }
      }
    }
  }
  const decalGeo = new BufferGeometry();
  decalGeo.setAttribute('position', new BufferAttribute(new Float32Array(dp), 3));
  decalGeo.setAttribute('bake', new BufferAttribute(new Float32Array(dc), 4));
  decalGeo.setAttribute('duv', new BufferAttribute(new Float32Array(du), 2));
  decalGeo.setIndex(dp.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(di), 1) : new BufferAttribute(new Uint16Array(di), 1));
  const tEnd = performance.now();

  return {
    nearGeo,
    farGeo,
    rockGeo: batch.geometry(),
    habGeo: hab.geometry(),
    decalGeo,
    anchors: {
      base: new Vector3(b.x, PAD.h + 5.6, b.z),
      task: new Vector3(t.x, taskTop + 0.4, t.z),
    },
    timings: { terrain: tTerrain - t0, rocks: tRocks - tTerrain, habitat: tHab - tRocks, decals: tEnd - tHab, total: tEnd - t0 },
    counts: { rocks: rocks.length, pebbles: Q.pebbles, decals: decals.length },
  };
}

/* ------------------------------------------------------------------ public API */
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe/i;

/** Can this browser make a WebGL 2 context, and is it a software renderer? Releases the probe context. */
export function probe() {
  let gl = null;
  try {
    gl = document.createElement('canvas').getContext('webgl2');
  } catch {
    gl = null;
  }
  if (!gl) return { ok: false, renderer: '', software: false };
  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch {
    renderer = '';
  }
  try {
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch {
    /* ignore */
  }
  return { ok: true, renderer, software: SOFTWARE_RE.test(renderer) };
}

/** Auto quality: low on a software renderer or ≤ 4 logical cores, otherwise standard. High is opt-in. */
export function autoQuality(info) {
  const cores = navigator.hardwareConcurrency || 4;
  return info.software || cores <= 4 ? 'low' : 'standard';
}

function failure(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * Create the scene. Throws an Error with .code ('no-webgl' | 'init-failed') when it cannot run; the caller then
 * keeps the image fallback.
 *
 * opts: { before: Node (the canvas is inserted before it), quality: 'auto'|'low'|'standard'|'high',
 *         markers: { base?: HTMLElement, task?: HTMLElement } (positioned on every render),
 *         reducedMotion(): boolean, onRender(view), onTap(), onLost(reason: 'context-lost' | 'shader-error') }
 */
export function create(opts = {}) {
  const t0 = performance.now();
  const info = probe();
  if (!info.ok) throw failure('no-webgl', 'WebGL 2 is not available');
  const wanted = opts.quality && QUALITY[opts.quality] ? opts.quality : 'auto';
  const qName = wanted === 'auto' ? autoQuality(info) : wanted;
  const Q = QUALITY[qName];

  const canvas = document.createElement('canvas');
  canvas.id = 'scene3d';
  canvas.setAttribute('aria-hidden', 'true');
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', { antialias: Q.aa, alpha: false, depth: true, stencil: false, premultipliedAlpha: true, powerPreference: 'default' });
  } catch {
    gl = null;
  }
  if (!gl) throw failure('no-webgl', 'WebGL 2 context creation failed');

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, context: gl });
  } catch (e) {
    throw failure('init-failed', String((e && e.message) || e));
  }
  const parent = (opts.before && opts.before.parentNode) || document.body;
  parent.insertBefore(canvas, opts.before && opts.before.parentNode ? opts.before : parent.firstChild);
  renderer.setClearColor(0x2a160d, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
  // a shader that does not compile on this GPU means no scene: report it (the HUD keeps the image) instead of logging
  let shaderFailed = false;
  renderer.debug.onShaderError = () => {
    shaderFailed = true;
  };
  const tRenderer = performance.now();

  let world;
  try {
    world = buildWorld(Q);
  } catch (e) {
    renderer.dispose();
    canvas.remove();
    throw failure('init-failed', String((e && e.message) || e));
  }
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.12, 40000);
  camera.position.set(EYE[0], EYE[1], EYE[2]);
  camera.rotation.order = 'YXZ';

  const aniso = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy());
  const tn = Q.tex;
  const detailTex = makeTexture(groundTexture(tn), tn, tn, RepeatWrapping, aniso, qName !== 'low');
  const shadowTex = makeTexture(shadowTexture(64, 32), 64, 32, ClampToEdgeWrapping, 1);
  const baked = new ShaderMaterial({ vertexShader: BAKED_VS, fragmentShader: BAKED_FS });
  const ground = new ShaderMaterial({
    vertexShader: GROUND_VS,
    fragmentShader: GROUND_FS,
    uniforms: { detail: { value: detailTex } },
    defines: qName === 'low' ? {} : { COARSE: '' },
  });
  const decal = new ShaderMaterial({
    vertexShader: DECAL_VS,
    fragmentShader: DECAL_FS,
    uniforms: { tex: { value: shadowTex }, tint: { value: new Vector3(0.1, 0.05, 0.03) } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  const sky = new ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: DoubleSide, depthWrite: false });
  const meshes = [
    new Mesh(world.nearGeo, ground),
    new Mesh(world.farGeo, baked),
    new Mesh(world.rockGeo, baked),
    new Mesh(world.habGeo, baked),
    new Mesh(world.decalGeo, decal),
  ];
  const skyMesh = new Mesh(skyDome(), sky);
  skyMesh.position.copy(camera.position);
  skyMesh.renderOrder = 2; // after the opaque ground: only the uncovered pixels are shaded
  skyMesh.frustumCulled = false;
  meshes.forEach((m) => {
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    scene.add(m);
  });
  scene.add(skyMesh);
  scene.matrixWorldAutoUpdate = true;

  /* ---------------- view state ---------------- */
  let yaw = 0, pitch = LIMITS.pitch0, ease = null, drag = null;
  const markers = Object.entries(opts.markers || {}).filter(([, el]) => el).map(([id, el]) => ({ id, el, at: world.anchors[id] }));
  const setView = (y, p) => {
    yaw = clamp(y, -LIMITS.yaw, LIMITS.yaw);
    pitch = clamp(p, LIMITS.pitchMin, LIMITS.pitchMax);
    request();
  };
  const atDefault = () => Math.abs(yaw) < 0.05 && Math.abs(pitch - LIMITS.pitch0) < 0.05;
  const view = () => ({ yaw, pitch, atDefault: atDefault() });
  const reduced = () => !!(opts.reducedMotion && opts.reducedMotion());
  const easeTo = (y, p) => {
    y = clamp(y, -LIMITS.yaw, LIMITS.yaw);
    p = clamp(p, LIMITS.pitchMin, LIMITS.pitchMax);
    if (reduced()) {
      ease = null;
      setView(y, p);
      return;
    }
    ease = { y0: yaw, p0: pitch, y1: y, p1: p, t0: performance.now(), dur: 420 };
    request();
  };
  const markerYaw = (id) => {
    const a = world.anchors[id];
    return a ? Math.atan2(a.x, -a.z) / DEG : 0;
  };

  /* ---------------- sizing ---------------- */
  let cssW = 0, cssH = 0;
  const resize = () => {
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    if (w === cssW && h === cssH) return;
    cssW = w;
    cssH = h;
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = clamp(2 * Math.atan(Math.tan(30 * DEG) / aspect) / DEG, 50, 80); // keep ≥ 60° across on narrow screens
    camera.updateProjectionMatrix();
    request();
  };

  /* ---------------- on-demand rendering ---------------- */
  let raf = 0, frames = 0, visible = true, disposed = false, firstFrameAt = 0, renderMs = 0, renderSum = 0;
  const paused = () => document.hidden || !visible;
  function request() {
    if (raf || disposed || paused()) return;
    raf = requestAnimationFrame(tick);
  }
  const tmp = new Vector3();
  function placeMarkers() {
    camera.updateMatrixWorld();
    for (const m of markers) {
      if (!m.at) continue;
      tmp.copy(m.at).project(camera);
      const behind = tmp.z > 1;
      m.el.style.left = ((tmp.x + 1) / 2) * cssW + 'px';
      m.el.style.top = ((1 - tmp.y) / 2) * cssH + 'px';
      m.el.style.visibility = behind ? 'hidden' : '';
    }
  }
  function tick(now) {
    raf = 0;
    if (disposed || paused()) return;
    if (ease) {
      const k = clamp((now - ease.t0) / ease.dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      yaw = lerp(ease.y0, ease.y1, e);
      pitch = lerp(ease.p0, ease.p1, e);
      if (k >= 1) ease = null;
    }
    camera.rotation.set(pitch * DEG, -yaw * DEG, 0);
    const r0 = performance.now();
    renderer.render(scene, camera);
    if (shaderFailed) {
      if (opts.onLost) opts.onLost('shader-error');
      return;
    }
    renderMs = performance.now() - r0;
    renderSum += renderMs;
    frames++;
    if (!firstFrameAt) firstFrameAt = performance.now();
    placeMarkers();
    if (opts.onRender) opts.onRender(view());
    if (ease) request();
  }

  /* ---------------- input: drag to look, on the canvas only ---------------- */
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ease = null;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw, pitch, moved: false };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic event */
    }
    canvas.classList.add('drag');
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = camera.fov / (cssH || 1), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    setView(drag.yaw - dx * k, drag.pitch + dy * k);
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const tap = e.type === 'pointerup' && !drag.moved;
    drag = null;
    canvas.classList.remove('drag');
    if (tap && opts.onTap) opts.onTap();
  };
  const onVis = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else request();
  };
  const onLost = (e) => {
    if (disposed) return;
    if (e && e.preventDefault) e.preventDefault();
    if (opts.onLost) opts.onLost('context-lost');
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);
  canvas.addEventListener('webglcontextlost', onLost);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVis);
  let io = null;
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => {
      const en = entries[entries.length - 1];
      visible = !!(en && en.isIntersecting);
      if (visible) request();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(canvas);
  }

  resize();
  // compile now, so the first visible frame does not stall on shader compilation
  try {
    renderer.compile(scene, camera);
  } catch {
    /* compiled on first render instead */
  }
  const tReady = performance.now();
  request();

  const texBytes = (tn * tn * 4 + 64 * 32 * 4) * (4 / 3);
  let geoBytes = 0;
  for (const m of [...meshes, skyMesh]) {
    const g = m.geometry;
    for (const k in g.attributes) geoBytes += g.attributes[k].array.byteLength;
    if (g.index) geoBytes += g.index.array.byteLength;
  }
  let tris = 0;
  for (const m of meshes) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;

  return {
    canvas,
    quality: qName,
    auto: wanted === 'auto',
    renderer: info.renderer,
    software: info.software,
    limits: LIMITS,
    get frames() {
      return frames;
    },
    get paused() {
      return paused();
    },
    view,
    markerYaw,
    setView,
    nudge: (dy, dp) => {
      ease = null;
      setView(yaw + dy, pitch + dp);
    },
    reset: () => easeTo(0, LIMITS.pitch0),
    lookAt: (id) => easeTo(markerYaw(id), LIMITS.pitch0),
    requestRender: request,
    loseContext: () => renderer.forceContextLoss(),
    /** Measurement only (scripts/hud-scene-check.mjs): n synchronous renders while panning, each waited for with a
     *  1-pixel readback (gl.finish() does not block in Chrome). Returns the mean milliseconds per frame, then restores
     *  the view. */
    profile(n = 20) {
      const y0 = yaw, p0 = pitch, gl2 = renderer.getContext(), px = new Uint8Array(4), t = performance.now();
      for (let i = 0; i < n; i++) {
        camera.rotation.set(p0 * DEG, -clamp(y0 + Math.sin(i / 3) * 4, -LIMITS.yaw, LIMITS.yaw) * DEG, 0);
        renderer.render(scene, camera);
        gl2.readPixels(0, 0, 1, 1, gl2.RGBA, gl2.UNSIGNED_BYTE, px);
      }
      const ms = (performance.now() - t) / n;
      setView(y0, p0);
      return ms;
    },
    stats: {
      createMs: tReady - t0,
      rendererMs: tRenderer - t0,
      build: world.timings,
      counts: world.counts,
      textureBytes: Math.round(texBytes),
      geometryBytes: geoBytes,
      triangles: Math.round(tris),
      drawCalls: meshes.length + 1,
      pixelRatio: renderer.getPixelRatio(),
      antialias: Q.aa,
      get firstFrameAt() {
        return firstFrameAt;
      },
      get lastRenderMs() {
        return renderMs;
      },
      get avgRenderMs() {
        return frames ? renderSum / frames : 0;
      },
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('lostpointercapture', onUp);
      canvas.removeEventListener('webglcontextlost', onLost);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
      if (io) io.disconnect();
      for (const m of [...meshes, skyMesh]) m.geometry.dispose();
      for (const mat of [baked, ground, decal, sky]) mat.dispose();
      detailTex.dispose();
      shadowTex.dispose();
      try {
        renderer.dispose();
      } catch {
        /* context already lost */
      }
      canvas.remove();
    },
  };
}

/** For the build script's offline check (no WebGL): build the world geometry and report timings and sizes. */
export function benchmark(quality = 'low') {
  const w = buildWorld(QUALITY[quality]);
  const verts = [w.nearGeo, w.farGeo, w.rockGeo, w.habGeo, w.decalGeo].reduce((s, g) => s + g.attributes.position.count, 0);
  return { timings: w.timings, counts: w.counts, vertices: verts };
}
