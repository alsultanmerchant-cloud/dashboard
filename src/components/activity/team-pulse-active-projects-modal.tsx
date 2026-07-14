"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, FolderKanban, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { EmployeeActiveProjectRow } from "@/lib/data/team-pulse";
import { cn } from "@/lib/utils";

export function TeamPulseActiveProjectsModal({
  employeeId,
  fullName,
  activeProjects,
  overloaded,
}: {
  employeeId: string;
  fullName: string;
  activeProjects: number;
  overloaded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EmployeeActiveProjectRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRows() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/team-activity/active-projects?emp=${encodeURIComponent(employeeId)}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { rows: EmployeeActiveProjectRow[] };
      setRows(body.rows);
    } catch {
      setError("تعذّر تحميل المشاريع. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && rows === null && !loading) void loadRows();
  }

  if (activeProjects === 0) return <span className="text-muted-foreground">0</span>;
  const displayedCount = rows?.length ?? activeProjects;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`عرض ${activeProjects} مشاريع نشطة لدى ${fullName}`}
            className={cn(
              "rounded-md px-2 py-1 font-semibold tabular-nums transition-colors hover:bg-cyan/10 hover:text-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan",
              overloaded ? "text-cc-red" : "text-foreground",
            )}
          />
        }
      >
        {activeProjects}
      </DialogTrigger>

      <DialogContent className="sm:w-[min(92vw,52rem)] sm:max-w-4xl">
        <DialogHeader className="pe-9 text-right">
          <DialogTitle className="inline-flex items-center gap-2">
            <FolderKanban className="size-4 text-cyan" aria-hidden="true" />
            المشاريع النشطة — {fullName}
          </DialogTitle>
          <DialogDescription>
            {displayedCount} مشاريع نشطة لديه فيها مهمة مفتوحة واحدة على الأقل بصفته منفّذًا.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            جارٍ تحميل المشاريع…
          </div>
        ) : error ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center" aria-live="polite">
            <p className="text-sm text-cc-red">{error}</p>
            <button
              type="button"
              onClick={() => void loadRows()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-soft-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              إعادة المحاولة
            </button>
          </div>
        ) : rows && rows.length > 0 ? (
          <div className="max-h-[60svh] overflow-auto rounded-xl border border-border">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-[10px] text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">المشروع</th>
                  <th className="px-3 py-2.5 text-center font-medium">مهامه المفتوحة</th>
                  <th className="px-3 py-2.5 font-medium"><span className="sr-only">فتح المشروع</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((project) => (
                  <tr key={project.projectId} className="border-b border-border/50 hover:bg-soft-1">
                    <td className="max-w-xl px-3 py-3">
                      <Link
                        href={`/projects/${project.projectId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate font-medium hover:text-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                      >
                        {project.projectCode ? `${project.projectCode} · ` : ""}{project.projectName}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-center font-semibold tabular-nums">
                      {project.openAssignedTasks}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/projects/${project.projectId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`فتح المشروع ${project.projectName}`}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-cyan hover:bg-soft-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground" aria-live="polite">
            لا توجد مشاريع نشطة حاليًا.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
