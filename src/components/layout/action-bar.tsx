"use client";

// Rwasem/Odoo-style action bar for detail pages (§NAV-1, §PROJ-INFO-2,
// §TASK-INFO-3). One compact row, ≤56 px tall, that replaces the tall
// per-page banner. Layout, top → bottom:
//
//   [New] · Module › <name> · <gear>     [smart-pills]      [n/N < >]
//
// Smart-button pills mirror Odoo's "stat buttons" — clickable counts that
// jump to the related list (Tasks, Collaborators, Documents) or render a
// status chip.

import Link from "next/link";
import { ChevronRight, Plus, Settings2 } from "lucide-react";
import { RecordPagination, type RecordKind } from "./record-pagination";
import { cn } from "@/lib/utils";

export type SmartPill = {
  /** Stable key for React. */
  key: string;
  /** Label rendered above the value (small, uppercase). */
  label: string;
  /** Numeric value or chip content (e.g. "12" or a badge node). */
  value: React.ReactNode;
  /** Optional inline icon to the left of the label. */
  icon?: React.ReactNode;
  /** Pill becomes a link to this URL. Omit for non-interactive pills. */
  href?: string;
  /** Pill becomes a button that fires this handler (e.g. to open a sheet). */
  onClick?: () => void;
};

export function ActionBar({
  newHref,
  moduleLabel,
  moduleHref,
  recordName,
  recordCode,
  recordId,
  recordKind,
  rightActions,
  smartPills,
  settingsActions,
}: {
  /** "New" button href — the module's create surface (e.g. /projects/new). */
  newHref?: string;
  /** Breadcrumb root label ("Projects", "Tasks"). */
  moduleLabel: string;
  /** Href the module label links to. */
  moduleHref: string;
  /** Record title displayed after the chevron. */
  recordName: string;
  /** Optional short code shown before the name, e.g. "PRJ-01539". */
  recordCode?: string | null;
  /** Record UUID — used by the pagination chip to look up siblings. */
  recordId: string;
  /** Kind of record, used by RecordPagination to read the right list. */
  recordKind: RecordKind;
  /** Extra cluster shown next to the gear (e.g. hold dialog, gantt link). */
  rightActions?: React.ReactNode;
  /** Smart-button pills rendered between the breadcrumb and pagination. */
  smartPills?: SmartPill[];
  /** Slot for the gear/cog menu contents (rendered inside the chip). */
  settingsActions?: React.ReactNode;
}) {
  return (
    <header
      className="sticky top-[136px] z-20 -mx-3 mb-4 border-b border-border bg-card/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:-mx-6 sm:px-6"
      aria-label={moduleLabel}
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {/* Left cluster — [New] · Module › name · gear */}
        <div className="flex min-w-0 items-center gap-1.5 rtl:flex-row-reverse">
          {newHref && (
            <Link
              href={newHref}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="size-3.5" />
              <span>New</span>
            </Link>
          )}
          <Link
            href={moduleHref}
            className="shrink-0 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            {moduleLabel}
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-foreground">
            {recordCode && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {recordCode}
              </span>
            )}
            <span className="truncate">{recordName}</span>
          </span>
          {settingsActions ?? (
            <button
              type="button"
              aria-label="Settings"
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings2 className="size-3.5" />
            </button>
          )}
        </div>

        {/* Center cluster — smart-button stat pills. Stays tight after the
            breadcrumb (no flex-1/justify-center) so individual pills don't
            wrap onto their own line; the whole row uses flex-wrap so the
            right cluster moves down when truly out of room. */}
        {smartPills && smartPills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {smartPills.map((pill) => (
              <SmartPillChip key={pill.key} pill={pill} />
            ))}
          </div>
        )}

        {/* Right cluster — extra page actions + pagination */}
        <div className="ms-auto flex shrink-0 items-center gap-1.5 rtl:flex-row-reverse">
          {rightActions}
          <RecordPagination kind={recordKind} recordId={recordId} />
        </div>
      </div>
    </header>
  );
}

function SmartPillChip({ pill }: { pill: SmartPill }) {
  const interactive = Boolean(pill.href || pill.onClick);
  const inner = (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-start transition-colors",
        interactive && "hover:bg-muted hover:border-primary/40",
      )}
    >
      {pill.icon && (
        <span className="shrink-0 text-primary">{pill.icon}</span>
      )}
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {pill.label}
      </span>
      <span className="text-[12px] font-semibold text-foreground">
        {pill.value}
      </span>
    </span>
  );
  if (pill.onClick) {
    return (
      <button type="button" onClick={pill.onClick} className="inline-flex">
        {inner}
      </button>
    );
  }
  if (pill.href) {
    return (
      <Link href={pill.href} className="inline-flex">
        {inner}
      </Link>
    );
  }
  return inner;
}
