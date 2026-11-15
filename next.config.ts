import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// Build identifier shown on the station (so a running server can be matched to a commit).
// Evaluated when `next dev` / `next build` starts: it names the code that server was started from.
const git = (cmd: string) => {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};
const BUILD_COMMIT = `${git("git rev-parse --short HEAD") || "unknown"}${git("git status --porcelain --untracked-files=no") ? "-dirty" : ""}`;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_COMMIT: BUILD_COMMIT, NEXT_PUBLIC_BUILD_TIME: new Date().toISOString() },
  cacheComponents: true,
  // MAP-0: Mission Glass moved from /mission-glass to the default entry (/).
  async redirects() {
    return [{ source: "/mission-glass", destination: "/", permanent: false }];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
