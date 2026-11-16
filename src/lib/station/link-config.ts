// How the station page connects: the local mock (standalone demo, default) or the local relay.
//   ?relay=http://host:8787   use that relay        ?relay=auto  same host as the page, port 8787
//   ?relay=off                force the local mock   ?session=demo (default; the HUD uses "demo")
// NEXT_PUBLIC_MYOMARS_RELAY sets the default (same values); the URL parameter wins.
// "browser-demo" is never read from the URL: only the online demo page (/demo) passes it, with its
// in-browser bus (src/lib/demo/browser-relay.ts). The two transports never run together.
export type LinkConfig = { mode: "mock" } | { mode: "relay"; baseUrl: string; sessionId: string } | { mode: "browser-demo"; baseUrl: string; sessionId: string };

export function resolveLink(search: string, loc: { protocol: string; hostname: string }, envRelay?: string): LinkConfig {
  const q = new URLSearchParams(search);
  const want = (q.get("relay") ?? envRelay ?? "").trim();
  if (!want || want === "off") return { mode: "mock" };
  const baseUrl = (want === "auto" ? `${loc.protocol}//${loc.hostname}:8787` : want).replace(/\/$/, "");
  return { mode: "relay", baseUrl, sessionId: q.get("session") || "demo" };
}
