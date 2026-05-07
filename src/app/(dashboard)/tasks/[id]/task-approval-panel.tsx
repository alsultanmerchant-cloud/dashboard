"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck, ShieldAlert, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  approveTaskAction,
  rejectTaskAction,
  requestTaskApprovalAction,
  resetTaskApprovalAction,
} from "./_actions";

type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";

export type ApprovalEmployeeOption = {
  id: string;
  full_name: string;
  job_title: string | null;
};

export function TaskApprovalPanel({
  taskId,
  approvalRequired,
  approvalStatus,
  firstApproverId,
  approvalRequestedAt,
  approvalDecidedAt,
  employees,
  currentEmployeeId,
  canManage,
}: {
  taskId: string;
  approvalRequired: boolean;
  approvalStatus: ApprovalStatus;
  firstApproverId: string | null;
  approvalRequestedAt: string | null;
  approvalDecidedAt: string | null;
  employees: ApprovalEmployeeOption[];
  currentEmployeeId: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [approverId, setApproverId] = useState<string>(firstApproverId ?? "");
  const [notes, setNotes] = useState("");

  const approver = employees.find((e) => e.id === firstApproverId) ?? null;
  const isApprover = currentEmployeeId !== null && currentEmployeeId === firstApproverId;
  const canDecide = approvalRequired && approvalStatus !== "approved" && (isApprover || canManage);

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" }) : null;

  const onRequest = () =>
    start(async () => {
      const res = await requestTaskApprovalAction({
        taskId,
        approverEmployeeId: approverId || null,
        notes: notes.trim() || undefined,
      });
      if ("error" in res) return toast.error(res.error);
      toast.success("تم إرسال طلب الاعتماد");
      setNotes("");
      router.refresh();
    });

  const onApprove = () =>
    start(async () => {
      const res = await approveTaskAction({ taskId, notes: notes.trim() || undefined });
      if ("error" in res) return toast.error(res.error);
      toast.success("تم اعتماد المهمة");
      setNotes("");
      router.refresh();
    });

  const onReject = () =>
    start(async () => {
      const res = await rejectTaskAction({ taskId, notes: notes.trim() || undefined });
      if ("error" in res) return toast.error(res.error);
      toast.success("تم رفض المهمة");
      setNotes("");
      router.refresh();
    });

  const onReset = () =>
    start(async () => {
      const res = await resetTaskApprovalAction({ taskId, clearRequirement: false });
      if ("error" in res) return toast.error(res.error);
      toast.success("أُعيد طلب الاعتماد");
      router.refresh();
    });

  const onClear = () =>
    start(async () => {
      const res = await resetTaskApprovalAction({ taskId, clearRequirement: true });
      if ("error" in res) return toast.error(res.error);
      toast.success("ألغيت متطلب الاعتماد");
      router.refresh();
    });

  const status: { label: string; tone: string; Icon: typeof ShieldCheck } =
    approvalStatus === "approved"
      ? { label: "معتمد", tone: "text-cc-green border-cc-green/40 bg-cc-green/10", Icon: CheckCircle2 }
      : approvalStatus === "rejected"
        ? { label: "مرفوض", tone: "text-cc-red border-cc-red/40 bg-cc-red/10", Icon: XCircle }
        : approvalStatus === "pending"
          ? { label: "بانتظار الاعتماد", tone: "text-cc-amber border-cc-amber/40 bg-cc-amber/10", Icon: ShieldAlert }
          : { label: "لا يتطلب اعتمادًا", tone: "text-muted-foreground border-border bg-muted/30", Icon: ShieldCheck };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-muted-foreground" />
            بوابة الاعتماد
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
              status.tone,
            )}
          >
            <status.Icon className="size-3.5" />
            {status.label}
          </span>
        </div>

        {approvalRequired ? (
          <div className="grid gap-2 text-xs text-muted-foreground">
            <div>
              المعتمد: <span className="font-medium text-foreground">{approver?.full_name ?? "غير محدد"}</span>
              {approver?.job_title ? <span className="opacity-70"> — {approver.job_title}</span> : null}
            </div>
            {approvalRequestedAt ? <div>طُلب الاعتماد: {formatDate(approvalRequestedAt)}</div> : null}
            {approvalDecidedAt ? <div>تاريخ القرار: {formatDate(approvalDecidedAt)}</div> : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            عند تفعيل بوابة الاعتماد لن يتمكن أحد من نقل المهمة إلى المرحلة التالية حتى يعتمدها المعتمد المختار.
          </p>
        )}

        {/* Approver picker visible to managers when configuring */}
        {(canManage || !approvalRequired) && (
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">اختر المعتمد</label>
            <select
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              disabled={pending}
            >
              <option value="">— بدون معتمد محدد —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                  {e.job_title ? ` — ${e.job_title}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Notes textarea — used by every action */}
        {(canDecide || canManage || !approvalRequired) && (
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">ملاحظات (اختياري)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="سبب الاعتماد أو الرفض…"
              disabled={pending}
              maxLength={1000}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!approvalRequired && canManage && (
            <Button onClick={onRequest} disabled={pending} size="sm">
              {pending ? <Loader2 className="ml-1 size-3.5 animate-spin" /> : <ShieldAlert className="ml-1 size-3.5" />}
              تفعيل البوابة وطلب الاعتماد
            </Button>
          )}

          {approvalRequired && approvalStatus !== "approved" && canManage && (
            <Button onClick={onRequest} disabled={pending} size="sm" variant="secondary">
              {pending ? <Loader2 className="ml-1 size-3.5 animate-spin" /> : null}
              إعادة إرسال الطلب
            </Button>
          )}

          {canDecide && (
            <>
              <Button
                onClick={onApprove}
                disabled={pending}
                size="sm"
                className="bg-cc-green text-white hover:bg-cc-green/90"
              >
                {pending ? <Loader2 className="ml-1 size-3.5 animate-spin" /> : <CheckCircle2 className="ml-1 size-3.5" />}
                اعتماد
              </Button>
              <Button
                onClick={onReject}
                disabled={pending}
                size="sm"
                variant="destructive"
              >
                {pending ? <Loader2 className="ml-1 size-3.5 animate-spin" /> : <XCircle className="ml-1 size-3.5" />}
                رفض
              </Button>
            </>
          )}

          {approvalRequired && approvalStatus === "approved" && canManage && (
            <Button onClick={onReset} disabled={pending} size="sm" variant="outline">
              <RotateCcw className="ml-1 size-3.5" />
              إعادة طلب الاعتماد
            </Button>
          )}

          {approvalRequired && canManage && (
            <Button onClick={onClear} disabled={pending} size="sm" variant="ghost">
              إلغاء متطلب الاعتماد
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
