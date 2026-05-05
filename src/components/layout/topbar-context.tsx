"use client";

import { createContext, useContext, useCallback, useMemo, useState } from "react";
import { MONTHS_AR } from "@/lib/utils/constants";

interface TopbarControls {
  onRefresh?: () => void | Promise<void>;
  isRefreshing?: boolean;
  lastUpdatedAt?: string | null;
}

interface TopbarPageMeta {
  title: string;
  subtitle?: string;
}

export type TimeFilter = "اليوم" | "الأسبوع" | "الشهر" | "الكل";

interface TopbarContextValue {
  controls: TopbarControls;
  setControls: React.Dispatch<React.SetStateAction<TopbarControls>>;
  pageMeta: TopbarPageMeta | null;
  setPageMeta: React.Dispatch<React.SetStateAction<TopbarPageMeta | null>>;
  activeMonth: string | null;
  setActiveMonth: (month: string | null) => void;
  /** Returns { month, year } for the selected month, or null if none selected */
  activeMonthIndex: { month: number; year: number } | null;
  activeFilter: TimeFilter;
  setActiveFilter: (filter: TimeFilter) => void;
  /** Returns a cutoff Date for the active time filter, or null if "الكل" */
  filterCutoff: Date | null;
}

const TopbarContext = createContext<TopbarContextValue | null>(null);

export function TopbarProvider({ children }: { children: React.ReactNode }) {
  const [controls, setControls] = useState<TopbarControls>({});
  const [pageMeta, setPageMeta] = useState<TopbarPageMeta | null>(null);
  const [activeMonth, setActiveMonthRaw] = useState<string | null>(null);
  const [activeFilter, setActiveFilterRaw] = useState<TimeFilter>("الكل");

  const setActiveMonth = useCallback((month: string | null) => {
    setActiveMonthRaw(month);
  }, []);

  const setActiveFilter = useCallback((filter: TimeFilter) => {
    setActiveFilterRaw(filter);
  }, []);

  const activeMonthIndex = useMemo(() => {
    if (!activeMonth) return null;
    const idx = (MONTHS_AR as readonly string[]).indexOf(activeMonth);
    if (idx === -1) return null;
    return { month: idx + 1, year: new Date().getFullYear() };
  }, [activeMonth]);

  const filterCutoff = useMemo(() => {
    const now = new Date();
    switch (activeFilter) {
      case "اليوم": {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return d;
      }
      case "الأسبوع": {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        d.setHours(0, 0, 0, 0);
        return d;
      }
      case "الشهر": {
        const d = new Date(now.getFullYear(), now.getMonth(), 1);
        return d;
      }
      default:
        return null;
    }
  }, [activeFilter]);

  const value = useMemo(
    () => ({
      controls,
      setControls,
      pageMeta,
      setPageMeta,
      activeMonth,
      setActiveMonth,
      activeMonthIndex,
      activeFilter,
      setActiveFilter,
      filterCutoff,
    }),
    [controls, pageMeta, activeMonth, setActiveMonth, activeMonthIndex, activeFilter, setActiveFilter, filterCutoff]
  );

  return <TopbarContext.Provider value={value}>{children}</TopbarContext.Provider>;
}

export function useTopbarControls() {
  const context = useContext(TopbarContext);

  if (!context) {
    throw new Error("useTopbarControls must be used within TopbarProvider");
  }

  return context;
}
