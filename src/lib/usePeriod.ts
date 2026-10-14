"use client";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { currentPeriod } from "./format";

/** A month picker that starts on the latest month with bills (or this month when there are none) until the user chooses one. */
export function usePeriod(): readonly [string, (p: string) => void] {
  const latest = useQuery(api.billing.latestPeriod);
  const [picked, setPicked] = useState<string | null>(null);
  return [picked ?? latest ?? currentPeriod(), setPicked] as const;
}
