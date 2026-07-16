"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Bell, RefreshCw, Menu, MessageCircle } from "lucide-react";
import { AppSwitcher } from "./app-switcher";
import { TopbarCalendarPopover } from "./topbar-calendar-popover";
import { Button } from "@/components/ui/button";
import { useTopbarControls } from "@/components/layout/topbar-context";
import { PAGE_TITLE_KEYS } from "@/lib/nav";
import {
  CommandPaletteTrigger,
  QuickCreateTrigger,
} from "@/components/command-palette";
import { ThemeToggle } from "@/components/theme-toggle";
import { intlLocale } from "@/lib/utils-format";

const SmartSearchBar = dynamic(
  () =>
    import("@/app/(dashboard)/tasks/smart-search-bar").then((mod) => ({
      default: mod.SmartSearchBar,
    })),
  {
    loading: () => (
      <div className="h-10 rounded-xl border border-white/70 bg-white/95 dark:border-white/30 dark:bg-white/8" />
    ),
  },
);

const ProjectsSearchBar = dynamic(
  () =>
    import("@/app/(dashboard)/projects/projects-search-bar").then((mod) => ({
      default: mod.ProjectsSearchBar,
    })),
  {
    loading: () => (
      <div className="h-10 rounded-xl border border-white/70 bg-white/95 dark:border-white/30 dark:bg-white/8" />
    ),
  },
);

interface TopbarProps {
  unreadCount?: number;
  /** Unread direct-message count — shown as a badge on the chat icon. */
  dmUnreadCount?: number;
  onBellClick?: () => void;
  onMenuClick?: () => void;
  notificationPanel?: React.ReactNode;
}

// Slim, single-row top bar. The legacy day/week/month + month-name pills
// were removed per owner feedback — the main page should breathe more.
// Time filtering, when needed, will live inline on each page (e.g. /tasks
// already has filter chips in its own toolbar).
export function Topbar({
  unreadCount = 0,
  onBellClick,
  dmUnreadCount = 0,
  onMenuClick,
  notificationPanel,
}: TopbarProps) {
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
  const title =
    pageMeta?.title ?? (meta ? tTitles(meta.titleKey) : tGroups("dashboard"));
  const subtitle =
    pageMeta?.subtitle ??
    (meta?.subtitleKey ? tTitles(meta.subtitleKey) : tApp("title"));
  const showRefresh = pathname === "/dashboard" && !!onRefresh;
  const showTaskSearch = pathname === "/tasks";
  const showProjectSearch = pathname === "/projects";
  const formattedLastUpdated = lastUpdatedAt
    ? new Intl.DateTimeFormat(intlLocale(locale), {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(lastUpdatedAt))
    : null;
  const utilityChip =
    "rounded-xl border border-white/70 bg-white/95 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-md hover:bg-white hover:text-primary dark:border-soft dark:bg-soft-2 dark:text-muted-foreground dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:bg-white/18 dark:hover:text-white";
  const iconChip = `shrink-0 ${utilityChip}`;
  const searchTriggerClass =
    "inline-flex items-center gap-2 rounded-xl border border-white/70 bg-white/95 px-3 py-2 text-xs text-primary transition-colors hover:border-white hover:bg-white dark:border-white/45 dark:bg-white/8 dark:text-white dark:hover:border-white/60 dark:hover:bg-white/14";
  const primaryCreateClass =
    "inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/95 px-3.5 py-2 text-xs font-semibold text-primary transition-colors hover:border-white hover:bg-white dark:border-white/45 dark:bg-white/8 dark:text-white dark:hover:border-white/60 dark:hover:bg-white/14";

  return (
    <div
      className={`sticky top-0 px-3 pt-3 sm:px-6 ${
        notificationPanel ? "z-[60]" : "z-40"
      }`}
    >
      <div className="rwasem-topbar dark:glass-surface flex items-center justify-between gap-3 rounded-[20px] px-3 py-3 shadow-[var(--surface-elev)] sm:rounded-[26px] sm:px-5 dark:shadow-none rtl:flex-row-reverse">
        <div className="flex min-w-0 flex-1 items-center gap-3 rtl:flex-row-reverse">
          <Button
            variant="ghost"
            size="icon"
            className={`lg:hidden ${iconChip}`}
            onClick={onMenuClick}
          >
            <Menu className="w-5 h-5 text-primary dark:text-muted-foreground" />
          </Button>

          {/* Odoo-style 9-dot app switcher.
              Hidden on the mobile breakpoint where the hamburger covers it. */}
          <AppSwitcher className="hidden lg:inline-flex" />

          <div className="min-w-0 rtl:text-right">
            <h2 className="text-base sm:text-xl font-extrabold tracking-tight text-white truncate">
              {title}
            </h2>
            <p className="mt-0.5 text-[10px] sm:text-xs text-white/72 dark:text-muted-foreground hidden md:block truncate">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3 rtl:flex-row-reverse">
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
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                />
                {tTopbar("refresh")}
              </Button>
            </div>
          )}

          <div className="hidden md:flex items-center gap-2">
            <QuickCreateTrigger className={primaryCreateClass} />
            {showTaskSearch ? (
              <div className="w-[min(42vw,34rem)]">
                <SmartSearchBar variant="topbar" />
              </div>
            ) : showProjectSearch ? (
              <div className="w-[min(42vw,34rem)]">
                <ProjectsSearchBar />
              </div>
            ) : (
              <CommandPaletteTrigger className={searchTriggerClass} />
            )}
          </div>
          <div className="md:hidden">
            <QuickCreateTrigger className={primaryCreateClass} />
          </div>

          {/* Calendar shortcut to the current user's scheduled activities. */}
          <TopbarCalendarPopover className={`sm:rounded-2xl ${iconChip}`} />

          <ThemeToggle className={iconChip} />

          {/* Direct messages — quick link so the user doesn't have to dive
              into a project → task to find a chat with a colleague. The
              project's Button doesn't support asChild, so render a styled
              anchor that mirrors the icon-chip look used by the other
              topbar buttons. */}
          <Link
            href="/messages"
            aria-label="المحادثات"
            className={`inline-flex h-9 w-9 items-center justify-center relative sm:rounded-2xl ${iconChip}`}
          >
            <MessageCircle className="w-4 h-4 text-primary dark:text-cyan" />
            {dmUnreadCount > 0 && (
              <span className="absolute -top-0.5 -start-0.5 w-5 h-5 bg-cc-red rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                {dmUnreadCount}
              </span>
            )}
          </Link>

          <div className="relative shrink-0" data-bell-root>
            <Button
              variant="ghost"
              size="icon"
              className={`relative sm:rounded-2xl ${iconChip}`}
              onClick={onBellClick}
            >
              <Bell className="w-4 h-4 text-status-warning dark:text-amber" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -start-0.5 w-5 h-5 bg-cc-red rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                  {unreadCount}
                </span>
              )}
            </Button>
            {notificationPanel}
          </div>
        </div>
      </div>
    </div>
  );
}
