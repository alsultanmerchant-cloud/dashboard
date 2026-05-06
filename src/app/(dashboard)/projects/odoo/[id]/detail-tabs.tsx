"use client";

// Rwasem-style detail tabs: Overview · Tasks · Members · Updates · Settings.
// Mirrors Odoo's project form notebook so smart-buttons + tabs + chatter
// land in the same hierarchy users already know.

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type TabKey = "overview" | "tasks" | "members" | "updates" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "نظرة عامة" },
  { key: "tasks", label: "المهام" },
  { key: "members", label: "الفريق" },
  { key: "updates", label: "التحديثات" },
  { key: "settings", label: "الإعدادات" },
];

export function DetailTabs({
  overview,
  tasks,
  members,
  updates,
  settings,
  initial = "overview",
}: {
  overview: ReactNode;
  tasks: ReactNode;
  members: ReactNode;
  updates: ReactNode;
  settings: ReactNode;
  initial?: TabKey;
}) {
  const [active, setActive] = useState<TabKey>(initial);
  const panel: Record<TabKey, ReactNode> = {
    overview,
    tasks,
    members,
    updates,
    settings,
  };

  return (
    <div>
      {/* Tab strip */}
      <div className="sticky top-0 z-10 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              active === t.key
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">{panel[active]}</div>
    </div>
  );
}
