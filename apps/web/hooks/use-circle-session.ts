"use client";

import { useSyncExternalStore } from "react";
import { readCircleSession, subscribeCircleSession, type CircleSession } from "@/lib/client/circle";

export function useCircleSession(): CircleSession | null {
  return useSyncExternalStore(subscribeCircleSession, readCircleSession, () => null);
}
