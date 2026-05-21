"use client";

// Body of the Activities StackedSheet — lists open task_activities
// scoped to the project (mail.activity-style scheduled to-dos).

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

type Activity = {
  id: string;
  summary: string | null;
  note: string | null;
  due_date: string;
  task_code: string | null;
  task_title: string | null;
  task_id: string;
  assignee_name: string | null;
  overdue: boolean;
};

export function ProjectActivitiesSheetBody({ projectId }: { projectId: string }) {
  const t = useTranslations("ProjectDetailPage");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/activities`, {
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { activities?: Activity[] };
      })
      .then((json) => {
        if (!alive) return;
        setActivities(json.activities ?? []);
      })
      .catch((err) => {
        if (!alive) return;
        console.error("[project activities] load failed", err);
        setError(t("loading.notes"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  if (error) {
    return <div className="py-6 text-sm text-cc-red">{error}</div>;
  }
  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-soft px-3 py-10 text-center text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 opacity-60" />
        <span>—</span>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {activities.map((a) => (
        <li
          key={a.id}
          className={cn(
            "rounded-xl border border-border bg-card px-3 py-2.5 text-sm",
            a.overdue && "border-amber/40 bg-amber-dim/40",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium">
              {a.summary ?? "—"}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 shrink-0 text-[10px] font-medium",
                a.overdue ? "text-amber" : "text-muted-foreground",
              )}
              dir="ltr"
            >
              <Clock className="size-3" />
              {a.due_date}
            </span>
          </div>
          {a.task_code && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <span className="font-mono" dir="ltr">{a.task_code}</span>
              {a.task_title ? ` · ${a.task_title}` : ""}
              {a.assignee_name ? ` · ${a.assignee_name}` : ""}
            </p>
          )}
          {a.note && (
            <p className="mt-1.5 whitespace-pre-wrap text-[12px] text-foreground/80">
              {a.note}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
