"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** History now lives in Settings. This keeps old links and bookmarks working. */
export default function Audit() {
  const router = useRouter();
  useEffect(() => { router.replace("/settings?tab=history"); }, [router]);
  return null;
}
