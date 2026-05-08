"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Settings2, Check } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updateStageOwnerPositionsAction } from "./_actions";

const STAGES: { key: string; label: string; tone: string }[] = [
  { key: "new",                label: "جديدة",            tone: "bg-slate-500/15 text-slate-300" },
  { key: "in_progress",        label: "قيد التنفيذ",      tone: "bg-blue-500/15 text-blue-300" },
  { key: "manager_review",     label: "مراجعة المدير",    tone: "bg-amber-500/15 text-amber-300" },
  { key: "specialist_review",  label: "مراجعة المتخصص",   tone: "bg-purple-500/15 text-purple-300" },
  { key: "ready_to_send",      label: "جاهزة للإرسال",    tone: "bg-emerald-500/15 text-emerald-300" },
  { key: "sent_to_client",     label: "أرسلت للعميل",     tone: "bg-cyan-500/15 text-cyan-300" },
  { key: "client_changes",     label: "تعديلات العميل",   tone: "bg-pink-500/15 text-pink-300" },
  { key: "done",               label: "مكتملة",           tone: "bg-zinc-500/15 text-zinc-300" },
];

const ROLE_OPTIONS: { key: string; label: string }[] = [
  { key: "",                 label: "— لا يوجد —" },
  { key: "specialist",       label: "المتخصص" },
  { key: "manager",          label: "مدير القسم" },
  { key: "agent",            label: "المنفذ" },
  { key: "account_manager",  label: "مدير الحساب" },
  { key: "supporting_lead",  label: "قائد القسم المساند" },
  { key: "supporting_agent", label: "منفذ القسم المساند" },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.filter((r) => r.key).map((r) => [r.key, r.label]),
);

export function StageOwnerEditor({
  itemId,
  initial,
}: {
  itemId: string;
  initial: Record<string, string | null> | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, string | null>>(() => {
    const seed = initial ?? {};
    const out: Record<string, string | null> = {};
    for (const s of STAGES) out[s.key] = (seed[s.key] as string | null) ?? null;
    return out;
  });

  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(
      STAGES.reduce<Record<string, string | null>>((acc, s) => {
        acc[s.key] = ((initial ?? {})[s.key] as string | null) ?? null;
        return acc;
      }, {}),
    );

  const submit = () => {
    start(async () => {
      const res = await updateStageOwnerPositionsAction({ itemId, mapping: draft });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("تم تحديث ملاك المراحل");
      setOpen(false);
      router.refresh();
    });
  };

  // Compact preview chips (rendered inside the trigger).
  const setStages = STAGES.filter((s) => draft[s.key]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-soft bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-soft-1 hover:text-foreground",
          setStages.length > 0 && "text-foreground",
        )}
      >
        <Settings2 className="size-3.5" />
        {setStages.length > 0
          ? `${setStages.length}/${STAGES.length} مرحلة`
          : "تخصيص المالك"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-3">
        <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
          مالك كل مرحلة
          <span className="ms-1 text-muted-foreground/70">(يُحوَّل تلقائيًا للموظف الذي يحمل هذا الدور في المهمة)</span>
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
              >
                {ROLE_OPTIONS.map((r) => (
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
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={pending || !dirty}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            حفظ
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

