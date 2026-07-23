"use client";

import { useState } from "react";
import { Scale, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { TeamWorkspace } from "./team-workspace";
import { CasesWorkspace } from "./cases-workspace";
import type { AccountabilityCasesResult } from "@/lib/data/accountability-cases";
import type { CaseBrief } from "@/lib/data/accountability-case-brief";
import type { AccountabilityRoster } from "@/lib/data/accountability-roster";
import type { PersistedProblemMeta } from "@/lib/data/accountability-problems-store";
import type { AccountabilityOverview, ClientEditsRow } from "@/lib/data/accountability";
import type { DashboardRange } from "@/lib/dashboard-range";
import { AccountabilityRangePicker } from "./accountability-range-picker";

type View = "team" | "cases";

interface Props {
  roster: AccountabilityRoster;
  cases: AccountabilityCasesResult;
  problemMeta: Record<string, PersistedProblemMeta>;
  brief: CaseBrief;
  initialView: View;
  reviewers: AccountabilityOverview["reviewers"];
  clientEdits: ClientEditsRow[];
  reviewerRange: DashboardRange;
}

// Two lenses on the same accountability data:
//   • الفريق (default) — department grid + searchable employee table; each row
//     opens a modal with the person's full accountability file.
//   • القضايا — the Problems & Proof case feed (cross-stream, severity-ranked).
export function AccountabilityShell({
  roster,
  cases,
  problemMeta,
  brief,
  initialView,
  reviewers,
  clientEdits,
  reviewerRange,
}: Props) {
  const [view, setView] = useState<View>(initialView);

  const tabs: { key: View; label: string; icon: typeof Scale }[] = [
    { key: "team", label: "الفريق", icon: Users },
    { key: "cases", label: "القضايا", icon: Scale },
  ];

  const switchTo = (next: View) => {
    setView(next);
    // Mirror to the URL without a server round-trip so refresh/links restore it.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (next === "team") params.delete("view");
      else params.set("view", next);
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    }
  };

  return (
    <div className="space-y-4">
      <AccountabilityRangePicker range={reviewerRange} />

      {/* Lens switcher */}
      <div className="inline-flex rounded-xl border border-border bg-card/60 p-0.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTo(t.key)}
            aria-pressed={view === t.key}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors",
              view === t.key
                ? "bg-cyan-dim text-cyan"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
            {t.key === "cases" && cases.meta.critical + cases.meta.proven > 0 && (
              <span className="rounded-full bg-cc-red/15 px-1.5 text-[10px] font-bold text-cc-red">
                {cases.meta.critical + cases.meta.proven}
              </span>
            )}
          </button>
        ))}
      </div>

      {view === "team" && (
        <TeamWorkspace
          roster={roster}
          cases={cases.cases}
          problemMeta={problemMeta}
          reviewers={reviewers}
          clientEdits={clientEdits}
          reviewerRange={reviewerRange}
        />
      )}
      {view === "cases" && <CasesWorkspace data={cases} problemMeta={problemMeta} brief={brief} />}
    </div>
  );
}
