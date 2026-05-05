// Rwasem-style project kanban card.
// Mirrors the layout captured from skylight.rwasem.com — left color stripe,
// favorite star, project name + ref, account manager line, progress bar,
// service tag chips, key-value detail rows, footer with task count + status.

import Link from "next/link";
import { Star, MoreVertical, User, Hash, Timer, Clock, ArrowRight } from "lucide-react";
import type { LiveProject } from "@/lib/odoo/live";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { formatArabicShortDate } from "@/lib/utils-format";

// Mirror Odoo's US-format display in the date-range header (10/23/2025).
function formatOdooDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return iso;
  return `${d[1]}/${d[2]}/${d[0]}`;
}

// Rwasem `target` selection → Arabic label + tone.
const TARGET_LABEL: Record<NonNullable<LiveProject["target"]>, { label: string; tone: string }> = {
  on_target: { label: "On Target", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  off_target: { label: "Off Target", tone: "bg-red-500/15 text-red-700 dark:text-red-300" },
  out: { label: "Out", tone: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300" },
  sales_deposit: { label: "Sales Deposit", tone: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  renewed: { label: "Renewed", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
};

// Odoo color index → CSS color (matches Odoo's stage/tag palette).
const ODOO_COLORS = [
  "#9c9c9c", // 0 muted gray
  "#d44d4d", // 1 red
  "#dfb700", // 2 orange
  "#3597d3", // 3 light blue
  "#5b8a72", // 4 olive green
  "#9b59b6", // 5 purple
  "#e63946", // 6 raspberry
  "#2a9d8f", // 7 teal
  "#264653", // 8 dark teal
  "#f4a261", // 9 sand
  "#28a745", // 10 green
  "#5241c3", // 11 brand violet
];

function odooColor(i: number): string {
  return ODOO_COLORS[i % ODOO_COLORS.length] ?? ODOO_COLORS[0];
}

// Progress: closed/total. If we have no tasks at all show 0.
function progressOf(p: LiveProject): number {
  if (p.taskCount <= 0) return 0;
  return Math.round((p.closedTaskCount / p.taskCount) * 100);
}

export function ProjectCard({ project: p }: { project: LiveProject }) {
  const progress = progressOf(p);
  const stripe = odooColor(p.color || 11);

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border bg-card",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.06)]",
        "transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.08),0_4px_16px_rgba(0,0,0,0.06)]",
      )}
    >
      {/* Left color stripe (Odoo project.color) */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-0 w-1.5"
        style={{ backgroundColor: stripe }}
      />

      {/* Stretched link: clicking anywhere on the card opens the project
          detail page (matches Odoo tile behavior). Inner buttons/links
          opt back in via z-index + relative positioning. */}
      <Link
        href={`/projects/odoo/${p.odooId}`}
        aria-label={p.name}
        className="absolute inset-0 z-0"
      />

      <div className="relative z-10 ps-4 pe-3 pt-3 pb-2.5">
        {/* Title row: star · name · kebab */}
        <div className="flex items-start gap-2">
          <button
            type="button"
            className={cn(
              "relative z-10 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-amber-500",
              p.isFavorite && "text-amber-500",
            )}
            aria-label={p.isFavorite ? "إزالة من المفضلة" : "إضافة للمفضلة"}
            title={p.isFavorite ? "مفضّل" : "إضافة للمفضلة"}
          >
            <Star
              className={cn("size-4", p.isFavorite && "fill-amber-400")}
            />
          </button>

          <span
            className="min-w-0 flex-1 truncate text-[15px] font-bold leading-snug text-foreground group-hover:text-primary"
            title={p.name}
          >
            {p.name}
          </span>

          <button
            type="button"
            className="relative z-10 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="إجراءات"
            title="المزيد"
          >
            <MoreVertical className="size-4" />
          </button>
        </div>

        {/* Ref code */}
        <div className="mt-0.5 flex items-center gap-1 ps-6 text-[12px] tabular-nums text-muted-foreground">
          <Hash className="size-3" />
          <span>{p.ref}</span>
        </div>

        {/* Customer/manager line */}
        {(p.clientName || p.managerName) && (
          <div className="mt-0.5 flex items-center gap-1.5 ps-6 text-[12px] text-foreground/80">
            <User className="size-3" />
            <span className="truncate">{p.clientName ?? p.managerName}</span>
          </div>
        )}

        {/* Date range header (Odoo-style: 10/23/2025 → 05/04/2026) */}
        {(p.startDate || p.endDate) && (
          <div
            className="mt-1 flex items-center gap-1.5 ps-6 text-[11px] tabular-nums text-muted-foreground"
            dir="ltr"
          >
            <Clock className="size-3" />
            <span>{formatOdooDate(p.startDate) ?? "—"}</span>
            <ArrowRight className="size-3 shrink-0" />
            <span>{formatOdooDate(p.endDate) ?? "—"}</span>
          </div>
        )}

        {/* Stage / status / target badges (e.g. "Extra Focus", "On Track") */}
        {(p.stageName || p.lastUpdateStatus || p.target) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 ps-6">
            {p.stageName && (
              <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                {p.stageName}
              </span>
            )}
            {!p.stageName && p.lastUpdateStatus && (
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                  p.lastUpdateStatus === "on_track" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                  p.lastUpdateStatus === "at_risk" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                  p.lastUpdateStatus === "off_track" && "bg-red-500/15 text-red-700 dark:text-red-300",
                  p.lastUpdateStatus === "done" && "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300",
                )}
              >
                {p.lastUpdateStatus.replace(/_/g, " ")}
              </span>
            )}
            {p.target && (
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                  TARGET_LABEL[p.target].tone,
                )}
              >
                {TARGET_LABEL[p.target].label}
              </span>
            )}
          </div>
        )}

        {/* Progress */}
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {progress}% Complete
          </div>
        </div>

        {/* Tag chips (services) */}
        {p.tagNames.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {p.tagNames.map((name, idx) => (
              <li
                key={`${name}-${idx}`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground"
              >
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full"
                  style={{
                    backgroundColor: odooColor((idx % 11) + 1),
                  }}
                />
                <span className="max-w-[14ch] truncate">{name}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Key/value detail rows — Rwasem field grid (mirrors Odoo overview) */}
        <dl className="mt-2.5 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5 text-[12px]">
          <>
            <dt className="font-bold text-foreground">Store Name:</dt>
            <dd className="truncate text-foreground/80">
              {p.storeName ?? p.clientName ?? "—"}
            </dd>
          </>
          {p.startDate && (
            <>
              <dt className="font-bold text-foreground">Start:</dt>
              <dd className="tabular-nums text-foreground/80" dir="ltr">
                {formatArabicShortDate(p.startDate)}
              </dd>
            </>
          )}
          {p.endDate && (
            <>
              <dt className="font-bold text-foreground">End:</dt>
              <dd className="tabular-nums text-foreground/80" dir="ltr">
                {formatArabicShortDate(p.endDate)}
              </dd>
            </>
          )}
          <>
            <dt className="font-bold text-foreground">Site:</dt>
            <dd className="truncate text-muted-foreground">
              {p.siteAddress ?? "No address specified"}
            </dd>
          </>
          <>
            <dt className="font-bold text-foreground">Cost:</dt>
            <dd className="truncate text-muted-foreground">No costs</dd>
          </>
          <>
            <dt className="font-bold text-foreground">Project Manager:</dt>
            <dd className="truncate text-foreground/80">
              {p.managerName ?? "—"}
            </dd>
          </>
          <>
            <dt className="font-bold text-foreground">Account Manager:</dt>
            <dd className="truncate text-foreground/80">
              {p.accountManagerName ?? "—"}
            </dd>
          </>
        </dl>

        {/* Footer: task count · activity icon · avatar · status dot */}
        <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2">
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary group-hover:underline">
            {p.taskCount} {p.taskCount === 1 ? "مهمة" : "مهام"}
          </span>
          <Timer className="size-3.5 text-muted-foreground" aria-hidden />
          <div className="flex items-center gap-1.5">
            {p.managerName && (
              <Avatar size="sm" className="size-6">
                <AvatarFallback
                  className="text-[10px]"
                  style={{ backgroundColor: stripe, color: "#fff" }}
                >
                  {p.managerName.trim()[0] ?? "?"}
                </AvatarFallback>
              </Avatar>
            )}
            <span
              aria-hidden
              className={cn(
                "inline-block size-3 rounded-full ring-2 ring-card",
                p.lastUpdateStatus === "on_track" && "bg-emerald-500",
                p.lastUpdateStatus === "at_risk" && "bg-amber-500",
                p.lastUpdateStatus === "off_track" && "bg-red-500",
                p.lastUpdateStatus === "done" && "bg-emerald-600",
                !p.lastUpdateStatus && "bg-muted",
              )}
              title={p.lastUpdateStatus ?? "بدون حالة"}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
