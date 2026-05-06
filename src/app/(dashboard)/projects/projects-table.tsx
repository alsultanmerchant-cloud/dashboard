"use client";

// Rwasem-style list view: dense table with the same columns Odoo shows
// in the project list — name, ref, store name, client, dates, account
// manager, project manager, task count.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Star } from "lucide-react";
import type { LiveProject } from "@/lib/odoo/live";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const ODOO_COLORS = [
  "#9c9c9c", "#d44d4d", "#dfb700", "#3597d3", "#5b8a72",
  "#9b59b6", "#e63946", "#2a9d8f", "#264653", "#f4a261",
  "#28a745", "#5241c3",
];

function odooColor(i: number): string {
  return ODOO_COLORS[i % ODOO_COLORS.length] ?? ODOO_COLORS[11];
}

function formatOdooDate(iso: string | null): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return "—";
  return `${d[1]}/${d[2]}/${d[0]}`;
}

function Initial({
  name,
  avatarUrl,
  color,
}: {
  name: string;
  avatarUrl?: string | null;
  color: string;
}) {
  return (
    <Avatar size="sm" className="size-5 shrink-0">
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
      <AvatarFallback
        className="text-[9px]"
        style={{ backgroundColor: color, color: "#fff" }}
      >
        {name.trim()[0] ?? "?"}
      </AvatarFallback>
    </Avatar>
  );
}

export function ProjectsTable({ items }: { items: LiveProject[] }) {
  const t = useTranslations("ProjectCard");
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="w-8 px-2 py-2"></th>
            <th className="px-2 py-2 text-start font-semibold">{t("client")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("ref")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("storeName")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("client")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("startDate")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("endDate")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("projectManager")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("accountManager")}</th>
            <th className="px-2 py-2 text-end font-semibold">{t("tasks")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((p) => {
            const stripe = odooColor(p.color || 11);
            return (
              <tr key={p.odooId || p.ref} className="group hover:bg-muted/40">
                <td className="px-2 py-2 align-middle">
                  <Star
                    className={cn(
                      "size-3.5",
                      p.isFavorite ? "fill-amber-400 text-amber-500" : "text-muted-foreground/60",
                    )}
                  />
                </td>
                <td className="px-2 py-2 align-middle">
                  <Link
                    href={`/projects/odoo/${p.odooId}`}
                    className="flex items-center gap-2 text-foreground hover:text-primary"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-4 w-1 shrink-0 rounded-sm"
                      style={{ backgroundColor: stripe }}
                    />
                    <span className="truncate font-medium">{p.name}</span>
                  </Link>
                </td>
                <td className="px-2 py-2 align-middle tabular-nums text-muted-foreground">
                  {p.ref}
                </td>
                <td className="px-2 py-2 align-middle">
                  <span className="block max-w-[18ch] truncate text-foreground/80">
                    {p.storeName ?? p.clientName ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-2 align-middle">
                  <span className="block max-w-[18ch] truncate text-foreground/80">
                    {p.clientName ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-2 align-middle tabular-nums text-foreground/80" dir="ltr">
                  {formatOdooDate(p.startDate)}
                </td>
                <td className="px-2 py-2 align-middle tabular-nums text-foreground/80" dir="ltr">
                  {formatOdooDate(p.endDate)}
                </td>
                <td className="px-2 py-2 align-middle">
                  {p.managerName ? (
                    <div className="flex items-center gap-1.5">
                      <Initial
                        name={p.managerName}
                        avatarUrl={p.managerAvatarUrl}
                        color={stripe}
                      />
                      <span className="truncate">{p.managerName}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-2 align-middle">
                  {p.accountManagerName ? (
                    <div className="flex items-center gap-1.5">
                      <Initial
                        name={p.accountManagerName}
                        avatarUrl={p.accountManagerAvatarUrl}
                        color={stripe}
                      />
                      <span className="truncate">{p.accountManagerName}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-end align-middle tabular-nums font-semibold text-primary">
                  {p.taskCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
