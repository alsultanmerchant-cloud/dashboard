"use client";

// Odoo form-header favorite star. Optimistic toggle; reverts on error.

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toggleTaskStarAction } from "./_star_action";

export function TaskStarToggle({
  taskId,
  initialStarred,
}: {
  taskId: string;
  initialStarred: boolean;
}) {
  const t = useTranslations("TaskDetailPage");
  const [starred, setStarred] = useState(initialStarred);
  const [pending, start] = useTransition();

  const toggle = () => {
    const next = !starred;
    setStarred(next);
    start(async () => {
      const res = await toggleTaskStarAction({ taskId, starred: next });
      if ("error" in res) {
        setStarred(!next);
        toast.error(res.error);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={starred}
      aria-label={starred ? t("star.unstar") : t("star.star")}
      title={starred ? t("star.unstar") : t("star.star")}
      className={cn(
        "mt-0.5 shrink-0 rounded-full p-1 transition-colors disabled:opacity-50",
        starred ? "text-amber" : "text-muted-foreground/40 hover:text-amber",
      )}
    >
      <Star className={cn("size-5", starred && "fill-current")} />
    </button>
  );
}
