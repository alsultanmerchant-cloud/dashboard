"use client";

import { useState, useActionState, useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createLeadAction, type LeadFormState } from "./_actions";
import {
  LEAD_STATUSES, LEAD_STATUS_LABEL, type LeadStatus,
} from "@/lib/data/lead-statuses";

export function NewLeadDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LeadStatus>("new");
  const [state, formAction, pending] = useActionState<LeadFormState | undefined, FormData>(
    createLeadAction,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success("تم إضافة العميل المحتمل");
      setOpen(false);
      setStatus("new");
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        عميل محتمل
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>عميل محتمل جديد</DialogTitle>
          <DialogDescription>
            أضف عميلاً محتملاً إلى مسار المبيعات. ستظهر بياناته فوراً في لوحة الأنابيب.
          </DialogDescription>
        </DialogHeader>
        <form
          action={formAction}
          className="space-y-3"
          key={state?.ok ? "reset" : "form"}
        >
          <input type="hidden" name="status" value={status} />

          <div className="space-y-1.5">
            <Label htmlFor="name">اسم الشركة / العميل *</Label>
            <Input
              id="name"
              name="name"
              required
              placeholder="مثال: مطعم البندر"
              aria-invalid={!!state?.fieldErrors?.name}
            />
            {state?.fieldErrors?.name && (
              <p className="text-xs text-cc-red">{state.fieldErrors.name}</p>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact_name">جهة الاتصال</Label>
              <Input id="contact_name" name="contact_name" placeholder="اسم المسؤول" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">الهاتف</Label>
              <Input id="phone" name="phone" placeholder="+966 5x xxx xxxx" dir="ltr" />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="name@company.com"
                dir="ltr"
                aria-invalid={!!state?.fieldErrors?.email}
              />
              {state?.fieldErrors?.email && (
                <p className="text-xs text-cc-red">{state.fieldErrors.email}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source">المصدر</Label>
              <Input
                id="source"
                name="source"
                placeholder="إعلان · إحالة · LinkedIn ..."
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="estimated_value">القيمة التقديرية (ريال)</Label>
              <Input
                id="estimated_value"
                name="estimated_value"
                type="number"
                inputMode="decimal"
                step="100"
                min="0"
                placeholder="0"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next_step_at">الخطوة التالية</Label>
              <Input id="next_step_at" name="next_step_at" type="date" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>المرحلة</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {LEAD_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">ملاحظات</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={2}
              placeholder="أي تفاصيل تساعد في المتابعة لاحقاً…"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
