"use client";

import { useEffect, useState } from "react";
import type { TerrainMeta } from "@/lib/terrain/terrain";

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // non-secure contexts: skip, the size check still applies
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Download the committed DTM crop and verify its size and recorded checksum (never altered, never extrapolated). */
export async function loadVerifiedHeights(meta: TerrainMeta): Promise<Float32Array> {
  const res = await fetch(meta.heights.file);
  if (!res.ok) throw new Error(`the terrain data could not be loaded (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== meta.crop.cols * meta.crop.rows * 4) throw new Error("terrain data has an unexpected size");
  const digest = await sha256Hex(buf);
  if (digest && digest !== meta.heights.sha256) throw new Error("terrain data does not match its recorded checksum");
  return new Float32Array(buf);
}

/** A network failure surfaces as a TypeError ("Failed to fetch"): say it in plain words. */
export const heightsErrorText = (e: unknown) => (e instanceof TypeError ? "the terrain data could not be downloaded" : e instanceof Error ? e.message : "the terrain data could not be loaded");

/** MAP-2: the verified heights for a 2D panel, loaded only once `enabled` (e.g. when a connection is selected). */
export function useTerrainHeights(meta: TerrainMeta, enabled: boolean): { heights: Float32Array | null; error: string | null } {
  const [state, setState] = useState<{ heights: Float32Array | null; error: string | null }>({ heights: null, error: null });
  const want = enabled && !state.heights && !state.error;
  useEffect(() => {
    if (!want) return;
    let cancelled = false;
    loadVerifiedHeights(meta).then(
      (heights) => !cancelled && setState({ heights, error: null }),
      (e) => !cancelled && setState({ heights: null, error: heightsErrorText(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [want, meta]);
  return state;
}
