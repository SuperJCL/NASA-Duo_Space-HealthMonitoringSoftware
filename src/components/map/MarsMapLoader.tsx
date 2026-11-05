"use client";

import dynamic from "next/dynamic";
import type { MarsMapProps } from "./MarsMap";

/**
 * OpenLayers touches `window` and canvas APIs at import time, so the map is
 * loaded client-side only. `ssr: false` must live in a Client Component.
 */
const MarsMap = dynamic(() => import("./MarsMap").then((mod) => mod.MarsMap), {
  ssr: false,
  loading: () => <div className="flex size-full items-center justify-center bg-background text-sm text-muted">Loading map…</div>,
});

export function MarsMapLoader(props: MarsMapProps) {
  return <MarsMap {...props} />;
}
