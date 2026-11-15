"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { StationAdapter } from "@/lib/station/adapter";
import { StationController } from "@/lib/station/controller";

/**
 * Connects the station controller (src/lib/station/controller.ts) to React. The adapter is attached
 * in an effect, so a re-mount never subscribes twice. No business rule lives here.
 */
export function useStation(adapter: StationAdapter, { stageDelayMs = 1100, sessionId = "local" }: { stageDelayMs?: number; sessionId?: string } = {}) {
  const [ctl] = useState(() => new StationController(adapter, stageDelayMs, undefined, sessionId));
  useEffect(() => ctl.attach(), [ctl]);
  const { state, lastError } = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot);
  return { state, lastError, review: ctl.review, resend: ctl.resend, view: ctl.view };
}

export type StationApi = ReturnType<typeof useStation>;
