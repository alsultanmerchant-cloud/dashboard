"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X, Clock, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { approveTaskAction, rejectTaskAction } from "@/app/(dashboard)/tasks/[id]/_actions";
import type { ReviewItem } from "@/lib/data/cockpit";
import { cleanTaskTitle } from "@/components/cockpit/task-row";

function Row({ item }: { item: ReviewItem }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const act = (kind: "approve" | "reject") =>
    start(async () => {
      setErr(null);
      const res = kind === "approve"
        ? await approveTaskAction({ taskId: item.id })
        : await rejectTaskAction({ taskId: item.id });
      if (res && "error" in res && res.error) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });

  return (
    <div className={cn("rounded-lg border px-3 py-2", item.breachedSla ? "border-cc-red/35 bg-cc-red/5" : "border-border/60")}>
      <div className="flex items-center justify-between gap-3">
        <Link href={`/tasks/${item.id}`} className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold hover:text-cyan">{cleanTaskTitle(item.title)}</span>
          <span className="text-[10px] text-muted-foreground">
            {item.taskCode ? `${item.taskCode} · ` : ""}{item.projectName ?? ""}
          </span>
        </Link>
        <span className={cn("inline-flex shrink-0 items-center gap-1 text-[10px] tabular-nums", item.breachedSla ? "text-cc-red font-semibold" : "text-muted-foreground")}>
          <Clock className="size-3" /> {item.hoursWaiting}س
        </span>
        {item.approvalPending ? (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="outline" className="h-7 px-2 text-cc-green" disabled={pending} onClick={() => act("approve")}>
              <Check className="size-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-cc-red" disabled={pending} onClick={() => act("reject")}>
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <Link href={`/tasks/${item.id}`} className="shrink-0 text-[10px] text-cyan hover:underline">مراجعة</Link>
        )}
      </div>
      {err && <p className="mt-1 text-[10px] text-cc-red">{err}</p>}
    </div>
  );
}

export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const breached = items.filter((i) => i.breachedSla).length;
  return (
    <Card className={cn("h-full", items.length > 0 && "border-cc-purple/25")}>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="inline-flex items-center gap-2 text-xs font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-purple-dim text-cc-purple"><Clock className="size-3.5" /></span>
            بانتظار مراجعتي
            <span className="tabular-nums text-muted-foreground">({items.length})</span>
          </p>
          {breached > 0 && (
            <span className="rounded-full bg-red-dim px-2 py-0.5 text-[10px] font-semibold text-cc-red">
              {breached} تجاوز SLA
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">لا توجد مهام بانتظار مراجعتك 🎉</p>
        ) : (
          <div className="space-y-1.5">
            {items.slice(0, 10).map((it) => <Row key={it.id} item={it} />)}
          </div>
        )}
        <Link href="/tasks?stage=manager_review" className="mt-2 inline-flex items-center gap-1 text-[11px] text-cyan hover:underline">
          كل مهام المراجعة <ArrowLeft className="size-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
