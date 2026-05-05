"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Bell, RefreshCw, Menu, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTopbarControls } from "@/components/layout/topbar-context";
import { PAGE_TITLE_KEYS } from "@/lib/nav";
import { CommandPaletteTrigger, QuickCreateTrigger } from "@/components/command-palette";
import { ThemeToggle } from "@/components/theme-toggle";
import { intlLocale } from "@/lib/utils-format";

interface TopbarProps {
  unreadCount?: number;
  onBellClick?: () => void;
  onMenuClick?: () => void;
}

// Slim, single-row top bar. The legacy day/week/month + month-name pills
// were removed per owner feedback — the main page should breathe more.
// Time filtering, when needed, will live inline on each page (e.g. /tasks
// already has filter chips in its own toolbar).
export function Topbar({ unreadCount = 0, onBellClick, onMenuClick }: TopbarProps) {
  const pathname = usePathname();
  const locale = useLocale();
  const tTitles = useTranslations("PageTitles");
  const tApp = useTranslations("App");
  const tTopbar = useTranslations("Topbar");
  const tGroups = useTranslations("NavGroups");
  const meta = PAGE_TITLE_KEYS[pathname];
  const {
    controls: { onRefresh, isRefreshing, lastUpdatedAt },
    pageMeta,
  } = useTopbarControls();
  const title = pageMeta?.title ?? (meta ? tTitles(meta.titleKey) : tGroups("dashboard"));
  const subtitle = pageMeta?.subtitle ?? (meta?.subtitleKey ? tTitles(meta.subtitleKey) : tApp("title"));
  const showRefresh = pathname === "/dashboard" && !!onRefresh;
  const formattedLastUpdated = lastUpdatedAt
    ? new Intl.DateTimeFormat(intlLocale(locale), {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(lastUpdatedAt))
    : null;

  /* Live clock — initialize null to avoid hydration mismatch */
  const [now, setNow] = useState<Date | null>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const clockStr = now
    ? new Intl.DateTimeFormat(intlLocale(locale), {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(now)
    : "";
  const utilityChip =
    "rounded-xl border border-white/16 bg-white/12 text-white/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md hover:bg-white/18 hover:text-white dark:border-soft dark:bg-soft-2 dark:text-muted-foreground";
  const iconChip = `shrink-0 ${utilityChip}`;
  const searchTriggerClass =
    "inline-flex items-center gap-2 rounded-xl border border-white/45 bg-white/8 px-3 py-2 text-xs text-white transition-colors hover:bg-white/14 hover:border-white/60";
  const primaryCreateClass =
    "inline-flex items-center gap-1.5 rounded-xl border border-white/45 bg-white/8 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/14 hover:border-white/60";

  return (
    <div className="sticky top-0 z-40 px-3 sm:px-6 pt-3">
      <div className="rwasem-topbar dark:glass-surface flex items-center justify-between rounded-[20px] sm:rounded-[26px] px-3 sm:px-5 py-3 gap-3 shadow-[var(--surface-elev)] dark:shadow-none">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="icon"
            className={`lg:hidden ${iconChip}`}
            onClick={onMenuClick}
          >
            <Menu className="w-5 h-5 text-white/90 dark:text-muted-foreground" />
          </Button>

          <div className="min-w-0">
            <h2 className="text-base sm:text-xl font-extrabold tracking-tight text-white truncate">{title}</h2>
            <p className="mt-0.5 text-[10px] sm:text-xs text-white/72 dark:text-muted-foreground hidden md:block truncate">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {showRefresh && (
            <div className="hidden md:flex items-center gap-2 rounded-2xl border border-white/40 bg-white/40 dark:border-soft dark:bg-soft-2 px-3 py-2">
              {formattedLastUpdated && (
                <p className="text-[11px] text-foreground/70 dark:text-muted-foreground">
                  {tTopbar("lastUpdated")}: {formattedLastUpdated}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onRefresh?.()}
                disabled={Boolean(isRefreshing)}
                className="gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                {tTopbar("refresh")}
              </Button>
            </div>
          )}

          <div className="hidden md:flex items-center gap-2">
            <QuickCreateTrigger className={primaryCreateClass} />
            <CommandPaletteTrigger className={searchTriggerClass} />
          </div>
          <div className="md:hidden">
            <QuickCreateTrigger className={primaryCreateClass} />
          </div>

          <div className="hidden lg:flex items-center gap-2">
            <span className={`${utilityChip} px-3 py-1.5 text-xs font-mono`} dir="ltr">
              {clockStr}
            </span>
            <Button variant="ghost" size="icon" className={iconChip}>
              <CalendarDays className="w-4 h-4 text-white/88 dark:text-muted-foreground" />
            </Button>
          </div>

          <ThemeToggle className={iconChip} />

          <Button variant="ghost" size="icon" className={`relative sm:rounded-2xl ${iconChip}`} onClick={onBellClick}>
            <Bell className="w-4 h-4 text-amber" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -left-0.5 w-5 h-5 bg-cc-red rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                {unreadCount}
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
