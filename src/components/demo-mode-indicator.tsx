"use client";

// Small always-on marker shown while demo mode is active, so you never start a
// recording believing data is blurred when it isn't (or leave it on and wonder
// why the numbers are fuzzy).
//
// It fades back once you've seen it — a persistent bright badge would sit in
// every frame of the video this feature exists to enable.

import { useEffect, useState } from "react";
import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDemoMode } from "@/lib/demo-mode";
import { cn } from "@/lib/utils";

export function DemoModeIndicator() {
  const { enabled, setEnabled } = useDemoMode();
  const t = useTranslations("DemoMode");
  const [dimmed, setDimmed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setDimmed(false);
      return;
    }
    const timer = window.setTimeout(() => setDimmed(true), 4000);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={() => setEnabled(false)}
      title={t("indicatorTooltip")}
      className={cn(
        "fixed bottom-3 z-50 flex items-center gap-1.5 rounded-full px-2.5 py-1",
        "ltr:left-3 rtl:right-3",
        "border border-amber-500/40 bg-amber-500/10 text-[10px] font-medium text-amber-600",
        "backdrop-blur-sm transition-opacity duration-500 hover:opacity-100",
        "dark:text-amber-400",
        dimmed ? "opacity-25" : "opacity-100",
      )}
    >
      <EyeOff className="size-3" />
      {t("indicatorLabel")}
    </button>
  );
}
