"use client";

import { useRef, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Bell, RefreshCw, Menu, CalendarDays, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTopbarControls, type TimeFilter } from "@/components/layout/topbar-context";
import { MONTHS_AR } from "@/lib/utils/constants";
import { PAGE_TITLES } from "@/lib/nav";
import { CommandPaletteTrigger, QuickCreateTrigger } from "@/components/command-palette";
import { cn } from "@/lib/utils";

const TIME_FILTERS: TimeFilter[] = ["اليوم", "الأسبوع", "الشهر", "الكل"];

interface TopbarProps {
  unreadCount?: number;
  onBellClick?: () => void;
  onMenuClick?: () => void;
}

export function Topbar({ unreadCount = 0, onBellClick, onMenuClick }: TopbarProps) {
  const pathname = usePathname();
  const meta = PAGE_TITLES[pathname];
  const title = meta?.title ?? "لوحة التحكم";
  const subtitle = meta?.subtitle ?? "مركز قيادة الوكالة";
  const monthsRef = useRef<HTMLDivElement>(null);
  const {
    controls: { onRefresh, isRefreshing, lastUpdatedAt },
    activeMonth,
    setActiveMonth: onMonthChange,
    activeFilter,
    setActiveFilter: onFilterChange,
  } = useTopbarControls();
  const showRefresh = pathname === "/dashboard" && !!onRefresh;
  const formattedLastUpdated = lastUpdatedAt
    ? new Intl.DateTimeFormat("ar-EG", {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(lastUpdatedAt))
    : null;

  const showPeriodBadge = activeFilter !== "الكل" || activeMonth !== null;

  /* Live clock — initialize null to avoid hydration mismatch */
  const [now, setNow] = useState<Date | null>(() => new Date());
  const [mobileDaysOpen, setMobileDaysOpen] = useState(false);
  const [mobileMonthsOpen, setMobileMonthsOpen] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const clockStr = now
    ? new Intl.DateTimeFormat("ar-EG", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(now)
    : "";

  return (
    <div className="sticky top-0 z-40 px-3 sm:px-6 pt-3 space-y-2">
      <div className="glass-surface flex items-center justify-between rounded-[20px] sm:rounded-[26px] px-3 sm:px-5 py-3 sm:py-4 gap-3">
        {/* Left side: hamburger (mobile) + title */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Hamburger — only on mobile/tablet */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden shrink-0 rounded-xl bg-white/[0.03] hover:bg-white/[0.06]"
            onClick={onMenuClick}
          >
            <Menu className="w-5 h-5 text-muted-foreground" />
          </Button>

          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 flex-wrap">
              <span className="rounded-full border border-cyan/15 bg-cyan-dim px-2 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-semibold tracking-[0.18em] text-cyan uppercase">
                لوحة التحكم
              </span>
              {showPeriodBadge && (
                <span className="rounded-full bg-cyan/15 border border-cyan/25 px-2 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-medium text-cyan">
                  {activeMonth || activeFilter}
                </span>
              )}
            </div>
            <h2 className="text-base sm:text-xl font-extrabold tracking-tight text-foreground truncate">{title}</h2>
            <p className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-muted-foreground hidden xl:block truncate">{subtitle}</p>
          </div>
        </div>

        {/* Right side: controls */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {showRefresh && (
            <div className="hidden md:flex items-center gap-2 rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-2">
              {formattedLastUpdated && (
                <p className="text-[11px] text-muted-foreground">
                  آخر تحديث: {formattedLastUpdated}
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
                تحديث
              </Button>
            </div>
          )}

          {/* Time filters — hidden on small/medium, visible on xl+ */}
          <div className="hidden xl:flex items-center gap-1 rounded-2xl border border-white/6 bg-white/[0.03] p-1 sm:p-1.5">
            {TIME_FILTERS.map((filter) => (
              <button
                key={filter}
                onClick={() => {
                  onFilterChange(filter);
                  if (filter !== "الكل") onMonthChange(null);
                }}
                className={`px-3 sm:px-4 py-1.5 rounded-xl text-[10px] sm:text-xs transition-all ${
                  activeFilter === filter && !activeMonth
                    ? "bg-cyan/15 text-cyan font-medium border border-cyan/30 shadow-[0_0_10px_rgba(0,212,255,0.15)]"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          {/* Quick-create + Cmd-K trigger — desktop only */}
          <div className="hidden md:flex items-center gap-2">
            <QuickCreateTrigger />
            <CommandPaletteTrigger />
          </div>
          {/* Mobile quick-create */}
          <div className="md:hidden">
            <QuickCreateTrigger />
          </div>

          {/* Clock + Calendar */}
          <div className="hidden xl:flex items-center gap-2">
            <span className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-1.5 text-xs text-muted-foreground font-mono" dir="ltr">
              {clockStr}
            </span>
            <Button variant="ghost" size="icon" className="rounded-xl bg-white/[0.03] hover:bg-white/[0.06]">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
            </Button>
          </div>

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative rounded-xl sm:rounded-2xl bg-white/[0.03] hover:bg-white/[0.06]" onClick={onBellClick}>
            <Bell className="w-4 h-4 text-amber" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -left-0.5 w-5 h-5 bg-cc-red rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                {unreadCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Compact filters (mobile/tablet/desktop below xl) */}
      <div className="xl:hidden space-y-2">
        <div className="glass-surface flex items-center gap-2 rounded-2xl p-1.5">
          <button
            type="button"
            onClick={() => setMobileDaysOpen((open) => !open)}
            className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs"
          >
            <span className="flex items-center gap-2 min-w-0">
              <SlidersHorizontal className="h-3.5 w-3.5 text-cyan shrink-0" />
              <span className="truncate text-foreground">
                {activeMonth ? "التصفية اليومية" : activeFilter}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                mobileDaysOpen && "rotate-180"
              )}
            />
          </button>
          <button
            type="button"
            onClick={() => setMobileMonthsOpen((open) => !open)}
            className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs"
          >
            <span className="flex items-center gap-2 min-w-0">
              <CalendarDays className="h-3.5 w-3.5 text-cyan shrink-0" />
              <span className="truncate text-foreground">{activeMonth ?? "كل الشهور"}</span>
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                mobileMonthsOpen && "rotate-180"
              )}
            />
          </button>
        </div>

        {mobileDaysOpen && (
          <div className="glass-surface flex items-center gap-1 overflow-x-auto rounded-2xl p-1.5 scrollbar-hide">
            {TIME_FILTERS.map((filter) => (
              <button
                key={filter}
                onClick={() => {
                  onFilterChange(filter);
                  if (filter !== "الكل") onMonthChange(null);
                  setMobileDaysOpen(false);
                }}
                className={`shrink-0 whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs transition-all ${
                  activeFilter === filter && !activeMonth
                    ? "border-cyan/30 bg-cyan/15 font-medium text-cyan"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        )}

        {mobileMonthsOpen && (
          <div
            ref={monthsRef}
            className="glass-surface flex items-center gap-1.5 overflow-x-auto rounded-2xl px-2 py-2 scrollbar-hide"
          >
            {MONTHS_AR.map((month, idx) => {
              const isCurrentMonth = now ? idx === now.getMonth() : false;
              const isSelected = activeMonth === month;
              return (
                <button
                  key={month}
                  onClick={() => {
                    if (activeMonth === month) {
                      onMonthChange(null);
                    } else {
                      onMonthChange(month);
                      onFilterChange("الكل");
                    }
                    setMobileMonthsOpen(false);
                  }}
                  className={`relative shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-[10px] font-medium transition-all ${
                    isSelected
                      ? "border border-cyan/30 bg-cyan/15 text-cyan shadow-[0_0_12px_rgba(0,212,255,0.15)]"
                      : isCurrentMonth
                      ? "border border-white/10 bg-white/[0.06] text-foreground"
                      : "border border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                  }`}
                >
                  {month}
                  {isCurrentMonth && !isSelected && (
                    <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-cyan" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop month bar */}
      <div
        ref={monthsRef}
        className="hidden xl:flex glass-surface rounded-2xl px-2 sm:px-4 py-2 sm:py-2.5 items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-hide"
      >
        {MONTHS_AR.map((month, idx) => {
          const isCurrentMonth = now ? idx === now.getMonth() : false;
          const isSelected = activeMonth === month;
          return (
            <button
              key={month}
              onClick={() => {
                if (activeMonth === month) {
                  onMonthChange(null);
                } else {
                  onMonthChange(month);
                  onFilterChange("الكل");
                }
              }}
              className={`relative px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-[10px] sm:text-xs whitespace-nowrap transition-all shrink-0 font-medium ${
                isSelected
                  ? "bg-cyan/15 text-cyan border border-cyan/30 shadow-[0_0_12px_rgba(0,212,255,0.15)]"
                  : isCurrentMonth
                  ? "bg-white/[0.06] text-foreground border border-white/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04] border border-transparent"
              }`}
            >
              {month}
              {isCurrentMonth && !isSelected && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-cyan" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
