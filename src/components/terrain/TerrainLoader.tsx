"use client";

import dynamic from "next/dynamic";
import type { TerrainViewerProps } from "./TerrainViewer";

/** three.js needs the browser (WebGL), so the viewer is loaded client-side only, like the 2D map. */
const TerrainViewer = dynamic(() => import("./TerrainViewer").then((m) => m.TerrainViewer), {
  ssr: false,
  loading: () => <div className="flex size-full items-center justify-center bg-[#0b111c] text-sm text-[var(--mg-dim)]">{"Loading 3D terrain…"}</div>,
});

export function TerrainLoader(props: TerrainViewerProps) {
  return <TerrainViewer {...props} />;
}
