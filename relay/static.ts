// Static file serving for the single-machine fallback (in production nginx/Caddy serves these).
// Layout under MYOMARS_WEB_ROOT: station/, hud/, trigger/ — each a pre-built app that was built
// for its own path prefix (/station/, /hud/, /trigger/). No directory listing, no path traversal.

import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export const APPS = ["station", "hud", "trigger"] as const;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".f32": "application/octet-stream",
  ".map": "application/json; charset=utf-8",
};

const page = (res: ServerResponse, status: number, title: string, body: string) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;background:#0b111c;color:#eaf1f9;padding:2rem"><h1>${title}</h1><p>${body}</p><p><a style="color:#ff8066" href="/station/">MyoMars 火星基站</a> · 模拟数据 / 模拟分析</p></body>`);
};

/** Returns true when it handled the request. */
export function serveStatic(webRoot: string, path: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (path === "/" || path === "") {
    res.writeHead(302, { location: "/station/" });
    res.end();
    return true;
  }
  const app = APPS.find((a) => path === `/${a}` || path.startsWith(`/${a}/`));
  if (!app) return false;
  if (path === `/${app}`) {
    res.writeHead(301, { location: `/${app}/` });
    res.end();
    return true;
  }
  const appRoot = resolve(webRoot, app);
  if (!existsSync(appRoot)) {
    page(res, 404, `${app.toUpperCase()} 构建产物未提供`, `此机器上没有 ${app}/ 目录。请把队友的静态构建放到 web/${app}/（构建时的路径前缀必须是 /${app}/）。`);
    return true;
  }
  let rel: string;
  try {
    rel = decodeURIComponent(path.slice(app.length + 2));
  } catch {
    return false;
  }
  const target = resolve(appRoot, normalize(rel));
  if (target !== appRoot && !target.startsWith(appRoot + sep)) return false;
  const candidates = [target, join(target, "index.html"), `${target}.html`];
  const file = candidates.find((f) => existsSync(f) && statSync(f).isFile());
  if (!file) {
    page(res, 404, "未找到", `${path} 不存在。`);
    return true;
  }
  const immutable = path.includes("/_next/static/") || path.includes("/assets/");
  res.writeHead(200, {
    "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
  return true;
}
