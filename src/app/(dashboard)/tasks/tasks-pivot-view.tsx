import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TASK_STAGES, TASK_STAGE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { ListTaskRow } from "./_loaders";

const UNASSIGNED = "__unassigned__";

export function TasksPivotView({ tasks }: { tasks: ListTaskRow[] }) {
  const assigneeNames = new Map<string, string>();
  for (const t of tasks) {
    const agent = t.role_slots?.agent;
    const key = agent?.id ?? UNASSIGNED;
    const label = agent?.full_name ?? "غير معيّن";
    if (!assigneeNames.has(key)) assigneeNames.set(key, label);
  }
  const assigneeKeys = Array.from(assigneeNames.keys()).sort((a, b) => {
    if (a === UNASSIGNED) return 1;
    if (b === UNASSIGNED) return -1;
    return assigneeNames.get(a)!.localeCompare(assigneeNames.get(b)!, "ar");
  });

  const counts = new Map<string, number>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const t of tasks) {
    const stage = t.stage;
    const aKey = t.role_slots?.agent?.id ?? UNASSIGNED;
    const cellKey = `${stage}::${aKey}`;
    counts.set(cellKey, (counts.get(cellKey) ?? 0) + 1);
    rowTotals.set(stage, (rowTotals.get(stage) ?? 0) + 1);
    colTotals.set(aKey, (colTotals.get(aKey) ?? 0) + 1);
  }

  return (
    <div className="overflow-auto rounded-2xl border border-soft bg-card/30">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky right-0 bg-card/95 text-right">
              المرحلة
            </TableHead>
            {assigneeKeys.map((k) => (
              <TableHead key={k} className="text-center">
                {assigneeNames.get(k)}
              </TableHead>
            ))}
            <TableHead className="text-center font-bold">الإجمالي</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {TASK_STAGES.map((stage) => {
            const rowTotal = rowTotals.get(stage) ?? 0;
            if (rowTotal === 0) return null;
            return (
              <TableRow key={stage}>
                <TableCell className="sticky right-0 bg-card/95 font-medium">
                  {TASK_STAGE_LABELS[stage]}
                </TableCell>
                {assigneeKeys.map((k) => {
                  const v = counts.get(`${stage}::${k}`) ?? 0;
                  return (
                    <TableCell
                      key={k}
                      className={cn(
                        "text-center tabular-nums",
                        v === 0 && "text-muted-foreground/50",
                      )}
                    >
                      {v || "—"}
                    </TableCell>
                  );
                })}
                <TableCell className="text-center font-semibold tabular-nums">
                  {rowTotal}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow>
            <TableCell className="sticky right-0 bg-card/95 font-bold">
              الإجمالي
            </TableCell>
            {assigneeKeys.map((k) => (
              <TableCell key={k} className="text-center font-semibold tabular-nums">
                {colTotals.get(k) ?? 0}
              </TableCell>
            ))}
            <TableCell className="text-center font-bold tabular-nums">
              {tasks.length}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
