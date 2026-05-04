"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, ChevronLeft, Calendar } from "lucide-react";

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function shiftMonth(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthSelector({ monthIso }: { monthIso: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [y, m] = monthIso.split("-").map(Number);
  const label = `${MONTHS_AR[m - 1]} ${y}`;

  function go(targetIso: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("month", targetIso);
    router.push(`/finance?${params.toString()}`);
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-white/[0.08] bg-card/60 px-1.5 py-1">
      <button
        type="button"
        onClick={() => go(shiftMonth(monthIso, -1))}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-colors"
        aria-label="الشهر السابق"
      >
        <ChevronRight className="size-4" />
      </button>
      <div className="inline-flex items-center gap-1.5 px-2 text-sm font-medium tabular-nums">
        <Calendar className="size-3.5 text-cyan" />
        {label}
      </div>
      <button
        type="button"
        onClick={() => go(shiftMonth(monthIso, 1))}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-colors"
        aria-label="الشهر التالي"
      >
        <ChevronLeft className="size-4" />
      </button>
    </div>
  );
}
