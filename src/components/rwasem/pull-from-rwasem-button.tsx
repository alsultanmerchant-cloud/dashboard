"use client";

// "Pull from Rwasem" — on-demand Odoo sync trigger. One component, four modes:
//   kind="task"     → refresh one task (stage, comments, assignees, history)
//   kind="project"  → refresh one project (status + fields)
//   kind="tasks"    → incremental refresh of all tasks (+ comments)
//   kind="projects" → incremental refresh of all projects
// Single-entity modes require `odooId` (the row's Odoo external_id).

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  pullTaskAction,
  pullProjectAction,
  pullTasksIncrementalAction,
  pullProjectsIncrementalAction,
} from "@/app/(dashboard)/_actions/rwasem-pull";

type Kind = "task" | "project" | "tasks" | "projects";

export function PullFromRwasemButton({
  kind,
  odooId,
  label = "تحديث من رواسم",
  size = "sm",
  variant = "outline",
  iconOnly = false,
}: {
  kind: Kind;
  odooId?: number | null;
  label?: string;
  size?: "sm" | "default" | "icon";
  variant?: "outline" | "ghost" | "secondary" | "default";
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Single-entity modes need a valid Odoo id; render nothing without one.
  if ((kind === "task" || kind === "project") && !odooId) return null;

  function onClick() {
    start(async () => {
      const res =
        kind === "task"
          ? await pullTaskAction(odooId as number)
          : kind === "project"
            ? await pullProjectAction(odooId as number)
            : kind === "tasks"
              ? await pullTasksIncrementalAction()
              : await pullProjectsIncrementalAction();

      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(res.detail);
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? "icon" : size}
      onClick={onClick}
      disabled={pending}
      title={label}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      {!iconOnly && label}
    </Button>
  );
}
