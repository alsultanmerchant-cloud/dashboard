import React from "react";
import { AmTargetRow } from "@/lib/data/contracts";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";

export function GroupedAmTargetsTable({
  amTargets,
  copy,
  t,
  MetricInfo,
  fmtSR,
}: {
  amTargets: AmTargetRow[];
  copy: (ar: string, en: string) => string;
  t: (key: string) => string;
  MetricInfo: any;
  fmtSR: (val: number) => string;
}) {
  if (amTargets.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        {copy("لا يوجد تارجت محسوب لهذا الشهر.", "No targets calculated for this month.")}
      </p>
    );
  }

  // 1. Identify leaders and DM
  const dm = amTargets.find((a) => a.team_role === "dept_manager");
  const leaders = amTargets.filter((a) => a.team_role === "team_lead").sort((a, b) => (b.team_expected ?? 0) - (a.team_expected ?? 0));
  
  // 2. Group agents
  const grouped = new Map<string, AmTargetRow[]>();
  const unassigned: AmTargetRow[] = [];
  
  leaders.forEach(l => grouped.set(l.account_manager_id, []));
  
  amTargets.forEach((a) => {
    if (a.team_role) return; // Skip leaders and DM
    if (a.team_leader_id && grouped.has(a.team_leader_id)) {
      grouped.get(a.team_leader_id).push(a);
    } else {
      unassigned.push(a);
    }
  });

  const renderRow = (a: AmTargetRow, isLeader = false) => {
    const exp = isLeader ? (a.team_expected ?? 0) : a.expected_total;
    const ach = isLeader ? (a.team_achieved ?? 0) : a.achieved_total;
    const pct = exp > 0 ? (ach / exp) * 100 : 0;
    
    return (
      <tr
        key={a.account_manager_id}
        className={cn(
          "border-t border-soft/60",
          isLeader ? "bg-soft-1/30" : ""
        )}
      >
        <td className={cn("px-3 py-2 font-medium", isLeader ? "" : "pl-8 pr-6")}>
          <div className="flex items-center gap-1.5">
            {isLeader && <span className="text-amber-500">🌟</span>}
            {!isLeader && <span className="text-soft-1 text-[10px]">↳</span>}
            <span className={isLeader ? "font-semibold" : ""}>{a.account_manager_name ?? "—"}</span>
          </div>
        </td>
        <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">
          {fmtSR(exp)}
        </td>
        <td className="px-3 py-2 text-end tabular-nums">
          {fmtSR(ach)}
        </td>
        <td className="px-3 py-2 text-center tabular-nums">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold",
              pct >= 80
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                : pct >= 40
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-200"
                  : "bg-rose-500/15 text-rose-700 dark:text-rose-200",
            )}
          >
            {pct >= 100 && <ArrowUpRight className="size-3" />}
            {pct.toFixed(0)}%
          </span>
        </td>
        <td className="px-3 py-2 w-[180px]">
          <div className="h-2 w-full overflow-hidden rounded-full bg-soft-1">
            <div
              className={cn(
                "h-full rounded-full",
                pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500",
              )}
              style={{ width: Math.min(100, pct) + "%" }}
            />
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm">
        <thead className="bg-soft-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-start font-medium">{copy("الأكونت", "Account")}</th>
            <th className="px-3 py-2 text-end font-medium">
              <span className="inline-flex items-center gap-1">
                {copy("المتوقع", "Expected")}
                <MetricInfo text={t("metricTooltips.contracts_amExpected")} label={copy("المتوقع", "Expected")} />
              </span>
            </th>
            <th className="px-3 py-2 text-end font-medium">
              <span className="inline-flex items-center gap-1">
                {copy("المحقق", "Actual")}
                <MetricInfo text={t("metricTooltips.contracts_amActual")} label={copy("المحقق", "Actual")} />
              </span>
            </th>
            <th className="px-3 py-2 text-center font-medium">
              <span className="inline-flex items-center gap-1">
                {copy("الإنجاز", "Achievement")}
                <MetricInfo text={t("metricTooltips.contracts_amAchievement")} label={copy("الإنجاز", "Achievement")} />
              </span>
            </th>
            <th className="px-3 py-2 font-medium">{copy("التقدم", "Progress")}</th>
          </tr>
        </thead>
        <tbody>
          {leaders.map((leader) => {
            const agents = grouped.get(leader.account_manager_id) || [];
            return (
              <React.Fragment key={leader.account_manager_id}>
                {renderRow(leader, true)}
                {agents.map((a) => renderRow(a, false))}
              </React.Fragment>
            );
          })}
          
          {unassigned.length > 0 && (
            <>
              {leaders.length > 0 && (
                <tr className="border-t-[3px] border-soft/60">
                  <td colSpan={5} className="bg-soft-1/10 px-3 py-1 text-[10px] text-muted-foreground text-center">
                    {copy("غير معين لفريق", "Unassigned")}
                  </td>
                </tr>
              )}
              {unassigned.map((a) => renderRow(a, false))}
            </>
          )}

          {dm && (
             <tr className="border-t-[3px] border-cyan/30 bg-cyan-dim/20">
               <td className="px-3 py-2 font-medium">
                 <div className="flex items-center gap-1.5">
                   <span className="text-cyan-500">👑</span>
                   <span className="font-semibold">{dm.account_manager_name ?? "—"} (DM)</span>
                 </div>
               </td>
               <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">
                 {fmtSR(dm.team_expected ?? 0)}
               </td>
               <td className="px-3 py-2 text-end tabular-nums">
                 {fmtSR(dm.team_achieved ?? 0)}
               </td>
               <td className="px-3 py-2 text-center tabular-nums">
                 {(() => {
                   const exp = dm.team_expected ?? 0;
                   const ach = dm.team_achieved ?? 0;
                   const pct = exp > 0 ? (ach / exp) * 100 : 0;
                   return (
                     <span
                       className={cn(
                         "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                         pct >= 80
                           ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                           : pct >= 40
                             ? "bg-amber-500/15 text-amber-700 dark:text-amber-200"
                             : "bg-rose-500/15 text-rose-700 dark:text-rose-200",
                       )}
                     >
                       {pct >= 100 && <ArrowUpRight className="size-3" />}
                       {pct.toFixed(0)}%
                     </span>
                   );
                 })()}
               </td>
               <td className="px-3 py-2 w-[180px]">
                 {(() => {
                   const exp = dm.team_expected ?? 0;
                   const ach = dm.team_achieved ?? 0;
                   const pct = exp > 0 ? (ach / exp) * 100 : 0;
                   return (
                     <div className="h-2 w-full overflow-hidden rounded-full bg-soft-1">
                       <div
                         className={cn(
                           "h-full rounded-full",
                           pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500",
                         )}
                         style={{ width: Math.min(100, pct) + "%" }}
                       />
                     </div>
                   );
                 })()}
               </td>
             </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
