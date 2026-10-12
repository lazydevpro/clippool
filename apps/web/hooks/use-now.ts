"use client";

import { useSyncExternalStore } from "react";

// One shared 1s ticker for every countdown on the page. Returns null during SSR / before hydration so
// server and client markup match (and prerendering never reads the clock).
let current = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    current = Math.floor(Date.now() / 1000);
    timer = setInterval(() => {
      current = Math.floor(Date.now() / 1000);
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot() {
  if (!current) current = Math.floor(Date.now() / 1000);
  return current;
}

/** Current unix time in seconds, ticking every second; null on the server. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
