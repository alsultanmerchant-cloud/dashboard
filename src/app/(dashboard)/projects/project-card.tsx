"use client";

// Rwasem-style project kanban card.
// Mirrors the layout captured from skylight.rwasem.com — left color stripe,
// favorite star, project name + ref, account manager line, progress bar,
// service tag chips, key-value detail rows, footer with task count + status.

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Star, MoreVertical, User, Hash, Timer, Info, ExternalLink, ListChecks } from "lucide-react";
import type { LiveProject } from "@/lib/odoo/live";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { OriginBadge } from "@/components/origin-badge";

// Rwasem prints datetimes as `MM/DD/YYYY HH:MM:SS`. Source values are
// either a date (`YYYY-MM-DD`) or a full ISO timestamp; both are normalised
// here so the Start/End rows match Odoo's display exactly.
function formatOdooDateTime(iso: string | null): string | null {
  if (!iso) return null;
  // Detect "YYYY-MM-DD" (no time component).
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const [datePart, timePartRaw] = iso.split(/[T\s]/);
  const dseg = datePart.split("-");
  if (dseg.length !== 3) return iso;
  const dateStr = `${dseg[1]}/${dseg[2]}/${dseg[0]}`;
  if (dateOnly || !timePartRaw) return dateStr;
  // Strip timezone / fractional seconds → "HH:MM:SS".
  const timeStr = timePartRaw.replace(/[Z+\-].*$/, "").slice(0, 8);
  return `${dateStr} ${timeStr}`;
}

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

function splitTagMarker(name: string): { marker: string | null; label: string } {
  const match = name.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}]+)\s*(.*)$/u);
  if (!match) return { marker: null, label: name };
  return {
    marker: match[1] ?? null,
    label: match[2] || name,
  };
}

// Progress: closed/total. If we have no tasks at all show 0.
function progressOf(p: LiveProject): number {
  if (p.taskCount <= 0) return 0;
  return Math.round((p.closedTaskCount / p.taskCount) * 100);
}

export function ProjectCard({ project: p }: { project: LiveProject }) {
  const router = useRouter();
  const t = useTranslations("ProjectCard");
  const progress = progressOf(p);
  const stripe = odooColor(p.color || 11);
  // Project entry should land on the scoped tasks view first. We still expose
  // project details from there via the "معلومات المشروع" action in /tasks.
  const href = p.id ? `/tasks?projectId=${p.id}` : `/tasks?odooProjectId=${p.odooId}`;
  const infoHref = p.id ? `/projects/${p.id}` : `/projects/odoo/${p.odooId}`;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(href); }}
      aria-label={p.name}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border bg-card",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.06)]",
        "transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.08),0_4px_16px_rgba(0,0,0,0.06)]",
        "cursor-pointer",
      )}
    >
      {/* Left color stripe (Odoo project.color) */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-0 w-1.5"
        style={{ backgroundColor: stripe }}
      />

      <div className="ps-4 pe-3 pt-3 pb-2.5">
        {/* Title row: star · name · kebab */}
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "relative shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-amber-500",
              p.isFavorite && "text-amber-500",
            )}
            aria-label={p.isFavorite ? "إزالة من المفضلة" : "إضافة للمفضلة"}
            title={p.isFavorite ? "مفضّل" : "إضافة للمفضلة"}
          >
            <Star
              className={cn("size-4", p.isFavorite && "fill-amber-400")}
            />
          </button>

          {/* Title is a real <Link> so cmd/ctrl/middle-click opens the project
              info page in a new tab — parity with the tasks list. stopPropagation
              keeps the parent <article onClick> from also firing router.push in
              the current tab when the user explicitly meant "new tab". */}
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 truncate text-[15px] font-bold leading-snug text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40 rounded"
            title={p.name}
          >
            {p.name}
          </Link>

          {/* PR-F (#3): origin badge — renders only for Odoo-synced projects. */}
          <OriginBadge source={p.externalSource} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="relative shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="إجراءات"
                title="المزيد"
              >
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(infoHref);
                }}
              >
                <Info className="size-4" />
                <span>معلومات المشروع</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(infoHref, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink className="size-4" />
                <span>فتح في تبويب جديد</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(href);
                }}
              >
                <ListChecks className="size-4" />
                <span>المهام</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

        {/* Progress */}
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t("completePercent", { percent: progress })}
          </div>
        </div>

        {/* Project tags (HOLD, Urgent, …) attached on the detail page.
            Rendered as colored pills above the service chips so they read as
            status markers (HOLD pops in red, Urgent in violet, …). */}
        {p.customTags && p.customTags.length > 0 && (
          <ul className="mt-2 flex flex-wrap items-center gap-1">
            {p.customTags.map((tag) => (
              <li
                key={tag.id}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                style={{ backgroundColor: odooColor(tag.color) }}
                title={tag.name}
              >
                {tag.name}
              </li>
            ))}
          </ul>
        )}

        {/* Service category chips — names already include the emoji prefix
            (e.g. "🟢Renewal Media Buying") so no extra color dot needed. */}
        {p.tagNames.length > 0 && (
          <ul className="mt-2 flex flex-col items-start gap-1">
            {p.tagNames.map((name, idx) => {
              const { marker, label } = splitTagMarker(name);
              return (
                <li
                  key={`${name}-${idx}`}
                  className="max-w-full rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-foreground"
                >
                  <span className="inline-flex items-start gap-1.5 whitespace-normal break-words">
                    {marker ? <span className="shrink-0 leading-none">{marker}</span> : null}
                    <span>{label}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* Key/value detail rows — Rwasem field grid (mirrors Odoo overview) */}
        <dl className="mt-2.5 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5 text-[12px]">
          <>
            <dt className="font-bold text-foreground">{t("storeName")}:</dt>
            <dd className="truncate text-foreground/80">
              {p.storeName ?? p.clientName ?? "—"}
            </dd>
          </>
          <>
            <dt className="font-bold text-foreground">{t("startDate")}:</dt>
            <dd className="tabular-nums text-foreground/80" dir="ltr">
              {formatOdooDateTime(p.startDate) ?? "—"}
            </dd>
          </>
          <>
            <dt className="font-bold text-foreground">{t("endDate")}:</dt>
            <dd className="tabular-nums text-foreground/80" dir="ltr">
              {formatOdooDateTime(p.endDate) ?? "—"}
            </dd>
          </>
          <>
            <dt className="font-bold text-foreground">{t("site")}:</dt>
            <dd className="truncate text-muted-foreground">
              {p.siteAddress ?? t("noAddress")}
            </dd>
          </>
          <>
            <dt className="font-bold text-foreground">{t("cost")}:</dt>
            <dd className="truncate text-muted-foreground">{t("noCosts")}</dd>
          </>
          <>
            <dt className="font-bold text-foreground">{t("projectManager")}:</dt>
            <dd className="truncate text-foreground/80">
              {p.managerName ?? "—"}
            </dd>
          </>
          <>
            <dt className="font-bold text-foreground">{t("accountManager")}:</dt>
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
            {/* Member avatars (Odoo favorite_user_ids). Falls back to PM-only
                when no members are synced. Caps at 3 visible + "+N" overflow. */}
            {(() => {
              const members = (p.members && p.members.length > 0)
                ? p.members
                : p.managerName
                  ? [{ name: p.managerName, avatarUrl: p.managerAvatarUrl ?? null }]
                  : [];
              const visible = members.slice(0, 3);
              const overflow = Math.max(0, members.length - visible.length);
              return (
                <div className="flex items-center">
                  {visible.map((m, i) => (
                    <Avatar
                      key={`${m.name}-${i}`}
                      size="sm"
                      className={cn("size-6 ring-2 ring-card", i > 0 && "-ms-2")}
                      title={m.name}
                    >
                      {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.name} />}
                      <AvatarFallback
                        className="text-[10px]"
                        style={{ backgroundColor: odooColor((p.color + i) || 11), color: "#fff" }}
                      >
                        {m.name.trim()[0] ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {overflow > 0 && (
                    <span
                      className="-ms-2 inline-flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold ring-2 ring-card"
                      title={`+${overflow}`}
                    >
                      +{overflow}
                    </span>
                  )}
                </div>
              );
            })()}
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
