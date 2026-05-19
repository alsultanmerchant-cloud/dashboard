"use client";

// Per-stage owner editor for a single task (migration 0077). Mirrors the
// template-side StageOwnerEditor but writes to tasks.stage_owner_positions
// so a manager can override the responsible role for each of the 8 stages
// on one task without touching the originating template.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, Users } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updateTaskStageOwnerPositionsAction } from "./_assignee_actions";

const STAGES: { key: string; label: string; tone: string }[] = [
  { key: "new",               label: "جديدة",          tone: "bg-slate-500/15 text-slate-300" },
  { key: "in_progress",       label: "قيد التنفيذ",    tone: "bg-blue-500/15 text-blue-300" },
  { key: "manager_review",    label: "مراجعة المدير",  tone: "bg-amber-500/15 text-amber-300" },
  { key: "specialist_review", label: "مراجعة المتخصص", tone: "bg-purple-500/15 text-purple-300" },
  { key: "ready_to_send",     label: "جاهزة للإرسال",  tone: "bg-emerald-500/15 text-emerald-300" },
  { key: "sent_to_client",    label: "أرسلت للعميل",   tone: "bg-cyan-500/15 text-cyan-300" },
  { key: "client_changes",    label: "تعديلات العميل", tone: "bg-pink-500/15 text-pink-300" },
  { key: "done",              label: "مكتملة",         tone: "bg-zinc-500/15 text-zinc-300" },
];

export function TaskStageOwnerEditor({
  taskId,
  initial,
  positions,
}: {
  taskId: string;
  initial: Record<string, string | null> | null;
  positions: { slug: string; name: string }[];
}) {
  const roleOptions = [
    { key: "", label: "— لا يوجد —" },
    ...positions.map((p) => ({ key: p.slug, label: p.name })),
  ];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, string | null>>(() => {
    const seed = initial ?? {};
    const out: Record<string, string | null> = {};
    for (const s of STAGES) out[s.key] = (seed[s.key] as string | null) ?? null;
    return out;
  });

  const baseline = STAGES.reduce<Record<string, string | null>>((acc, s) => {
    acc[s.key] = ((initial ?? {})[s.key] as string | null) ?? null;
    return acc;
  }, {});
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  const submit = () => {
    start(async () => {
      const res = await updateTaskStageOwnerPositionsAction({ taskId, mapping: draft });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم تحديث مالك كل مرحلة");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex items-center gap-1.5 rounded-md border border-soft bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-soft-1 hover:text-foreground"
      >
        <Users className="size-3.5" />
        مالك كل مرحلة
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-3">
        <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
          الدور المسؤول عن كل مرحلة
          <span className="ms-1 text-muted-foreground/70">
            (يُحوَّل تلقائيًا للموظف الذي يحمل هذا الدور في المهمة)
          </span>
        </div>
        <div className="space-y-1.5">
          {STAGES.map((s) => (
            <div key={s.key} className="grid grid-cols-[1fr_auto] items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium text-start", s.tone)}>
                {s.label}
              </span>
              <select
                value={draft[s.key] ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [s.key]: e.target.value || null }))
                }
                className="rounded-md border border-input bg-input px-2 py-1 text-xs"
                disabled={pending}
              >
                {roleOptions.map((r) => (
                  <option key={r.key || "none"} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            إلغاء
          </Button>
          <Button type="button" size="sm" onClick={submit} disabled={pending || !dirty}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            حفظ
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
