"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateKpiThresholdAction } from "./_actions";

export function KpiForm({
  threshold,
  overloadThreshold,
  canManage,
}: {
  threshold: number;
  overloadThreshold: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState<number>(threshold);
  const [overload, setOverload] = useState<number>(overloadThreshold);
  const validRisk = Number.isInteger(value) && value >= 1 && value <= 100;
  const validOverload = Number.isInteger(overload) && overload >= 1 && overload <= 100;
  const dirty =
    validRisk && validOverload && (value !== threshold || overload !== overloadThreshold);

  function save() {
    start(async () => {
      const r = await updateKpiThresholdAction({
        projectsAtRiskThreshold: value,
        overloadProjectsThreshold: overload,
      });
      if ("error" in r) {
        toast.error(r.error);
      } else {
        toast.success("تم حفظ العتبات");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="mb-1 block text-sm font-medium">حد «المشاريع عالية الخطورة»</label>
        <p className="mb-3 text-[12px] text-muted-foreground">
          يُعتبر المشروع «عالي الخطورة» عند بلوغ هذا العدد من المهام المتأخرة المفتوحة أو أكثر. القيمة
          الافتراضية ٥. أمّا بطاقة «المشاريع المعرّضة للخطر» فتحسب أي مشروع به مهمة متأخرة واحدة على الأقل.
          يُعاد احتساب بطاقتَي المؤشرات في لوحة القيادة فور الحفظ.
        </p>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={1}
            max={100}
            value={Number.isFinite(value) ? value : ""}
            disabled={!canManage || pending}
            onChange={(e) => setValue(parseInt(e.target.value || "0", 10))}
            className="w-28 tabular-nums"
          />
          <span className="text-sm text-muted-foreground">مهام متأخرة مفتوحة فأكثر</span>
        </div>
        {!validRisk ? <p className="mt-1 text-[11px] text-cc-red">أدخل رقمًا بين ١ و ١٠٠.</p> : null}
      </div>

      <div className="border-t border-border pt-5">
        <label className="mb-1 block text-sm font-medium">حد «الموظف المحمّل زائد» (نبض الفريق)</label>
        <p className="mb-3 text-[12px] text-muted-foreground">
          يُعتبر الموظف «محمّل زائد» في نبض الفريق عندما يتجاوز عدد مشاريعه النشطة هذا الحد (يُحسب
          بعدد المشاريع النشطة التي له فيها مهام مفتوحة، لا بعدد المهام). القيمة الافتراضية ١٠. يُعاد
          احتساب نبض الفريق ولوحة القيادة فور الحفظ.
        </p>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={1}
            max={100}
            value={Number.isFinite(overload) ? overload : ""}
            disabled={!canManage || pending}
            onChange={(e) => setOverload(parseInt(e.target.value || "0", 10))}
            className="w-28 tabular-nums"
          />
          <span className="text-sm text-muted-foreground">مشروع نشط فأكثر</span>
        </div>
        {!validOverload ? (
          <p className="mt-1 text-[11px] text-cc-red">أدخل رقمًا بين ١ و ١٠٠.</p>
        ) : null}
      </div>

      {canManage ? (
        <Button onClick={save} disabled={!dirty || pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          حفظ
        </Button>
      ) : (
        <p className="text-[12px] text-muted-foreground">تحتاج صلاحية إدارة الإعدادات للتعديل.</p>
      )}
    </div>
  );
}
