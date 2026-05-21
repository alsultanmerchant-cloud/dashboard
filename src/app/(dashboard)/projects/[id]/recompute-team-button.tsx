"use client";

// Triggers a live recompute of role-slot assignees on this project's open
// tasks. The server action runs the same resolver that generate-tasks uses
// but against current rules — so changes to project specialists, the
// account manager, or position-table rules propagate immediately to all
// open tasks without waiting for the next Odoo sync.

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { Loader2, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { recomputeProjectTeamAction } from "./_recompute_team_action";

export function RecomputeTeamButton({ projectId }: { projectId: string }) {
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  const ar = locale.startsWith("ar");

  const onClick = () =>
    startTransition(async () => {
      const res = await recomputeProjectTeamAction({ projectId });
      if (!res.ok) {
        alert(
          ar
            ? `تعذّر تحديث الفريق: ${res.error}`
            : `Recompute failed: ${res.error}`,
        );
        return;
      }
      const msg = ar
        ? `تم تحديث الفريق: ${res.taskCount} مهمة (+${res.inserted}, ~${res.updated}, -${res.deleted})`
        : `Team recomputed: ${res.taskCount} tasks (+${res.inserted}, ~${res.updated}, -${res.deleted})`;
      // Lightweight UX — server action revalidates the page already.
      // eslint-disable-next-line no-alert
      alert(msg);
    });

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={pending}
      title={
        ar
          ? "إعادة احتساب الفريق على المهام المفتوحة"
          : "Recompute team on open tasks"
      }
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RefreshCcw className="size-3.5" />
      )}
      {ar ? "تحديث الفريق" : "Recompute team"}
    </Button>
  );
}
