"use client";

// View-switcher for /tasks (kanban / list / calendar). Mirrors Odoo's
// upper-right view toggle. URL-encoded so deep links survive reload.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { LayoutGrid, List, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

const VIEWS = [
  { key: "kanban", label: "Kanban", icon: LayoutGrid },
  { key: "list", label: "قائمة", icon: List },
  { key: "calendar", label: "تقويم", icon: Calendar },
] as const;

export function ViewSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setView(view: string) {
    const next = new URLSearchParams(params);
    next.set("view", view);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="inline-flex rounded-lg border border-soft bg-card/60 p-0.5">
      {VIEWS.map((v) => {
        const Icon = v.icon;
        const active = current === v.key;
        return (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
              active
                ? "bg-cyan-dim text-cyan"
                : "text-muted-foreground hover:text-foreground hover:bg-soft-2",
            )}
            title={v.label}
            aria-pressed={active}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{v.label}</span>
          </button>
        );
      })}
    </div>
  );
}
