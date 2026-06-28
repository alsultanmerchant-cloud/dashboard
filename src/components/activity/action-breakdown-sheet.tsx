"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ListChecks, Loader2, GitBranch, MessageSquare } from "lucide-react";
import { StackedSheet } from "@/components/ui/stacked-sheet";
import { cn } from "@/lib/utils";

interface ActionLogRow {
  taskId: string;
  taskCode: string | null;
  title: string;
  projectName: string | null;
  moves: number;
  notes: number;
  total: number;
  lastActionAt: string | null;
}

const WINDOWS = [
  { days: 7, label: "آخر ٧ أيام" },
  { days: 30, label: "آخر ٣٠ يوم" },
  { days: 90, label: "آخر ٣ أشهر" },
];

function relative(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "أمس";
  return `منذ ${days} يوم`;
}

// "تفاصيل الإجراءات" — a stacked sheet listing WHICH tasks/projects the
// person's Rwasem actions were on, with the stage-moves vs Log-Notes split.
// Makes the activity count concrete and auditable.
export function ActionBreakdownButton({
  employeeId,
  fullName,
  className,
}: {
  employeeId: string;
  fullName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<ActionLogRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setRows(null);
    fetch(`/api/team-activity/actions?emp=${employeeId}&days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { rows: ActionLogRow[] }) => {
        if (alive) setRows(d.rows);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, days, employeeId]);

  const totalActions = rows?.reduce((s, r) => s + r.total, 0) ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-soft-1",
          className,
        )}
      >
        <ListChecks className="size-3.5" />
        تفاصيل الإجراءات
      </button>

      <StackedSheet
        open={open}
        onOpenChange={setOpen}
        title={`تفاصيل نشاط ${fullName} في رواسم`}
        description="المهام التي قام عليها بإجراءات، والمشروع، وعدد الإجراءات (تحريك المراحل + ملاحظات العمل)."
      >
        {/* Window filter */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                days === w.days
                  ? "border-cyan bg-cyan/10 text-cyan"
                  : "border-border text-muted-foreground hover:bg-soft-1",
              )}
            >
              {w.label}
            </button>
          ))}
          {rows && rows.length > 0 && (
            <span className="ms-auto text-[11px] text-muted-foreground">
              {rows.length} مهمة · <span className="font-semibold text-foreground">{totalActions}</span>{" "}
              إجراء
            </span>
          )}
        </div>

        {loading && (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
        {error && (
          <div className="flex h-40 items-center justify-center text-sm text-cc-red">
            تعذّر التحميل: {error}
          </div>
        )}
        {rows && !loading && rows.length === 0 && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            لا توجد إجراءات في هذه الفترة.
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r) => (
              <div
                key={r.taskId}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/tasks/${r.taskId}`}
                    className="block truncate text-sm font-medium hover:text-cyan hover:underline"
                  >
                    {r.taskCode ? `${r.taskCode} · ` : ""}
                    {r.title}
                  </Link>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {r.projectName ?? "—"} · آخر إجراء {relative(r.lastActionAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
                  <span className="inline-flex items-center gap-1 text-muted-foreground" title="تحريك المراحل">
                    <GitBranch className="size-3.5" />
                    {r.moves}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground" title="ملاحظات العمل">
                    <MessageSquare className="size-3.5" />
                    {r.notes}
                  </span>
                  <span className="min-w-7 rounded-md bg-cyan/10 px-2 py-0.5 text-center font-bold text-cyan">
                    {r.total}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </StackedSheet>
    </>
  );
}
