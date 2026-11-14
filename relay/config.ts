// Relay configuration from environment variables (see relay/relay.env.example). No secrets in code:
// access codes come from the environment; the built-in demo codes exist ONLY in dev mode.
import type { Role } from "../src/contracts/envelope.ts";

export type RelayConfig = {
  host: string;
  port: number;
  dev: boolean;
  dataDir: string;
  /** Optional folder with station/, hud/, trigger/ static builds (single-machine fallback). */
  webRoot: string | null;
  accessCodes: Partial<Record<Role, string>>;
  allowedOrigins: string[];
  cookieSecure: "auto" | "always" | "never";
  sessionTtlMs: number;
  leaseTtlMs: number;
  heartbeatMs: number;
  limits: {
    maxBodyBytes: number;
    maxSnapshotBytes: number;
    maxSseClients: number;
    maxSseClientsPerSession: number;
    bufferEvents: number;
    maxSessions: number;
    publishPerMinute: number;
    loginPerMinute: number;
  };
  log: { days: number; maxMb: number };
};

export const DEV_CODES: Record<Role, string> = { station: "station-demo", hud: "hud-demo", trigger: "trigger-demo", observer: "observer-demo" };

const int = (v: string | undefined, d: number, min: number, max: number) => {
  const n = v === undefined || v === "" ? d : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`invalid number ${v} (allowed ${min}..${max})`);
  return Math.floor(n);
};

export function loadConfig(env: Record<string, string | undefined> = process.env): RelayConfig {
  const dev = env.MYOMARS_DEV === "1";
  const codes: Partial<Record<Role, string>> = {};
  for (const role of ["station", "hud", "trigger", "observer"] as const) {
    const v = env[`MYOMARS_CODE_${role.toUpperCase()}`];
    if (v) {
      if (v.length < 8 && !dev) throw new Error(`MYOMARS_CODE_${role.toUpperCase()} must have at least 8 characters`);
      codes[role] = v;
    } else if (dev) codes[role] = DEV_CODES[role];
  }
  if (!Object.keys(codes).length) throw new Error("no access codes configured: set MYOMARS_CODE_STATION / _HUD / _TRIGGER (or MYOMARS_DEV=1 for local demo codes)");
  const port = int(env.MYOMARS_PORT, 8787, 1, 65535);
  const devOrigins = ["http://localhost:3000", "http://127.0.0.1:3000", `http://localhost:${port}`, `http://127.0.0.1:${port}`];
  const allowed = (env.MYOMARS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return {
    host: env.MYOMARS_HOST || "127.0.0.1",
    port,
    dev,
    dataDir: env.MYOMARS_DATA_DIR || ".myomars-data",
    webRoot: env.MYOMARS_WEB_ROOT || null,
    accessCodes: codes,
    allowedOrigins: dev ? [...new Set([...allowed, ...devOrigins])] : allowed,
    cookieSecure: env.MYOMARS_COOKIE_SECURE === "1" ? "always" : env.MYOMARS_COOKIE_SECURE === "0" ? "never" : "auto",
    sessionTtlMs: int(env.MYOMARS_SESSION_TTL_MIN, 12 * 60, 1, 7 * 24 * 60) * 60_000,
    leaseTtlMs: int(env.MYOMARS_LEASE_TTL_MS, 30_000, 200, 600_000),
    heartbeatMs: int(env.MYOMARS_HEARTBEAT_MS, 15_000, 100, 120_000),
    limits: {
      maxBodyBytes: int(env.MYOMARS_MAX_BODY_KB, 64, 1, 1024) * 1024,
      maxSnapshotBytes: int(env.MYOMARS_MAX_SNAPSHOT_KB, 1024, 16, 16_384) * 1024,
      maxSseClients: int(env.MYOMARS_MAX_SSE_CLIENTS, 50, 1, 2000),
      maxSseClientsPerSession: int(env.MYOMARS_MAX_SSE_PER_SESSION, 20, 1, 2000),
      bufferEvents: int(env.MYOMARS_BUFFER_EVENTS, 2000, 10, 100_000),
      maxSessions: int(env.MYOMARS_MAX_SESSIONS, 20, 1, 1000),
      publishPerMinute: int(env.MYOMARS_PUBLISH_PER_MIN, 600, 1, 100_000),
      loginPerMinute: int(env.MYOMARS_LOGIN_PER_MIN, 20, 1, 10_000),
    },
    log: { days: int(env.MYOMARS_LOG_DAYS, 7, 1, 365), maxMb: int(env.MYOMARS_LOG_MAX_MB, 200, 1, 100_000) },
  };
}
