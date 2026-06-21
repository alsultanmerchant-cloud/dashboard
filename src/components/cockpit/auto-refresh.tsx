"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-runs the current route's server components on an interval so the agent's
// snapshot + action-required numbers stay live without a manual reload. Pauses
// while the tab is hidden to avoid pointless work. Renders nothing.
export function AutoRefresh({ intervalMs = 300_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        router.refresh();
      }
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
