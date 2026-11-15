// Start the MyoMars local relay:  npm run relay
//   PORT=8787 HOST=0.0.0.0                       listen address (0.0.0.0 = reachable on the LAN)
//   MYOMARS_STATIC_DIR=myomars-hud               serve a folder at / (the HUD), optional
//   MYOMARS_RELAY_DATA=relay/.data               append-only persistence, optional (memory only if unset)
//   MYOMARS_ALLOWED_ORIGINS=http://a:3000,...    extra browser origins (same-host origins are always allowed)
import { networkInterfaces } from "node:os";
import { createRelay, RELAY_VERSION } from "./relay.ts";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const relay = createRelay({
  staticDir: process.env.MYOMARS_STATIC_DIR || null,
  dataDir: process.env.MYOMARS_RELAY_DATA || null,
  allowedOrigins: (process.env.MYOMARS_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
  log: (l) => console.log(`${new Date().toISOString().slice(11, 19)} ${l}`),
});
const actual = await relay.listen(port, host);
const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i!.address);
console.log(`MyoMars relay ${RELAY_VERSION} listening on ${host}:${actual}`);
console.log(`  local: http://127.0.0.1:${actual}/v1/health`);
for (const ip of lan) console.log(`  LAN:   http://${ip}:${actual}/v1/health`);
console.log(`  static: ${process.env.MYOMARS_STATIC_DIR || "(none)"} · persistence: ${process.env.MYOMARS_RELAY_DATA || "(memory only)"}`);
const stop = () => relay.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
