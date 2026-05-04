"use client";

import { useState, useActionState, useEffect, useMemo } from "react";
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
import { requestLeaveAction, type LeaveFormState } from "./_actions";
import {
  LEAVE_TYPES, LEAVE_TYPE_LABEL, type LeaveType,
} from "@/lib/data/leave-types";

// inclusive day count between two YYYY-MM-DD dates
function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const a = new Date(start + "T00:00:00.000Z");
  const b = new Date(end + "T00:00:00.000Z");
  const diff = (b.getTime() - a.getTime()) / 86400000;
  if (!Number.isFinite(diff) || diff < 0) return 0;
  return diff + 1;
}

export function RequestLeaveDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>("annual");
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const computedDays = useMemo(
    () => daysBetween(startDate, endDate),
    [startDate, endDate],
  );

  const [state, formAction, pending] = useActionState<LeaveFormState | undefined, FormData>(
    requestLeaveAction,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success("تم إرسال طلب الإجازة");
      setOpen(false);
      setLeaveType("annual");
      setStartDate(today);
      setEndDate(today);
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router, today]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        طلب إجازة
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>طلب إجازة جديدة</DialogTitle>
          <DialogDescription>
            اختر النوع والفترة. الطلب سيُرسل للمدير للموافقة.
          </DialogDescription>
        </DialogHeader>
        <form
          action={formAction}
          className="space-y-3"
          key={state?.ok ? "reset" : "form"}
        >
          <input type="hidden" name="leave_type" value={leaveType} />

          <div className="space-y-1.5">
            <Label>نوع الإجازة *</Label>
            <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {LEAVE_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start_date">من *</Label>
              <Input
                id="start_date"
                name="start_date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                aria-invalid={!!state?.fieldErrors?.start_date}
              />
              {state?.fieldErrors?.start_date && (
                <p className="text-xs text-cc-red">{state.fieldErrors.start_date}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end_date">إلى *</Label>
              <Input
                id="end_date"
                name="end_date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                aria-invalid={!!state?.fieldErrors?.end_date}
              />
              {state?.fieldErrors?.end_date && (
                <p className="text-xs text-cc-red">{state.fieldErrors.end_date}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="days">عدد الأيام *</Label>
            <Input
              id="days"
              name="days"
              type="number"
              step="0.5"
              min="0.5"
              required
              defaultValue={computedDays}
              key={computedDays}
              dir="ltr"
              aria-invalid={!!state?.fieldErrors?.days}
            />
            <p className="text-[11px] text-muted-foreground">
              تُحتسب تلقائياً من الفترة. عدّلها يدوياً للأنصاف أو الإجازات الجزئية.
            </p>
            {state?.fieldErrors?.days && (
              <p className="text-xs text-cc-red">{state.fieldErrors.days}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">السبب</Label>
            <Textarea
              id="reason"
              name="reason"
              rows={2}
              placeholder="ملاحظات تساعد المدير في اتخاذ القرار…"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              إرسال الطلب
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
