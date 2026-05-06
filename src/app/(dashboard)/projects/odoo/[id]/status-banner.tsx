"use client";

// Rwasem-style "Update Project" banner. Mirrors Odoo's project header form
// where a lead picks a status (on track / at risk / off track / done) and
// posts a short note. Each post is appended to the Updates feed via
// postProjectStatusUpdateAction.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, AlertOctagon, Flag, Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { postProjectStatusUpdateAction, type StatusValue } from "./_status-actions";

const STATUS_META: Record<
  StatusValue,
  { label: string; icon: React.ReactNode; tone: string; ring: string }
> = {
  on_track: {
    label: "On Track",
    icon: <CheckCircle2 className="size-4" />,
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-500/30",
  },
  at_risk: {
    label: "At Risk",
    icon: <AlertTriangle className="size-4" />,
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    ring: "ring-amber-500/30",
  },
  off_track: {
    label: "Off Track",
    icon: <AlertOctagon className="size-4" />,
    tone: "bg-red-500/15 text-red-700 dark:text-red-300",
    ring: "ring-red-500/30",
  },
  done: {
    label: "Done",
    icon: <Flag className="size-4" />,
    tone: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-600/30",
  },
};

const ORDER: StatusValue[] = ["on_track", "at_risk", "off_track", "done"];

export function StatusBanner({
  projectId,
  currentStatus,
}: {
  projectId: string | null;
  currentStatus: StatusValue | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<StatusValue>(currentStatus ?? "on_track");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  // No Supabase mirror → can't post updates yet. Render a read-only chip.
  if (!projectId) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
        <Flag className="size-3.5" />
        التحديثات غير متاحة — هذا المشروع لم يتم استيراده بعد إلى قاعدة البيانات.
      </div>
    );
  }

  const meta = currentStatus ? STATUS_META[currentStatus] : null;

  function submit() {
    startTransition(async () => {
      const res = await postProjectStatusUpdateAction({
        projectId: projectId!,
        status,
        note,
      });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success("تم تحديث الحالة");
        setEditing(false);
        setNote("");
        router.refresh();
      }
    });
  }

  if (!editing) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm",
          meta ? `border-transparent ring-1 ${meta.ring}` : "border-border",
        )}
      >
        <div className="flex items-center gap-2">
          {meta ? (
            <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold", meta.tone)}>
              {meta.icon}
              {meta.label}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[12px] text-muted-foreground">
              <Flag className="size-3.5" />
              لا توجد حالة
            </span>
          )}
          <span className="text-[12px] text-muted-foreground">آخر تحديث للمشروع</span>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Pencil className="size-3" />
          نشر تحديث
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-sm">
      {/* Status picker */}
      <div className="flex flex-wrap gap-1.5">
        {ORDER.map((s) => {
          const m = STATUS_META[s];
          const active = s === status;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-all",
                active ? `${m.tone} ring-1 ${m.ring}` : "bg-muted/50 text-muted-foreground hover:bg-muted",
              )}
            >
              {m.icon}
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Note */}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="اكتب ملاحظة قصيرة (اختياري)…"
        rows={2}
        maxLength={1000}
        className="w-full resize-none rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
      />

      {/* Actions */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {note.length} / 1000
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setNote("");
              setStatus(currentStatus ?? "on_track");
            }}
            disabled={isPending}
            className="rounded-md border border-border px-2.5 py-1 text-[12px] hover:bg-muted disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="size-3 animate-spin" />}
            نشر
          </button>
        </div>
      </div>
    </div>
  );
}
