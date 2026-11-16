// Parent side of the browser-demo link to the HUD page in a same-origin iframe.
//
// Handshake: the HUD page (hud.html?mode=integration&link=parent&session=…) posts
// { type: "myomars-hud-hello", sessionId, nonce } to its parent. The parent checks the ORIGIN (same
// origin only), the SOURCE window (this iframe only) and the SESSION, then transfers one end of a
// MessageChannel ({ type: "myomars-demo-port", sessionId, nonce }). Over that port the HUD sends its
// relay HTTP calls; the parent answers them from the in-browser bus.
//
// What the HUD frame may do: read and stream its session's events, and publish as role "hud" or
// "device" only (never "station" or "trigger", never the station lease, never another session).

import { DEMO_BASE, type DemoFetch } from "./browser-relay";

const HUD_ROLES = new Set(["hud", "device"]);
type Req = { kind: "request"; id: number; url: string; method?: string; headers?: Record<string, string>; body?: string };
type Abort = { kind: "abort"; id: number };

export function connectHudFrame({ frame, sessionId, fetchImpl, onLinked }: { frame: HTMLIFrameElement; sessionId: string; fetchImpl: DemoFetch; onLinked?: () => void }): () => void {
  let port: MessagePort | null = null;
  let nonce: string | null = null;
  const active = new Map<number, AbortController>();
  const prefix = `${DEMO_BASE}/v1/sessions/${encodeURIComponent(sessionId)}/`;

  const reply = (msg: unknown) => port?.postMessage(msg);
  const refuse = (id: number, status: number, error: string) => {
    reply({ kind: "head", id, status, headers: [["content-type", "application/json"]], stream: false });
    reply({ kind: "body", id, text: JSON.stringify({ error }) });
  };

  async function onRequest(ev: MessageEvent) {
    const m = ev.data as Req | Abort | null;
    if (!m || typeof m.id !== "number") return;
    if (m.kind === "abort") {
      active.get(m.id)?.abort();
      active.delete(m.id);
      return;
    }
    if (m.kind !== "request" || typeof m.url !== "string") return;
    const path = m.url.startsWith(prefix) ? m.url.slice(prefix.length).split("?")[0] : null;
    const method = (m.method ?? "GET").toUpperCase();
    if (path !== "events" && path !== "stream") return refuse(m.id, 403, "hud-frame-path-not-allowed");
    const headers = { ...(m.headers ?? {}) };
    if (method === "POST" && !HUD_ROLES.has(String(headers["x-myomars-role"] ?? ""))) return refuse(m.id, 403, "hud-frame-role-not-allowed");
    const ac = new AbortController();
    active.set(m.id, ac);
    try {
      const res = await fetchImpl(m.url, { method, headers, body: m.body, signal: ac.signal });
      const isStream = (res.headers.get("content-type") ?? "").includes("text/event-stream");
      reply({ kind: "head", id: m.id, status: res.status, headers: [...res.headers], stream: isStream });
      if (!isStream || !res.body) {
        reply({ kind: "body", id: m.id, text: await res.text() });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        reply({ kind: "chunk", id: m.id, text: dec.decode(value, { stream: true }) });
      }
      reply({ kind: "end", id: m.id });
    } catch {
      reply({ kind: "end", id: m.id });
    } finally {
      active.delete(m.id);
    }
  }

  const onHello = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || e.source !== frame.contentWindow) return;
    const d = e.data as { type?: string; sessionId?: string; nonce?: string } | null;
    if (!d || d.type !== "myomars-hud-hello" || d.sessionId !== sessionId || typeof d.nonce !== "string") return;
    if (d.nonce === nonce) return; // the same page load asking again: its port is already on the way
    // A new page load of the frame (first load, or the HUD page reloaded): a fresh channel.
    for (const ac of active.values()) ac.abort();
    active.clear();
    port?.close();
    const ch = new MessageChannel();
    port = ch.port1;
    nonce = d.nonce;
    port.onmessage = (ev) => void onRequest(ev);
    frame.contentWindow?.postMessage({ type: "myomars-demo-port", sessionId, nonce }, window.location.origin, [ch.port2]);
    onLinked?.();
  };
  window.addEventListener("message", onHello);
  return () => {
    window.removeEventListener("message", onHello);
    for (const ac of active.values()) ac.abort();
    active.clear();
    port?.close();
    port = null;
  };
}
