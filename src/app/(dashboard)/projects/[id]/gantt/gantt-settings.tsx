"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { updateGanttPrefsAction } from "./_actions";

export type GanttPrefs = {
  show_today_line?: boolean;
  show_dependency_arrows?: boolean;
  show_weekend_shading?: boolean;
  weekend_days?: WeekDay[];
};

type WeekDay = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

const DAY_LABELS: Record<WeekDay, string> = {
  sat: "السبت",
  sun: "الأحد",
  mon: "الإثنين",
  tue: "الثلاثاء",
  wed: "الأربعاء",
  thu: "الخميس",
  fri: "الجمعة",
};

const DAY_ORDER: WeekDay[] = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];

export const DEFAULT_PREFS: Required<GanttPrefs> = {
  show_today_line: true,
  show_dependency_arrows: true,
  show_weekend_shading: true,
  weekend_days: ["fri", "sat"],
};

export function withDefaults(prefs: GanttPrefs | null | undefined): Required<GanttPrefs> {
  return {
    show_today_line: prefs?.show_today_line ?? DEFAULT_PREFS.show_today_line,
    show_dependency_arrows:
      prefs?.show_dependency_arrows ?? DEFAULT_PREFS.show_dependency_arrows,
    show_weekend_shading:
      prefs?.show_weekend_shading ?? DEFAULT_PREFS.show_weekend_shading,
    weekend_days: prefs?.weekend_days ?? DEFAULT_PREFS.weekend_days,
  };
}

export function GanttSettings({
  projectId,
  initialPrefs,
  canManage,
}: {
  projectId: string;
  initialPrefs: GanttPrefs;
  canManage: boolean;
}) {
  const [prefs, setPrefs] = useState<Required<GanttPrefs>>(withDefaults(initialPrefs));
  const [pending, start] = useTransition();

  function update<K extends keyof Required<GanttPrefs>>(key: K, value: Required<GanttPrefs>[K]) {
    setPrefs((p) => ({ ...p, [key]: value }));
  }

  function toggleDay(d: WeekDay) {
    setPrefs((p) => {
      const has = p.weekend_days.includes(d);
      const next = has ? p.weekend_days.filter((x) => x !== d) : [...p.weekend_days, d];
      return { ...p, weekend_days: next };
    });
  }

  function onSave() {
    start(async () => {
      const res = await updateGanttPrefsAction({ projectId, prefs });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success("تم حفظ الإعدادات.");
      }
    });
  }

  return (
    <div className="space-y-5 p-4">
      <ToggleRow
        id="today-line"
        label="إظهار خط اليوم"
        description="الخط الأحمر المتقطّع على عمود تاريخ اليوم."
        checked={prefs.show_today_line}
        onChange={(v) => update("show_today_line", v)}
        disabled={!canManage}
      />
      <ToggleRow
        id="dep-arrows"
        label="إظهار أسهم الترابط"
        description="أسهم FS / SS / FF / SF بين المهام المرتبطة."
        checked={prefs.show_dependency_arrows}
        onChange={(v) => update("show_dependency_arrows", v)}
        disabled={!canManage}
      />
      <ToggleRow
        id="weekend-shading"
        label="تظليل أيام العطلة"
        description="يلوّن أعمدة الأيام المختارة كأيام غير عملية."
        checked={prefs.show_weekend_shading}
        onChange={(v) => update("show_weekend_shading", v)}
        disabled={!canManage}
      />

      <div className="space-y-2">
        <Label className="text-sm font-medium">أيام العطلة</Label>
        <p className="text-xs text-muted-foreground">
          اختر الأيام التي تُعتبر غير عملية في هذا المشروع.
        </p>
        <div className="flex flex-wrap gap-2">
          {DAY_ORDER.map((d) => {
            const active = prefs.weekend_days.includes(d);
            return (
              <button
                key={d}
                type="button"
                disabled={!canManage || !prefs.show_weekend_shading}
                onClick={() => toggleDay(d)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "border-cyan/40 bg-cyan/15 text-cyan"
                    : "border-soft text-muted-foreground hover:bg-muted/40",
                  (!canManage || !prefs.show_weekend_shading) && "opacity-50",
                )}
              >
                {DAY_LABELS[d]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={!canManage || pending} size="sm">
          {pending ? (
            <Loader2 className="ml-2 size-3.5 animate-spin" />
          ) : (
            <Save className="ml-2 size-3.5" />
          )}
          حفظ الإعدادات
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  id, label, description, checked, onChange, disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-soft/60 p-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-soft/60 transition-colors",
          checked ? "bg-cyan/70" : "bg-muted/40",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "absolute h-4 w-4 rounded-full bg-background shadow transition-transform",
            // RTL-aware: when on, slide toward the start (right edge in RTL).
            checked ? "translate-x-1 ltr:translate-x-6" : "ltr:translate-x-1 translate-x-6",
          )}
        />
      </button>
    </div>
  );
}
