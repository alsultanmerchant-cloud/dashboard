"use client";

// Sky Light feedback #3 (PR-F): a tiny "where did this row come from" badge.
//
// Rows synced from the customised Odoo deployment carry external_source =
// 'odoo'. Rows created inside this dashboard have external_source = null.
// Per the locked PR-F decision we render a pill ONLY for Odoo-synced rows
// ("أودو") and render NOTHING for dashboard-created rows — the absence of a
// pill is itself the signal.

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function OriginBadge({
  source,
  className,
}: {
  /** The row's `external_source` column. "odoo" → pill; anything else → null. */
  source: string | null | undefined;
  className?: string;
}) {
  const t = useTranslations("OriginBadge");

  // Dashboard-created rows get no pill (decision Q3).
  if (source !== "odoo") return null;

  return (
    <span
      title={t("odooTooltip")}
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-full border border-cyan/30 bg-cyan-dim px-1.5 text-[10px] font-semibold leading-none tracking-tight text-cyan",
        className,
      )}
    >
      {t("odoo")}
    </span>
  );
}
