"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
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
  const locale = useLocale();
  const t = useTranslations("TaskDetailPage.approval");
  const [pending, start] = useTransition();
  const [approverId, setApproverId] = useState<string>(firstApproverId ?? "");
  const [notes, setNotes] = useState("");

  const approver = employees.find((e) => e.id === firstApproverId) ?? null;
  const isApprover = currentEmployeeId !== null && currentEmployeeId === firstApproverId;
  const canDecide = approvalRequired && approvalStatus !== "approved" && (isApprover || canManage);

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale === "ar" ? "ar-SA" : "en-US", { dateStyle: "medium", timeStyle: "short" }) : null;

  const onRequest = () =>
    start(async () => {
      const res = await requestTaskApprovalAction({
        taskId,
        approverEmployeeId: approverId || null,
        notes: notes.trim() || undefined,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.requested"));
      setNotes("");
      router.refresh();
    });

  const onApprove = () =>
    start(async () => {
      const res = await approveTaskAction({ taskId, notes: notes.trim() || undefined });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.approved"));
      setNotes("");
      router.refresh();
    });

  const onReject = () =>
    start(async () => {
      const res = await rejectTaskAction({ taskId, notes: notes.trim() || undefined });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.rejected"));
      setNotes("");
      router.refresh();
    });

  const onReset = () =>
    start(async () => {
      const res = await resetTaskApprovalAction({ taskId, clearRequirement: false });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.resent"));
      router.refresh();
    });

  const onClear = () =>
    start(async () => {
      const res = await resetTaskApprovalAction({ taskId, clearRequirement: true });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.cleared"));
      router.refresh();
    });

  const status: { label: string; tone: string; Icon: typeof ShieldCheck } =
    approvalStatus === "approved"
      ? { label: t("status.approved"), tone: "text-cc-green border-cc-green/40 bg-cc-green/10", Icon: CheckCircle2 }
      : approvalStatus === "rejected"
        ? { label: t("status.rejected"), tone: "text-cc-red border-cc-red/40 bg-cc-red/10", Icon: XCircle }
        : approvalStatus === "pending"
          ? { label: t("status.pending"), tone: "text-cc-amber border-cc-amber/40 bg-cc-amber/10", Icon: ShieldAlert }
          : { label: t("status.notRequired"), tone: "text-muted-foreground border-border bg-muted/30", Icon: ShieldCheck };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-muted-foreground" />
            {t("title")}
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
              {t("approver")}: <span className="font-medium text-foreground">{approver?.full_name ?? t("unassigned")}</span>
              {approver?.job_title ? <span className="opacity-70"> — {approver.job_title}</span> : null}
            </div>
            {approvalRequestedAt ? <div>{t("requestedAt")}: {formatDate(approvalRequestedAt)}</div> : null}
            {approvalDecidedAt ? <div>{t("decidedAt")}: {formatDate(approvalDecidedAt)}</div> : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("description")}
          </p>
        )}

        {/* Approver picker visible to managers when configuring */}
        {(canManage || !approvalRequired) && (
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("pickApprover")}</label>
            <select
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              disabled={pending}
            >
              <option value="">{t("noApprover")}</option>
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
            <label className="text-xs font-medium text-muted-foreground">{t("notes")}</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={t("notesPlaceholder")}
              disabled={pending}
              maxLength={1000}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!approvalRequired && canManage && (
            <Button onClick={onRequest} disabled={pending} size="sm">
              {pending ? <Loader2 className="ml-1 size-3.5 animate-spin" /> : <ShieldAlert className="ml-1 size-3.5" />}
              {t("actions.enableAndRequest")}
            </Button>
          )}

          {approvalRequired && approvalStatus !== "approved" && canManage && (
            <Button onClick={onRequest} disabled={pending} size="sm" variant="secondary">
              {pending ? <Loader2 className="ml-1 size-3.5 animate-spin" /> : null}
              {t("actions.resend")}
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
                {t("actions.approve")}
              </Button>
              <Button
                onClick={onReject}
                disabled={pending}
                size="sm"
                variant="destructive"
              >
                {pending ? <Loader2 className="ml-1 size-3.5 animate-spin" /> : <XCircle className="ml-1 size-3.5" />}
                {t("actions.reject")}
              </Button>
            </>
          )}

          {approvalRequired && approvalStatus === "approved" && canManage && (
            <Button onClick={onReset} disabled={pending} size="sm" variant="outline">
              <RotateCcw className="ml-1 size-3.5" />
              {t("actions.requestAgain")}
            </Button>
          )}

          {approvalRequired && canManage && (
            <Button onClick={onClear} disabled={pending} size="sm" variant="ghost">
              {t("actions.clearRequirement")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
