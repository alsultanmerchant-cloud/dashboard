"use client";

// View-switcher for /tasks (kanban / list / calendar). Mirrors Odoo's
// upper-right view toggle. URL-encoded so deep links survive reload.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutGrid, List, Calendar, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

const VIEWS = [
  { key: "kanban", labelKey: "kanban", icon: LayoutGrid },
  { key: "list", labelKey: "list", icon: List },
  { key: "calendar", labelKey: "calendar", icon: Calendar },
  { key: "pivot", labelKey: "pivot", icon: Table2 },
] as const;

export function ViewSwitcher({ current }: { current: string }) {
  const t = useTranslations("TasksPage.views");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const defaultView =
    params.get("projectId") || params.get("odooProjectId") ? "kanban" : "list";

  function setView(view: string) {
    const next = new URLSearchParams(params);
    if (view === defaultView) next.delete("view");
    else next.set("view", view);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
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
            title={t(v.labelKey)}
            aria-pressed={active}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{t(v.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
