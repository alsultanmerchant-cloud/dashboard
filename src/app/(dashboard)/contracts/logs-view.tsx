"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, ScrollText, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  DataTableShell,
} from "@/components/data-table-shell";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils-format";
import type { SheetLog, SheetLogFilters } from "@/lib/data/contracts";
import { logTypeMeta, type LogTypeKey } from "./log-type-meta";

const LOG_TYPE_OPTIONS: Array<{ raw: string; key: LogTypeKey }> = [
  { raw: "Contract Close (Lost)", key: "lost" },
  { raw: "Contract Close (Renew)", key: "renew" },
  { raw: "ON HOLD", key: "hold" },
  { raw: "HOLD LIFTED", key: "holdLifted" },
  { raw: "EDIT MODE ON", key: "editOn" },
  { raw: "EDIT MODE OFF", key: "editOff" },
];

const KNOWN_KEYS = new Set<LogTypeKey>(
  LOG_TYPE_OPTIONS.map((option) => option.key),
);

export function LogsView({
  rows,
  managers,
  filters,
}: {
  rows: SheetLog[];
  managers: string[];
  filters: SheetLogFilters;
}) {
  const t = useTranslations("ContractsPage");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedTypes = new Set(filters.logTypes ?? []);

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("view", "logs");
    mutate(next);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const setParam = (key: string, value: string) => {
    pushParams((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
  };

  // Search runs through local state + debounce so the controlled input keeps
  // focus / cursor position instead of remounting on every server round-trip.
  const [searchValue, setSearchValue] = useState(filters.search ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-sync when the URL changes from elsewhere (chips, clear, manager…).
  useEffect(() => {
    setSearchValue(filters.search ?? "");
  }, [filters.search]);
  const onSearchChange = (value: string) => {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setParam("q", value.trim());
    }, 350);
  };
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const toggleType = (raw: string) => {
    const nextTypes = new Set(selectedTypes);
    if (nextTypes.has(raw)) nextTypes.delete(raw);
    else nextTypes.add(raw);
    pushParams((next) => {
      const values = Array.from(nextTypes);
      if (values.length > 0) next.set("logType", values.join(","));
      else next.delete("logType");
    });
  };

  const clearFilters = () => {
    router.push(`${pathname}?view=logs`);
  };

  const labelFor = (raw: string) => {
    const meta = logTypeMeta(raw);
    if (KNOWN_KEYS.has(meta.key as LogTypeKey)) {
      return t(`logs.types.${meta.key}` as `logs.types.${LogTypeKey}`);
    }
    return raw;
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-soft bg-card p-4 shadow-[var(--surface-elev)]">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">{t("logs.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("logs.description")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setParam("logType", "")}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors",
              selectedTypes.size === 0
                ? "border-cyan/35 bg-cyan-dim text-cyan"
                : "border-soft bg-background/40 text-muted-foreground hover:text-foreground",
            )}
          >
            {t("logs.filters.allTypes")}
          </button>
          {LOG_TYPE_OPTIONS.map((option) => {
            const meta = logTypeMeta(option.raw);
            const selected = selectedTypes.has(option.raw);
            return (
              <button
                key={option.raw}
                type="button"
                onClick={() => toggleType(option.raw)}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors",
                  selected
                    ? meta.badge
                    : `${meta.badge} opacity-60 hover:opacity-100`,
                )}
              >
                {t(`logs.types.${option.key}` as `logs.types.${LogTypeKey}`)}
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(160px,220px)_minmax(220px,1fr)_repeat(2,minmax(140px,160px))_auto] md:items-end">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("logs.filters.manager")}
            </span>
            <select
              value={filters.accountManager ?? ""}
              onChange={(event) => setParam("am", event.target.value)}
              className="h-9 w-full rounded-[var(--radius-md)] border border-soft bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-cyan/50"
            >
              <option value="">{t("logs.filters.allManagers")}</option>
              {managers.map((manager) => (
                <option key={manager} value={manager}>
                  {manager}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("logs.filters.search")}
            </span>
            <span className="relative block">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={t("logs.filters.searchPlaceholder")}
                className="h-9 w-full rounded-[var(--radius-md)] border border-soft bg-background px-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-cyan/50"
              />
            </span>
          </label>

          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("logs.filters.from")}
            </span>
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(event) => setParam("from", event.target.value)}
              className="h-9 w-full rounded-[var(--radius-md)] border border-soft bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-cyan/50"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("logs.filters.to")}
            </span>
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(event) => setParam("to", event.target.value)}
              className="h-9 w-full rounded-[var(--radius-md)] border border-soft bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-cyan/50"
            />
          </label>

          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-soft bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-cyan/35 hover:text-foreground"
          >
            <X className="size-3.5" />
            {t("logs.filters.clear")}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="size-6" />}
          title={t("logs.empty")}
          description={t("logs.description")}
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>{t("logs.columns.time")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("logs.columns.type")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("logs.columns.client")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("logs.columns.manager")}</DataTableHeaderCell>
                <DataTableHeaderCell className="min-w-[280px]">
                  {t("logs.columns.notes")}
                </DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {rows.map((row) => {
                const meta = logTypeMeta(row.log_type);
                const clientLabel =
                  row.client_name ?? row.client_external_id ?? row.contract_key;
                return (
                  <DataTableRow key={row.id}>
                    <DataTableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(row.log_time, locale)}
                    </DataTableCell>
                    <DataTableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium",
                          meta.badge,
                        )}
                      >
                        {labelFor(row.log_type)}
                      </span>
                    </DataTableCell>
                    <DataTableCell className="min-w-[180px]">
                      {row.contract_id ? (
                        <Link
                          href={`/contracts/${row.contract_id}`}
                          className="text-sm font-medium text-cyan hover:underline"
                        >
                          {clientLabel}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium">{clientLabel}</span>
                      )}
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {row.contract_key}
                      </div>
                    </DataTableCell>
                    <DataTableCell className="text-sm text-muted-foreground">
                      {row.account_manager ?? "—"}
                    </DataTableCell>
                    <DataTableCell className="max-w-[520px] whitespace-pre-wrap break-words text-sm text-muted-foreground [unicode-bidi:plaintext]">
                      {row.notes ?? "—"}
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </tbody>
          </DataTable>
        </DataTableShell>
      )}
    </section>
  );
}
