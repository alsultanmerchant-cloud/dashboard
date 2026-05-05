"use client";

// Tabbed wrapper around the org chart: "Diagram" (new PDF-style flow) and
// "List" (existing nested-cards rendering, kept as a fallback for users who
// prefer the old textual layout). Diagram is the default per owner request.

import { useState, useTransition } from "react";
import { LayoutDashboard, List } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OrgChart, OrgDepartment } from "@/lib/data/org-chart";
import { OrgChartFlow, flattenOrgChart } from "./org-chart-flow";
import {
  renameDepartment,
  addChildDepartment,
  deleteDepartment,
} from "../_actions";

const TABS = [
  { key: "diagram", label: "مخطط", icon: LayoutDashboard },
  { key: "list", label: "قائمة", icon: List },
] as const;

export function ChartViews({ chart }: { chart: OrgChart }) {
  const [view, setView] = useState<"diagram" | "list">("diagram");
  const [, start] = useTransition();
  const flat = flattenOrgChart(chart.roots);

  const handleRename = (id: string, newName: string) => {
    start(async () => {
      const res = await renameDepartment({ id, newName });
      if (res.error) toast.error(res.error);
      else toast.success("تم تحديث الاسم");
    });
  };
  const handleAddChild = (parentId: string) => {
    start(async () => {
      const res = await addChildDepartment({ parentId, name: "قسم جديد", kind: "other" });
      if (res.error) toast.error(res.error);
      else toast.success("تمت إضافة القسم");
    });
  };
  const handleDelete = (id: string) => {
    start(async () => {
      const res = await deleteDepartment({ id });
      if (res.error) toast.error(res.error);
      else toast.success("تم حذف القسم");
    });
  };

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-soft bg-card/60 p-0.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = view === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setView(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors",
                active
                  ? "bg-cyan-dim text-cyan"
                  : "text-muted-foreground hover:text-foreground hover:bg-soft-2",
              )}
              aria-pressed={active}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {view === "diagram" ? (
        <OrgChartFlow
          departments={flat}
          onRenameDepartment={handleRename}
          onAddChildDepartment={handleAddChild}
          onDeleteDepartment={handleDelete}
        />
      ) : (
        <ListFallback roots={chart.roots} />
      )}
    </div>
  );
}

function ListFallback({ roots }: { roots: OrgDepartment[] }) {
  return (
    <div className="rounded-2xl border border-soft bg-card/30 p-4 text-sm text-muted-foreground">
      عرض القائمة المنظمة: مفعّل في النسخة السابقة من الصفحة. الافتراضي هو
      المخطط الذي يحاكي الـ PDF. للتعديل والتنقل، استخدم تبويب &quot;مخطط&quot;.
      <ul className="mt-3 space-y-2">
        {roots.map((r) => (
          <li key={r.id}>
            <strong className="text-foreground">{r.name}</strong>
            {r.children.length > 0 && (
              <ul className="ms-4 mt-1 space-y-1 text-[12px]">
                {r.children.map((c) => (
                  <li key={c.id}>
                    {c.name}
                    {c.children.length > 0 && (
                      <ul className="ms-4 mt-0.5">
                        {c.children.map((g) => (
                          <li key={g.id}>{g.name}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
