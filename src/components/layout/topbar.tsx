"use client";

import { useRef, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Bell, RefreshCw, Menu, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTopbarControls, type TimeFilter } from "@/components/layout/topbar-context";
import { MONTHS_AR } from "@/lib/utils/constants";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "نظرة عامة",
  "/sales": "المبيعات",
  "/renewals": "التجديدات",
  "/satisfaction": "رضا العملاء",
  "/support": "الدعم",
  "/development": "التطويرات",
  "/partnerships": "الشراكات",
  "/team": "الفريق",
  "/finance": "المالية",
  "/upload": "رفع البيانات",
  "/agent": "المساعد الذكي",
};

const PAGE_SUBTITLES: Record<string, string> = {
  "/dashboard": "لوحة تنفيذية مركزة على الإشارات الأهم الآن",
  "/sales": "متابعة الصفقات وخط الأنابيب من مكان واحد",
  "/renewals": "متابعة تجديد العملاء ومعدلات الاحتفاظ",
  "/satisfaction": "مؤشرات رضا العملاء وتحليل NPS",
  "/support": "رؤية أسرع لحالة التذاكر والاستجابة",
  "/development": "حالة المشاريع الجارية والتقدم الفعلي",
  "/partnerships": "متابعة العلاقات والقيمة الاستراتيجية",
  "/team": "نظرة تشغيلية على الفريق وتوزيع الجهد",
  "/finance": "قراءة مالية مبنية على البيانات الفعلية",
  "/upload": "إدخال البيانات وربط النظام بالمصادر",
  "/agent": "طبقة ذكاء مساعدة فوق بيانات الشركة",
};

const TIME_FILTERS: TimeFilter[] = ["اليوم", "الأسبوع", "الشهر", "الكل"];

interface TopbarProps {
  unreadCount?: number;
  onBellClick?: () => void;
  onMenuClick?: () => void;
}

export function Topbar({ unreadCount = 0, onBellClick, onMenuClick }: TopbarProps) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] || "لوحة التحكم";
  const subtitle = PAGE_SUBTITLES[pathname] || "مركز متابعة حي للمبيعات والتشغيل";
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
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
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
            <p className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-muted-foreground hidden sm:block">{subtitle}</p>
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

          {/* Time filters — hidden on mobile, visible on sm+ */}
          <div className="hidden sm:flex items-center gap-1 rounded-2xl border border-white/6 bg-white/[0.03] p-1 sm:p-1.5">
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

          {/* Clock + Calendar */}
          <div className="hidden sm:flex items-center gap-2">
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

      {/* Mobile time filters — visible only on mobile */}
      <div className="sm:hidden flex items-center gap-1 rounded-2xl glass-surface p-1.5 overflow-x-auto scrollbar-hide">
        {TIME_FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => {
              onFilterChange(filter);
              if (filter !== "الكل") onMonthChange(null);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all shrink-0 ${
              activeFilter === filter && !activeMonth
                ? "bg-cyan/15 text-cyan font-medium border border-cyan/30"
                : "text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Month bar */}
      <div
        ref={monthsRef}
        className="glass-surface rounded-2xl px-2 sm:px-4 py-2 sm:py-2.5 flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-hide"
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
