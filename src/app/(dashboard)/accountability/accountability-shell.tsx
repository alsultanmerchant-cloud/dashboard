"use client";

import { useState } from "react";
import { Gauge, Scale, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { TeamWorkspace } from "./team-workspace";
import { CasesWorkspace } from "./cases-workspace";
import { AccountabilityWorkspace } from "./accountability-workspace";
import type { ClientFinanceMap } from "@/lib/data/client-finance";
import type { AccountabilityCasesResult } from "@/lib/data/accountability-cases";
import type { AccountabilityRoster } from "@/lib/data/accountability-roster";
import type { PersistedCaseMeta } from "@/lib/accountability/case-status";
import type {
  AccountabilityEvidence,
  AccountabilityOverview,
} from "@/lib/data/accountability";

type View = "team" | "cases" | "scorecard";

interface Props {
  roster: AccountabilityRoster;
  cases: AccountabilityCasesResult;
  caseMeta: Record<string, PersistedCaseMeta>;
  overview: AccountabilityOverview | null;
  evidence: AccountabilityEvidence | null;
  selectedId: string | null;
  financeMap: ClientFinanceMap | null;
  initialView: View;
}

// Three lenses on the same accountability data:
//   • الفريق (default) — department grid + searchable employee table; each row
//     opens a modal with the person's full accountability file.
//   • القضايا — the Problems & Proof case feed (cross-stream, severity-ranked).
//   • الدرجات — the per-person scorecard + stage-level evidence (master–detail).
// The scorecard tab opens automatically on ?emp=…&view=scorecard deep links.
export function AccountabilityShell({
  roster,
  cases,
  caseMeta,
  overview,
  evidence,
  selectedId,
  financeMap,
  initialView,
}: Props) {
  const [view, setView] = useState<View>(initialView);

  const tabs: { key: View; label: string; icon: typeof Scale }[] = [
    { key: "team", label: "الفريق", icon: Users },
    { key: "cases", label: "القضايا", icon: Scale },
    { key: "scorecard", label: "الدرجات", icon: Gauge },
  ];

  const switchTo = (next: View) => {
    if (next === "scorecard" && !overview) {
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        params.set("view", "scorecard");
        const qs = params.toString();
        window.location.assign(qs ? `?${qs}` : "?view=scorecard");
      }
      return;
    }
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
        <TeamWorkspace roster={roster} cases={cases.cases} caseMeta={caseMeta} />
      )}
      {view === "cases" && <CasesWorkspace data={cases} caseMeta={caseMeta} />}
      {view === "scorecard" && overview && financeMap && (
        <AccountabilityWorkspace
          key={selectedId ?? "none"}
          overview={overview}
          evidence={evidence}
          selectedId={selectedId}
          financeMap={financeMap}
        />
      )}
    </div>
  );
}
