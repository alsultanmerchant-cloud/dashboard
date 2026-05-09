"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectsDateFilterButtonProps {
  className?: string;
}

export function ProjectsDateFilterButton({ className }: ProjectsDateFilterButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const startDateFrom = params.get("startDateFrom") ?? "";
  const startDateTo = params.get("startDateTo") ?? "";
  const endDateFrom = params.get("endDateFrom") ?? "";
  const endDateTo = params.get("endDateTo") ?? "";

  const hasDateFilter = Boolean(
    startDateFrom || startDateTo || endDateFrom || endDateTo,
  );

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const updateParams = (mutate: (sp: URLSearchParams) => void) => {
    const sp = new URLSearchParams(params.toString());
    mutate(sp);
    router.replace(sp.toString() ? `${pathname}?${sp.toString()}` : pathname);
  };

  const setDate = (key: string, value: string) => {
    updateParams((sp) => {
      if (value) sp.set(key, value);
      else sp.delete(key);
    });
  };

  const clearAll = () => {
    updateParams((sp) => {
      sp.delete("startDateFrom");
      sp.delete("startDateTo");
      sp.delete("endDateFrom");
      sp.delete("endDateTo");
    });
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label="فلتر التاريخ"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative inline-flex size-8 items-center justify-center rounded-xl",
          className,
        )}
      >
        <CalendarDays className="w-4 h-4 text-white/88 dark:text-muted-foreground" />
        {hasDateFilter && (
          <span className="absolute -top-0.5 -end-0.5 size-2 rounded-full bg-cyan ring-2 ring-background" />
        )}
      </button>

      {open && (
        <div className="absolute end-0 top-[calc(100%+6px)] z-50 w-[280px] rounded-2xl border border-white/20 bg-card/98 p-3 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">
              فلتر بالتاريخ
            </span>
            {hasDateFilter && (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" /> إزالة
              </button>
            )}
          </div>

          <div className="px-1 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Start Date
          </div>
          <div className="mb-2 flex items-center gap-1">
            <input
              type="date"
              value={startDateFrom}
              onChange={(e) => setDate("startDateFrom", e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-soft bg-card/50 px-1.5 py-1 text-[11px] text-foreground"
            />
            <span className="text-[10px] text-muted-foreground">→</span>
            <input
              type="date"
              value={startDateTo}
              onChange={(e) => setDate("startDateTo", e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-soft bg-card/50 px-1.5 py-1 text-[11px] text-foreground"
            />
          </div>

          <div className="px-1 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            End Date
          </div>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={endDateFrom}
              onChange={(e) => setDate("endDateFrom", e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-soft bg-card/50 px-1.5 py-1 text-[11px] text-foreground"
            />
            <span className="text-[10px] text-muted-foreground">→</span>
            <input
              type="date"
              value={endDateTo}
              onChange={(e) => setDate("endDateTo", e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-soft bg-card/50 px-1.5 py-1 text-[11px] text-foreground"
            />
          </div>
        </div>
      )}
    </div>
  );
}
