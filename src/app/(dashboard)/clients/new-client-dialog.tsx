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
import { createClientAction, type ClientFormState } from "./_actions";

export function NewClientDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"active" | "lead" | "inactive">("active");
  const [state, formAction, pending] = useActionState<ClientFormState | undefined, FormData>(
    createClientAction,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success("تم إنشاء العميل");
      setOpen(false);
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        إضافة عميل
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>عميل جديد</DialogTitle>
          <DialogDescription>أضف عميل جديد إلى قاعدة البيانات.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3" key={state?.ok ? "reset" : "form"}>
          <input type="hidden" name="status" value={status} />
          <div className="space-y-1.5">
            <Label htmlFor="name">اسم العميل *</Label>
            <Input id="name" name="name" required placeholder="مثال: مطعم البندر" aria-invalid={!!state?.fieldErrors?.name} />
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
              <Input id="email" name="email" type="email" placeholder="name@company.com" dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company_website">الموقع</Label>
              <Input id="company_website" name="company_website" placeholder="example.com" dir="ltr" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="source">المصدر</Label>
              <Input id="source" name="source" placeholder="مبيعات · إحالة · ..." />
            </div>
            <div className="space-y-1.5">
              <Label>الحالة</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">نشط</SelectItem>
                  <SelectItem value="lead">محتمل</SelectItem>
                  <SelectItem value="inactive">غير نشط</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">ملاحظات</Label>
            <Textarea id="notes" name="notes" rows={2} placeholder="أي ملاحظات داخلية…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              حفظ العميل
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
