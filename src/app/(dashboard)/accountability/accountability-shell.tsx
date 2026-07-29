"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TeamWorkspace } from "./team-workspace";
import { CaseOverview } from "./case-overview";
import { refreshAccountabilityScorecardAction } from "./_actions";
import type { AccountabilityCasesResult } from "@/lib/data/accountability-cases";
import type { CaseBrief } from "@/lib/data/accountability-case-brief";
import type { AccountabilityRoster } from "@/lib/data/accountability-roster";
import type { PersistedProblemMeta } from "@/lib/data/accountability-problems-store";
import type { AccountabilityOverview, ClientEditsRow } from "@/lib/data/accountability";
import type { DashboardRange } from "@/lib/dashboard-range";
import { AccountabilityRangePicker } from "./accountability-range-picker";

interface Props {
  roster: AccountabilityRoster;
  cases: AccountabilityCasesResult;
  problemMeta: Record<string, PersistedProblemMeta>;
  brief: CaseBrief;
  reviewers: AccountabilityOverview["reviewers"];
  clientEdits: ClientEditsRow[];
  reviewerRange: DashboardRange;
}

// One page — the separate «القضايا» case-feed tab was removed. Its only
// surviving piece is the CEO band (تعامل مع هؤلاء أولاً + ما تغيّر خلال الفترة),
// which now sits atop the team scorecard. The full per-person evidence still
// lives in each team row's modal (تفاصيل الفريق), so the case cards added no
// unique information beyond that band.
export function AccountabilityShell({
  roster,
  cases,
  problemMeta,
  brief,
  reviewers,
  clientEdits,
  reviewerRange,
}: Props) {
  const [refreshing, startRefresh] = useTransition();

  const handleRefresh = () =>
    startRefresh(async () => {
      const res = await refreshAccountabilityScorecardAction();
      if (res.ok) {
        toast.success("تم تحديث البيانات");
        window.location.reload();
      } else {
        toast.error(res.error ?? "تعذّر التحديث");
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <AccountabilityRangePicker range={reviewerRange} />
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-soft-1 disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          {refreshing ? "جارٍ التحديث…" : "تحديث البيانات"}
        </button>
      </div>

      {/* CEO band — moved here from the removed القضايا tab. */}
      <CaseOverview brief={brief} />

      {/* id: deep-link target of the CEO brief's SLA-late rows («مهام معلّقة
          تجاوزت مهلة مراحلها» + the «الجديد اليوم» digest) — lands on the team
          table whose «مراحل متأخرة» column carries the numbers. */}
      <div id="sla-late" className="scroll-mt-24 target-highlight">
        <TeamWorkspace
          roster={roster}
          cases={cases.cases}
          problemMeta={problemMeta}
          reviewers={reviewers}
          clientEdits={clientEdits}
          reviewerRange={reviewerRange}
        />
      </div>
    </div>
  );
}
