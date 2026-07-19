"use client";

// Rwasem/Odoo-style list view. Column order mirrors Rwasem's list view per
// the §1 pixel-perfect mandate:
//   ★ · Project ID · Name · Customer · Project Manager · status dot · View Tasks
// followed by our dashboard extras (Store Name, Start, End, Account Manager).
// Keep this order aligned with the Odoo project list muscle memory.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, Star } from "lucide-react";
import type { LiveProject } from "@/lib/odoo/live";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ProjectFavoriteButton } from "@/components/projects/project-favorite-button";

// Status → small dot color. Keeps the list scannable without a full badge.
const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-500",
  on_track: "bg-emerald-500",
  at_risk: "bg-amber-500",
  off_track: "bg-rose-500",
  on_hold: "bg-slate-400",
  archived: "bg-slate-400",
  done: "bg-cyan-500",
};

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
            {/* Odoo columns, exact label + order (§PROJ-LIST-5). */}
            <th className="px-2 py-2 text-start font-semibold">{t("projectId")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("name")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("customer")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("projectManager")}</th>
            <th className="w-12 px-2 py-2 text-center font-semibold">{t("statusDot")}</th>
            <th className="w-24 px-2 py-2 text-center font-semibold">{t("viewTasks")}</th>
            {/* Dashboard extras — kept after the Odoo columns. */}
            <th className="px-2 py-2 text-start font-semibold">{t("storeName")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("startDate")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("endDate")}</th>
            <th className="px-2 py-2 text-start font-semibold">{t("accountManager")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((p) => {
            const stripe = odooColor(p.color || 11);
            const tasksHref = p.id ? `/tasks?projectId=${p.id}` : `/tasks?odooProjectId=${p.odooId}`;
            const projectHref = p.id ? `/projects/${p.id}` : tasksHref;
            const statusKey = (p as { status?: string | null }).status ?? "active";
            const dotCls = STATUS_DOT[statusKey] ?? "bg-slate-400";
            return (
              <tr key={p.id ?? `odoo-${p.odooId}`} className="group hover:bg-muted/40">
                <td className="px-2 py-2 align-middle">
                  {p.id ? (
                    <ProjectFavoriteButton
                      projectId={p.id}
                      initialFavorite={p.isFavorite}
                      size="sm"
                      className="align-middle"
                      iconClassName="size-3.5"
                      inactiveClassName="text-muted-foreground/60 hover:text-amber-500"
                    />
                  ) : (
                    <Star
                      className={cn(
                        "size-3.5",
                        p.isFavorite ? "fill-amber-400 text-amber-500" : "text-muted-foreground/60",
                      )}
                    />
                  )}
                </td>
                <td className="px-2 py-2 align-middle tabular-nums text-muted-foreground">
                  {p.ref}
                </td>
                <td className="px-2 py-2 align-middle">
                  <Link
                    href={projectHref}
                    className="flex items-center gap-2 text-foreground hover:text-primary"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-4 w-1 shrink-0 rounded-sm"
                      style={{ backgroundColor: stripe }}
                    />
                    <span className="truncate font-medium" data-private="client">{p.name}</span>
                  </Link>
                </td>
                <td className="px-2 py-2 align-middle">
                  <span className="block max-w-[18ch] truncate text-foreground/80" data-private="client">
                    {p.clientName ?? "—"}
                  </span>
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
                <td className="px-2 py-2 align-middle text-center">
                  <span
                    aria-label={statusKey}
                    title={statusKey}
                    className={cn("inline-block size-2.5 rounded-full", dotCls)}
                  />
                </td>
                <td className="px-2 py-2 align-middle text-center">
                  <Link
                    href={tasksHref}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
                  >
                    <span>{p.openTaskCount}</span>
                    <ArrowRight className="size-3 rtl:rotate-180" />
                  </Link>
                </td>
                <td className="px-2 py-2 align-middle">
                  <span className="block max-w-[18ch] truncate text-foreground/80">
                    {p.storeName ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-2 align-middle tabular-nums text-foreground/80" dir="ltr">
                  {formatOdooDate(p.startDate)}
                </td>
                <td className="px-2 py-2 align-middle tabular-nums text-foreground/80" dir="ltr">
                  {formatOdooDate(p.endDate)}
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
