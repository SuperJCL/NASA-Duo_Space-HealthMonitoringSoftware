// MyoMars relay entry point.
//   node relay/server.ts                       (configuration from environment variables)
//   node --env-file-if-exists=relay/.env relay/server.ts
// See docs/myomars/README.md. Works the same on Linux, macOS and Windows (Node 22+).

import { loadConfig } from "./config.ts";
import { createRelay, RELAY_VERSION } from "./app.ts";

const config = loadConfig();
const relay = createRelay(config);
relay.server.listen(config.port, config.host, () => {
  const base = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
  console.log(`[relay] MyoMars relay ${RELAY_VERSION} listening on ${base}  (SIMULATED demo data only)`);
  console.log(`[relay] API ${base}/api/v1/health · data ${config.dataDir}${config.webRoot ? ` · static ${config.webRoot} → ${base}/station/` : ""}`);
  if (config.dev) console.log("[relay] DEV MODE: built-in demo access codes are enabled (station-demo, hud-demo, trigger-demo, observer-demo). Never use dev mode on a public server.");
  console.log(`[relay] roles enabled: ${Object.keys(config.accessCodes).join(", ")}`);
});
let closing = false;
const stop = (signal: string) => {
  if (closing) return;
  closing = true;
  console.log(`[relay] ${signal}: closing`);
  relay.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
