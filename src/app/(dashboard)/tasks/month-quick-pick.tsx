"use client";

// Sky Light feedback #19: monthly filter on the task list. The smart-search
// bar already supports `created_at:YYYYmM` tokens via the `d=` query param;
// this component is the prominent quick-pick they asked for — three preset
// buttons (this month / last month / custom) that mutate the same `d=`
// param so the rest of the filter pipeline (parseDateFilters → list_tasks_bundle)
// just works.

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Calendar, X } from "lucide-react";
import { cn } from "@/lib/utils";

const FIELD = "created_at"; // the team specifically asked for "tasks created in month M"

function tokenFor(year: number, monthIdx: number) {
  // monthIdx is 0-based; the token format expects 1-based.
  return `${FIELD}:${year}m${monthIdx + 1}`;
}

function tokenSet(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

// Find the month token currently active for our FIELD, if any.
function activeMonth(raw: string | null): { year: number; monthIdx: number } | null {
  for (const t of tokenSet(raw)) {
    const m = t.match(/^([a-z_]+):(\d{4})m(\d{1,2})$/);
    if (!m) continue;
    if (m[1] !== FIELD) continue;
    const year = Number(m[2]);
    const month = Number(m[3]);
    if (month >= 1 && month <= 12) return { year, monthIdx: month - 1 };
  }
  return null;
}

export function MonthQuickPick() {
  const t = useTranslations("TasksPage.monthQuickPick");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const dRaw = sp.get("d");
  const active = useMemo(() => activeMonth(dRaw), [dRaw]);

  const now = new Date();
  const thisMonth = { year: now.getFullYear(), monthIdx: now.getMonth() };
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = { year: lastMonthDate.getFullYear(), monthIdx: lastMonthDate.getMonth() };

  function applyMonth(target: { year: number; monthIdx: number } | null) {
    // Strip any existing token for FIELD, then optionally add the new one.
    const tokens = Array.from(tokenSet(dRaw)).filter(
      (t) => !t.startsWith(`${FIELD}:`),
    );
    if (target) tokens.push(tokenFor(target.year, target.monthIdx));
    const next = new URLSearchParams(sp.toString());
    if (tokens.length) next.set("d", tokens.join(","));
    else next.delete("d");
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  const isThis =
    active && active.year === thisMonth.year && active.monthIdx === thisMonth.monthIdx;
  const isLast =
    active && active.year === lastMonth.year && active.monthIdx === lastMonth.monthIdx;
  const isCustom = active && !isThis && !isLast;
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-border bg-background/60 px-1 py-1 text-xs",
        pending && "opacity-70",
      )}
      role="group"
      aria-label={t("groupLabel")}
    >
      <Calendar className="size-3.5 shrink-0 text-muted-foreground mx-1" />
      <button
        type="button"
        onClick={() => applyMonth(isThis ? null : thisMonth)}
        className={cn(
          "rounded-md px-2 py-1 transition-colors",
          isThis
            ? "bg-cyan/15 text-cyan font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {t("thisMonth")}
      </button>
      <button
        type="button"
        onClick={() => applyMonth(isLast ? null : lastMonth)}
        className={cn(
          "rounded-md px-2 py-1 transition-colors",
          isLast
            ? "bg-cyan/15 text-cyan font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {t("lastMonth")}
      </button>
      <select
        value={
          isCustom && active
            ? `${active.year}-${String(active.monthIdx + 1).padStart(2, "0")}`
            : ""
        }
        onChange={(e) => {
          const v = e.target.value;
          if (!v) {
            applyMonth(null);
            return;
          }
          const [yStr, mStr] = v.split("-");
          applyMonth({ year: Number(yStr), monthIdx: Number(mStr) - 1 });
        }}
        className={cn(
          "rounded-md bg-transparent px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-cyan",
          isCustom ? "text-cyan font-medium" : "text-muted-foreground",
        )}
        aria-label={t("pickMonth")}
      >
        <option value="">{t("customMonth")}</option>
        {/* Render the current year + previous year, all 12 months each. */}
        {[now.getFullYear(), now.getFullYear() - 1].map((year) => (
          <optgroup key={year} label={String(year)}>
            {Array.from({ length: 12 }, (_, idx) => (
              <option
                key={`${year}-${idx}`}
                value={`${year}-${String(idx + 1).padStart(2, "0")}`}
              >
                {monthFormatter.format(new Date(year, idx, 1))}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {active && (
        <button
          type="button"
          onClick={() => applyMonth(null)}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("clear")}
          title={t("clear")}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
