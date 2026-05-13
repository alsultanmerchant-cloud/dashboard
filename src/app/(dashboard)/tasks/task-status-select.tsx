"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TASK_STATUSES, type TaskStatus } from "@/lib/labels";
import { updateTaskStatusAction } from "./_actions";

export function TaskStatusSelect({
  taskId, currentStatus,
}: {
  taskId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const t = useTranslations("TaskLabels.status");
  const tToast = useTranslations("TaskStatusSelect");
  const labelFor = (s: string) =>
    t.has(s as TaskStatus) ? t(s as TaskStatus) : s;

  return (
    <div className="flex items-center gap-2">
      <Select
        value={currentStatus}
        onValueChange={(value) => {
          if (value === currentStatus) return;
          start(async () => {
            const res = await updateTaskStatusAction({ taskId, status: value });
            if ("error" in res) toast.error(res.error);
            else {
              toast.success(tToast("changed", { label: labelFor(value) }));
              router.refresh();
            }
          });
        }}
      >
        <SelectTrigger className="min-w-36">
          <SelectValue>{labelFor(currentStatus)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {TASK_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{labelFor(s)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
