/*
 * MyoMars HUD · browser-demo link (hud.html?mode=integration&link=parent&session=…).
 *
 * The HUD page runs inside the online demo's page (same-origin iframe). Instead of HTTP to a relay,
 * its base client sends the same relay calls to the PARENT page over a MessageChannel; the parent
 * answers them from the in-browser bus (src/lib/demo/hud-bridge.ts). Nothing leaves the browser tab.
 *
 * createParentLink({ sessionId }) returns { fetchImpl, ready }:
 *   - fetchImpl(url, init) has fetch's shape (Response objects; the event stream is a ReadableStream),
 *     so hud/base-client.js is used unchanged;
 *   - calls made before the parent answered the handshake wait for it (no message is lost, and
 *     nothing is reported as sent before the link exists).
 * Handshake: post { type: 'myomars-hud-hello', sessionId, nonce } to the parent (retried until it
 * answers); accept only { type: 'myomars-demo-port', sessionId, nonce } from the same origin and the
 * parent window, with a transferred port.
 */
(function (root) {
  function createParentLink({ sessionId }) {
    const origin = location.origin;
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let port = null, seq = 0, resolveReady;
    const ready = new Promise(r => { resolveReady = r; });
    const pending = new Map();
    const enc = new TextEncoder();

    function onPort(ev) {
      const m = ev.data; if (!m || typeof m.id !== 'number') return;
      const p = pending.get(m.id); if (!p) return;
      if (m.kind === 'head') p.head(m);
      else if (m.kind === 'body') { p.body(m.text); pending.delete(m.id); }
      else if (m.kind === 'chunk') p.chunk(m.text);
      else if (m.kind === 'end') { p.end(); pending.delete(m.id); }
    }
    root.addEventListener('message', (e) => {
      if (port || e.origin !== origin || e.source !== root.parent) return;
      const d = e.data;
      if (!d || d.type !== 'myomars-demo-port' || d.sessionId !== sessionId || d.nonce !== nonce || !e.ports || !e.ports[0]) return;
      port = e.ports[0]; port.onmessage = onPort; port.start(); resolveReady();
    });
    const hello = () => { if (!port) { root.parent.postMessage({ type: 'myomars-hud-hello', sessionId, nonce }, origin); setTimeout(hello, 400); } };
    if (root.parent && root.parent !== root) hello();

    async function fetchImpl(url, init) {
      init = init || {};
      await ready;
      const id = ++seq;
      const headers = {};
      if (init.headers) new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
      return new Promise((resolve, reject) => {
        let ctrl = null, streamDone = false;
        const p = {
          head(m) {
            if (m.stream) {
              const body = new ReadableStream({ start(c) { ctrl = c; }, cancel() { if (!streamDone) port.postMessage({ kind: 'abort', id }); } });
              resolve(new Response(body, { status: m.status, headers: m.headers }));
            } else p.status = m;
          },
          body(text) { resolve(new Response(text, { status: p.status.status, headers: p.status.headers })); },
          chunk(text) { if (ctrl) try { ctrl.enqueue(enc.encode(text)); } catch (_) { /* consumer gone */ } },
          end() { streamDone = true; if (ctrl) try { ctrl.close(); } catch (_) { /* already closed */ } },
        };
        pending.set(id, p);
        if (init.signal) {
          if (init.signal.aborted) { pending.delete(id); return reject(new DOMException('aborted', 'AbortError')); }
          init.signal.addEventListener('abort', () => {
            port.postMessage({ kind: 'abort', id });
            if (ctrl) try { ctrl.error(new DOMException('aborted', 'AbortError')); } catch (_) { /* closed */ }
            pending.delete(id); reject(new DOMException('aborted', 'AbortError'));
          });
        }
        port.postMessage({ kind: 'request', id, url: String(url), method: init.method || 'GET', headers, body: init.body == null ? undefined : String(init.body) });
      });
    }
    return { fetchImpl, ready };
  }
  root.createParentLink = createParentLink;
})(window);
