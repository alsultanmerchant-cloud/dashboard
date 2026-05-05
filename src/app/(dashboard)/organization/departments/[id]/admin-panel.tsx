"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, X, Plus, Crown, Shield, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  setDepartmentHead,
  addTeamLead,
  removeTeamLead,
} from "../../_actions";

type Candidate = {
  user_id: string;
  employee_id: string;
  full_name: string;
  job_title: string | null;
  department_id: string | null;
};

export function DepartmentAdminPanel({
  departmentId,
  departmentName: _departmentName,
  currentHeadUserId,
  currentTeamLeadUserIds,
  candidates,
}: {
  departmentId: string;
  departmentName: string;
  currentHeadUserId: string | null;
  currentTeamLeadUserIds: string[];
  candidates: Candidate[];
}) {
  const router = useRouter();
  const t = useTranslations("Organization");
  const [pending, startTransition] = useTransition();
  const [headPick, setHeadPick] = useState<string>(currentHeadUserId ?? "");
  const [leadPick, setLeadPick] = useState<string>("");

  const candidateById = new Map(candidates.map((c) => [c.user_id, c]));
  const eligibleForLead = candidates.filter(
    (c) => !currentTeamLeadUserIds.includes(c.user_id),
  );

  function onSetHead() {
    startTransition(async () => {
      const result = await setDepartmentHead({
        departmentId,
        userId: headPick === "" ? null : headPick,
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(t("headUpdated"));
        router.refresh();
      }
    });
  }

  function onAddLead() {
    if (!leadPick) return;
    startTransition(async () => {
      const result = await addTeamLead({ departmentId, userId: leadPick });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(t("leadAdded"));
        setLeadPick("");
        router.refresh();
      }
    });
  }

  function onRemoveLead(userId: string) {
    startTransition(async () => {
      const result = await removeTeamLead({ departmentId, userId });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(t("leadRemoved"));
        router.refresh();
      }
    });
  }

  return (
    <Card className="bg-card/60 border-cyan/[0.18]">
      <CardContent className="p-4 space-y-5">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Settings2 className="size-4 text-cyan" />
          {t("adminTools")}
        </div>

        {/* Head picker */}
        <div className="space-y-2">
          <label
            htmlFor={`head-picker-${departmentId}`}
            className="flex items-center gap-1.5 text-xs font-medium text-foreground"
          >
            <Crown className="size-3" />
            {t("head")}
          </label>
          <div className="flex gap-2 flex-wrap">
            <select
              id={`head-picker-${departmentId}`}
              value={headPick}
              onChange={(e) => setHeadPick(e.target.value)}
              disabled={pending}
              className="flex-1 min-w-48 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan"
            >
              <option value="">— {t("noHead")} —</option>
              {candidates.map((c) => (
                <option key={c.user_id} value={c.user_id}>
                  {c.full_name}
                  {c.job_title ? ` · ${c.job_title}` : ""}
                </option>
              ))}
            </select>
            <Button
              type="button"
              onClick={onSetHead}
              disabled={pending || headPick === (currentHeadUserId ?? "")}
              size="sm"
            >
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {t("setHead")}
            </Button>
          </div>
        </div>

        {/* Team leads list + adder */}
        <div className="space-y-2">
          <label
            htmlFor={`lead-picker-${departmentId}`}
            className="flex items-center gap-1.5 text-xs font-medium text-foreground"
          >
            <Shield className="size-3" />
            {t("teamLeads")}
          </label>

          {currentTeamLeadUserIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {currentTeamLeadUserIds.map((uid) => {
                const c = candidateById.get(uid);
                return (
                  <Badge
                    key={uid}
                    variant="secondary"
                    className="gap-1.5 pe-1"
                  >
                    {c?.full_name ?? uid}
                    <button
                      type="button"
                      onClick={() => onRemoveLead(uid)}
                      disabled={pending}
                      aria-label={`${t("removeTeamLead")} ${c?.full_name ?? ""}`}
                      className="rounded-full p-0.5 hover:bg-cc-red/20"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <select
              id={`lead-picker-${departmentId}`}
              value={leadPick}
              onChange={(e) => setLeadPick(e.target.value)}
              disabled={pending}
              className="flex-1 min-w-48 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan"
            >
              <option value="">{t("pickTeamLead")}</option>
              {eligibleForLead.map((c) => (
                <option key={c.user_id} value={c.user_id}>
                  {c.full_name}
                  {c.job_title ? ` · ${c.job_title}` : ""}
                </option>
              ))}
            </select>
            <Button
              type="button"
              onClick={onAddLead}
              disabled={pending || !leadPick}
              size="sm"
              variant="outline"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              {t("addTeamLead")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
