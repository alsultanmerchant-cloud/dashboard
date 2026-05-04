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
import { createExpenseAction, type ExpenseFormState } from "./_actions";
import {
  EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, type ExpenseCategory,
} from "@/lib/data/expense-categories";

export function NewExpenseDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory>("other");
  const today = new Date().toISOString().slice(0, 10);
  const [state, formAction, pending] = useActionState<ExpenseFormState | undefined, FormData>(
    createExpenseAction,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success("تم تسجيل المصروف");
      setOpen(false);
      setCategory("other");
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        إضافة مصروف
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>مصروف جديد</DialogTitle>
          <DialogDescription>
            سجِّل عملية مصروف بالفئة والمبلغ والتاريخ. سيظهر فوراً في تقارير الفئة والشهر.
          </DialogDescription>
        </DialogHeader>
        <form
          action={formAction}
          className="space-y-3"
          key={state?.ok ? "reset" : "form"}
        >
          <input type="hidden" name="category" value={category} />

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="expense_date">التاريخ *</Label>
              <Input
                id="expense_date"
                name="expense_date"
                type="date"
                defaultValue={today}
                required
                aria-invalid={!!state?.fieldErrors?.expense_date}
              />
              {state?.fieldErrors?.expense_date && (
                <p className="text-xs text-cc-red">{state.fieldErrors.expense_date}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">المبلغ (ريال) *</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                required
                placeholder="0.00"
                dir="ltr"
                aria-invalid={!!state?.fieldErrors?.amount}
              />
              {state?.fieldErrors?.amount && (
                <p className="text-xs text-cc-red">{state.fieldErrors.amount}</p>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>الفئة *</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {EXPENSE_CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor">المورِّد / الجهة</Label>
              <Input
                id="vendor"
                name="vendor"
                placeholder="مثال: STC, Adobe, مالك العقار"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">ملاحظات</Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              placeholder="أي تفاصيل تساعد في فهم المصروف لاحقاً…"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              حفظ المصروف
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
