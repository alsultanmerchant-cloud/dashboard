"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateKpiThresholdAction } from "./_actions";

export function KpiForm({ threshold, canManage }: { threshold: number; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState<number>(threshold);
  const valid = Number.isInteger(value) && value >= 1 && value <= 100;
  const dirty = valid && value !== threshold;

  function save() {
    start(async () => {
      const r = await updateKpiThresholdAction({ projectsAtRiskThreshold: value });
      if ("error" in r) {
        toast.error(r.error);
      } else {
        toast.success("تم حفظ العتبة");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
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
        {!valid ? <p className="mt-1 text-[11px] text-cc-red">أدخل رقمًا بين ١ و ١٠٠.</p> : null}
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
