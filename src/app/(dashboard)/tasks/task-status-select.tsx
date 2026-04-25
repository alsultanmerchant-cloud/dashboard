"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TASK_STATUS_LABELS, TASK_STATUSES } from "@/lib/labels";
import { updateTaskStatusAction } from "./_actions";

export function TaskStatusSelect({
  taskId, currentStatus,
}: {
  taskId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

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
              toast.success(`تم تغيير الحالة إلى ${TASK_STATUS_LABELS[value as keyof typeof TASK_STATUS_LABELS]}`);
              router.refresh();
            }
          });
        }}
      >
        <SelectTrigger className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TASK_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{TASK_STATUS_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
