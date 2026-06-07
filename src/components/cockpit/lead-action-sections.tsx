import Link from "next/link";
import { Siren, AlertTriangle, Clock, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { BlockerItem, EscalationToMe } from "@/lib/data/cockpit";
import { TaskRow, cleanTaskTitle } from "@/components/cockpit/task-row";

function PanelHeader({ icon: Icon, tone, title, count, badge }: {
  icon: typeof Siren; tone: string; title: string; count: number; badge?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2 text-xs font-semibold">
        <span className={cn("flex size-7 items-center justify-center rounded-lg", tone)}><Icon className="size-3.5" /></span>
        {title}
        <span className="tabular-nums text-muted-foreground">({count})</span>
      </span>
      {badge}
    </div>
  );
}

export function TeamBlockers({ items }: { items: BlockerItem[] }) {
  const hasItems = items.length > 0;
  return (
    <Card className={cn("h-full", hasItems && "border-amber/25")}>
      <CardContent className="p-4">
        <PanelHeader icon={AlertTriangle} tone="bg-amber-dim text-amber" title="معطّلات تحتاج تدخّلك" count={items.length} />
        {!hasItems ? (
          <p className="text-[11px] text-muted-foreground">لا توجد مهام متعثّرة لدى الفريق 🎉</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((b) => (
              <TaskRow
                key={b.id}
                href={`/tasks/${b.id}`}
                title={b.title}
                taskCode={b.taskCode}
                meta={b.assigneeName}
                stage={b.stage}
                priority={b.priority}
                progressPercent={b.progressPercent}
                accent={b.reason === "overdue" ? "red" : "amber"}
                trailing={
                  b.reason === "overdue" ? (
                    <span className="shrink-0 rounded-full bg-red-dim px-2 py-0.5 text-[10px] font-semibold text-cc-red">متأخرة</span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-dim px-2 py-0.5 text-[10px] font-medium tabular-nums text-amber">
                      <Clock className="size-3" /> {b.idleDays}ي
                    </span>
                  )
                }
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EscalationsToMe({ items }: { items: EscalationToMe[] }) {
  const hasItems = items.length > 0;
  return (
    <Card className={cn("h-full", hasItems && "border-cc-red/25")}>
      <CardContent className="p-4">
        <PanelHeader icon={Siren} tone="bg-red-dim text-cc-red" title="تصعيدات إليك" count={items.length} />
        {!hasItems ? (
          <p className="text-[11px] text-muted-foreground">لا تصعيدات مفتوحة إليك.</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((e) => (
              <Link key={e.id} href={e.taskId ? `/tasks/${e.taskId}` : "/escalations"} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-2.5 py-2 text-xs transition-all hover:border-cyan/40">
                <span className="truncate font-medium">{e.taskTitle ? cleanTaskTitle(e.taskTitle) : "مهمة"}</span>
                <span className="shrink-0 rounded-full bg-red-dim px-2 py-0.5 text-[10px] font-medium text-cc-red">مستوى {e.level}</span>
              </Link>
            ))}
          </div>
        )}
        <div className="mt-3 rounded-xl border border-dashed border-cc-purple/30 bg-purple-dim/40 p-2.5">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-cc-purple">
            <Sparkles className="size-3" /> تنبيهات المخاطر الذكية — قريبًا
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
