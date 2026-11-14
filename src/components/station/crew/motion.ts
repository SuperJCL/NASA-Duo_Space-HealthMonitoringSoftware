"use client";

// Presentation-only helpers for the crew station. None of them drives a business step: the
// station state machine decides; these only show what it already recorded.

import { useEffect, useRef, useSyncExternalStore } from "react";

export const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const played = new Set<string>();

/**
 * Play a short animation ONCE per key (a new message, a new current node). Never replays on a
 * re-render or remount, never plays for what was already there when the element first appeared
 * (opening a panel shows the state, it does not "re-animate" history), and never plays with
 * reduced motion. The business state is the same whether or not it plays.
 */
export function useOnceAnimation<T extends HTMLElement>(key: string | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  const ref = useRef<T>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!key) return;
    const first = !mounted.current;
    mounted.current = true;
    if (played.has(key)) return;
    played.add(key);
    const el = ref.current;
    if (first || !el || prefersReducedMotion() || typeof el.animate !== "function") return;
    const a = el.animate(keyframes, options);
    return () => a.cancel();
  }, [key, keyframes, options]);
  return ref;
}

// One shared 1 s clock for elapsed-time labels (display only).
let nowValue = 0;
const nowListeners = new Set<() => void>();
let nowTimer: ReturnType<typeof setInterval> | null = null;
function subscribeNow(l: () => void) {
  nowListeners.add(l);
  if (!nowTimer) {
    nowValue = Date.now();
    nowTimer = setInterval(() => {
      nowValue = Date.now();
      for (const x of nowListeners) x();
    }, 1000);
  }
  return () => {
    nowListeners.delete(l);
    if (!nowListeners.size && nowTimer) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}
/** Current time in ms, refreshed every second (0 before the first tick / on the server). */
export const useNow = () => useSyncExternalStore(subscribeNow, () => nowValue, () => 0);

const subscribeVisibility = (l: () => void) => {
  document.addEventListener("visibilitychange", l);
  return () => document.removeEventListener("visibilitychange", l);
};
/** Whether the page is visible (a hidden page never marks anything as viewed). */
export const usePageVisible = () => useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "visible", () => false);

export const elapsed = (sinceIso: string | null, now: number) => {
  if (!sinceIso || !now) return "–";
  const s = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const duration = (sinceIso: string | null, now: number) => {
  if (!sinceIso || !now) return "–";
  const m = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 60_000));
  return `${Math.floor(m / 60)} 小时 ${String(m % 60).padStart(2, "0")} 分`;
};
