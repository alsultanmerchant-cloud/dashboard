"use client";

import { useState, useTransition } from "react";
import { Loader2, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateSlaRulesAction } from "./_actions";
import type { SlaRuleRow } from "@/lib/data/sla";

// Agency-confirmed defaults from migration 0147 — the "reset" baseline.
const DEFAULTS: Record<string, number> = {
  client_changes: 480,
  specialist_review: 90,
  manager_review: 90,
  ready_to_send: 60,
  sent_to_client: 240,
};

interface DraftRule {
  stageKey: string;
  label: string;
  role: string;
  hint: string;
  maxMinutes: number;
  businessHoursOnly: boolean;
}

function fmtHours(min: number): string {
  if (!min || min <= 0) return "—";
  const h = min / 60;
  if (h < 1) return `${min} دقيقة`;
  return Number.isInteger(h) ? `${h} ساعة عمل` : `${h.toFixed(1)} ساعة عمل`;
}

export function SlaForm({ rows, canManage }: { rows: SlaRuleRow[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<DraftRule[]>(
    rows.map((r) => ({
      stageKey: r.stageKey,
      label: r.label,
      role: r.role,
      hint: r.hint,
      maxMinutes: r.maxMinutes ?? DEFAULTS[r.stageKey] ?? 60,
      businessHoursOnly: r.businessHoursOnly,
    })),
  );

  const initial = rows.map((r) => ({
    maxMinutes: r.maxMinutes ?? DEFAULTS[r.stageKey] ?? 60,
    businessHoursOnly: r.businessHoursOnly,
  }));
  const dirty = draft.some(
    (d, i) =>
      d.maxMinutes !== initial[i].maxMinutes ||
      d.businessHoursOnly !== initial[i].businessHoursOnly,
  );

  const setMinutes = (i: number, v: string) =>
    setDraft((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], maxMinutes: Math.max(0, parseInt(v, 10) || 0) };
      return next;
    });
  const toggleBh = (i: number) =>
    setDraft((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], businessHoursOnly: !next[i].businessHoursOnly };
      return next;
    });
  const resetOne = (i: number) =>
    setDraft((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], maxMinutes: DEFAULTS[next[i].stageKey] ?? next[i].maxMinutes };
      return next;
    });

  const onSave = () =>
    start(async () => {
      const bad = draft.find((d) => d.maxMinutes < 1 || d.maxMinutes > 10080);
      if (bad) {
        toast.error(`القيمة لمرحلة «${bad.label}» يجب أن تكون بين 1 و10080 دقيقة`);
        return;
      }
      const res = await updateSlaRulesAction({
        rules: draft.map((d) => ({
          stageKey: d.stageKey,
          maxMinutes: d.maxMinutes,
          businessHoursOnly: d.businessHoursOnly,
        })),
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `حُفظت معايير الالتزام. أُعيد احتساب ${res.refreshed} صفًا في بطاقات الأداء.`,
        { duration: 6000 },
      );
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {draft.map((d, i) => {
          const changed =
            d.maxMinutes !== initial[i].maxMinutes ||
            d.businessHoursOnly !== initial[i].businessHoursOnly;
          return (
            <div
              key={d.stageKey}
              className={cn(
                "rounded-xl border border-border bg-background p-3 sm:flex sm:items-center sm:justify-between sm:gap-4",
                changed && "border-cyan/40 bg-cyan/5",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{d.label}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {d.role}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{d.hint}</p>
              </div>

              <div className="mt-3 flex items-center gap-3 sm:mt-0 sm:shrink-0">
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={10080}
                    value={d.maxMinutes}
                    disabled={!canManage || pending}
                    onChange={(e) => setMinutes(i, e.target.value)}
                    className="w-20 text-center tabular-nums"
                    dir="ltr"
                  />
                  <span className="w-24 text-[11px] text-muted-foreground">
                    دقيقة
                    <span className="block tabular-nums">{fmtHours(d.maxMinutes)}</span>
                  </span>
                </div>

                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={d.businessHoursOnly}
                    disabled={!canManage || pending}
                    onChange={() => toggleBh(i)}
                    className="size-3.5 accent-cyan"
                  />
                  ساعات العمل فقط
                </label>

                {canManage && d.maxMinutes !== (DEFAULTS[d.stageKey] ?? d.maxMinutes) && (
                  <button
                    type="button"
                    onClick={() => resetOne(i)}
                    disabled={pending}
                    title="إعادة للقيمة الافتراضية"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canManage ? (
        <div className="flex items-center justify-end gap-3 pt-1">
          {dirty && <span className="text-[11px] text-amber">تغييرات غير محفوظة</span>}
          <Button onClick={onSave} disabled={!dirty || pending} className="gap-1.5">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            حفظ المعايير
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          عرض فقط — تحتاج صلاحية إدارة الإعدادات للتعديل.
        </p>
      )}
    </div>
  );
}
