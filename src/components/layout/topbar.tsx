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
  // `tTitles.has` would be ideal but not available in this version; tolerate
  // missing keys by falling back to the default title/subtitle.
  const title = meta ? tTitles(meta.titleKey) : tGroups("dashboard");
  const subtitle = meta?.subtitleKey ? tTitles(meta.subtitleKey) : tApp("title");
  const {
    controls: { onRefresh, isRefreshing, lastUpdatedAt },
  } = useTopbarControls();
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

  return (
    <div className="sticky top-0 z-40 px-3 sm:px-6 pt-3">
      <div className="rwasem-topbar dark:glass-surface flex items-center justify-between rounded-[20px] sm:rounded-[26px] px-3 sm:px-5 py-3 gap-3 shadow-[var(--surface-elev)] dark:shadow-none">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden shrink-0 rounded-xl bg-white/40 hover:bg-white/60 dark:bg-soft-2 dark:hover:bg-soft-2"
            onClick={onMenuClick}
          >
            <Menu className="w-5 h-5 text-foreground/80 dark:text-muted-foreground" />
          </Button>

          <div className="min-w-0">
            <h2 className="text-base sm:text-xl font-extrabold tracking-tight text-foreground truncate">{title}</h2>
            <p className="mt-0.5 text-[10px] sm:text-xs text-foreground/70 dark:text-muted-foreground hidden md:block truncate">{subtitle}</p>
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
            <QuickCreateTrigger />
            <CommandPaletteTrigger />
          </div>
          <div className="md:hidden">
            <QuickCreateTrigger />
          </div>

          <div className="hidden lg:flex items-center gap-2">
            <span className="rounded-xl border border-white/40 bg-white/40 dark:border-soft dark:bg-soft-2 px-3 py-1.5 text-xs text-foreground/80 dark:text-muted-foreground font-mono" dir="ltr">
              {clockStr}
            </span>
            <Button variant="ghost" size="icon" className="rounded-xl bg-white/40 hover:bg-white/60 dark:bg-soft-2 dark:hover:bg-soft-2">
              <CalendarDays className="w-4 h-4 text-foreground/80 dark:text-muted-foreground" />
            </Button>
          </div>

          <ThemeToggle className="rounded-xl bg-white/40 hover:bg-white/60 dark:bg-soft-2 dark:hover:bg-soft-2" />

          <Button variant="ghost" size="icon" className="relative rounded-xl sm:rounded-2xl bg-white/40 hover:bg-white/60 dark:bg-soft-2 dark:hover:bg-soft-2" onClick={onBellClick}>
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
