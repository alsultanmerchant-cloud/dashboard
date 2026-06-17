"use client";

// Generic, config-driven view switcher. Same look/behaviour as the
// project-management toggle (icon button group, cyan-dim active, URL-synced),
// but reusable on any page. The Tasks-specific switcher stays separate because
// of its default-view-per-context logic.

import type { LucideIcon } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface ViewOption {
  key: string;
  label: string;
  icon: LucideIcon;
}

export interface ViewSwitcherProps {
  views: ViewOption[];
  current: string;
  /** URL param to write (default "view"). */
  param?: string;
  /** When selected, this value omits the param (keeps URLs clean). */
  defaultView?: string;
  className?: string;
}

export function ViewSwitcher({
  views,
  current,
  param = "view",
  defaultView,
  className,
}: ViewSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setView(view: string) {
    const next = new URLSearchParams(params);
    if (defaultView && view === defaultView) next.delete(param);
    else next.set(param, view);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className={cn("inline-flex rounded-lg border border-soft bg-card/60 p-0.5", className)}>
      {views.map((v) => {
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
