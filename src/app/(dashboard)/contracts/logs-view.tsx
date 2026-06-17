"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUrlFilters } from "@/lib/use-url-filters";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils-format";
import type { SheetLog, SheetLogFilters } from "@/lib/data/contracts";
import { logTypeMeta, type LogTypeKey } from "./log-type-meta";
import { SheetLogNote } from "./sheet-log-note";

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
  // Shared URL-filter state. `view=logs` already lives in the URL on this tab,
  // so copying current params keeps it intact across every change.
  const { set, setDebounced, clear } = useUrlFilters();
  const selectedTypes = new Set(filters.logTypes ?? []);

  // Search keeps local state + debounce so the controlled input retains
  // focus / cursor position instead of remounting on every server round-trip.
  const propSearch = filters.search ?? "";
  const [searchDraft, setSearchDraft] = useState(() => ({
    value: propSearch,
    prop: propSearch,
  }));
  const searchValue =
    searchDraft.prop !== propSearch && searchDraft.value.trim() !== propSearch
      ? propSearch
      : searchDraft.value;

  const onSearchChange = (value: string) => {
    setSearchDraft({ value, prop: propSearch });
    setDebounced({ q: value.trim() });
  };

  const toggleType = (raw: string) => {
    const nextTypes = new Set(selectedTypes);
    if (nextTypes.has(raw)) nextTypes.delete(raw);
    else nextTypes.add(raw);
    const values = Array.from(nextTypes);
    set({ logType: values.length > 0 ? values.join(",") : null });
  };

  const hasActiveFilters =
    selectedTypes.size > 0 ||
    Boolean(filters.accountManager) ||
    Boolean(filters.search) ||
    Boolean(filters.from) ||
    Boolean(filters.to);

  const clearFilters = () => {
    setSearchDraft({ value: "", prop: propSearch });
    clear(["logType", "am", "q", "from", "to"]);
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
            onClick={() => set({ logType: null })}
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
            <Select
              value={filters.accountManager ?? "__all__"}
              onValueChange={(v) => set({ am: v === "__all__" ? null : v })}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue>
                  {(value: string) =>
                    value === "__all__" ? t("logs.filters.allManagers") : value
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} className="max-h-72">
                <SelectItem value="__all__">{t("logs.filters.allManagers")}</SelectItem>
                {managers.map((manager) => (
                  <SelectItem key={manager} value={manager}>
                    {manager}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("logs.filters.search")}
            </span>
            <span className="relative block">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                inputMode="search"
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={t("logs.filters.searchPlaceholder")}
                className="h-9 ps-9"
              />
            </span>
          </label>

          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("logs.filters.from")}
            </span>
            <Input
              type="date"
              value={filters.from ?? ""}
              onChange={(event) => set({ from: event.target.value })}
              className="h-9"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("logs.filters.to")}
            </span>
            <Input
              type="date"
              value={filters.to ?? ""}
              onChange={(event) => set({ to: event.target.value })}
              className="h-9"
            />
          </label>

          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-soft bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-cyan/35 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
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
                    <DataTableCell className="max-w-[560px] align-top">
                      <SheetLogNote
                        notes={row.notes}
                        wasLabel={t("logs.note.was")}
                        locale={locale}
                        compact
                        emptyLabel="—"
                      />
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
