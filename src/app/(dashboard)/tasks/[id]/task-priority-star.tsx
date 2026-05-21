"use client";

// Odoo-style inline "High priority" star next to the task title (§TASK-INFO-2).
// Odoo's priority is a single-star radio: filled = High, empty = Normal.
// We mirror that toggle high ↔ medium (medium is our schema default).

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setTaskPriorityAction } from "./_actions";

type Priority = "low" | "medium" | "high";

export function TaskPriorityStar({
  taskId,
  initialPriority,
}: {
  taskId: string;
  initialPriority: Priority;
}) {
  const t = useTranslations("TaskDetailPage.priorityStar");
  const [priority, setPriority] = useState<Priority>(initialPriority);
  const [pending, start] = useTransition();
  const isHigh = priority === "high";

  function toggle() {
    const next: Priority = isHigh ? "medium" : "high";
    setPriority(next);
    start(async () => {
      const res = await setTaskPriorityAction({ task_id: taskId, priority: next });
      if ("error" in res) {
        setPriority(priority);
        toast.error(res.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={isHigh}
      aria-label={isHigh ? t("unsetHigh") : t("setHigh")}
      title={isHigh ? t("unsetHigh") : t("setHigh")}
      className={cn(
        "shrink-0 rounded-full p-1 transition-colors disabled:opacity-50",
        isHigh ? "text-amber" : "text-muted-foreground/40 hover:text-amber",
      )}
    >
      <Star className={cn("size-4", isHigh && "fill-current")} />
    </button>
  );
}
