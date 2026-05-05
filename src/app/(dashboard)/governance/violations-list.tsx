"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
type OdooGovernanceKind =
  | "unowned_task"
  | "missing_deadline"
  | "stuck_in_review"
  | "overdue_no_progress";

type OdooGovernanceViolation = {
  kind: OdooGovernanceKind;
  taskOdooId: number;
  taskName: string;
  projectId: number | null;
  projectName: string | null;
  stage: string;
  deadline: string | null;
};

const ODOO_GOVERNANCE_KIND_LABELS: Record<OdooGovernanceKind, string> = {
  unowned_task: "مهمة بلا منفّذ",
  missing_deadline: "مهمة بدون موعد نهائي",
  stuck_in_review: "عالقة في المراجعة",
  overdue_no_progress: "متأخّرة ولم تُبدأ",
};

const PAGE_SIZE = 30;

export function ViolationsList({ items }: { items: OdooGovernanceViolation[] }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const slice = useMemo(() => items.slice(0, visible), [items, visible]);
  const hasMore = visible < items.length;

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => Math.min(v + PAGE_SIZE, items.length));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, items.length]);

  return (
    <>
      <div className="space-y-2">
        {slice.map((row, i) => (
          <Card key={`${row.kind}-${row.taskOdooId}-${i}`} className="border-cc-red/30">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant="destructive" className="text-[10px]">
                      {ODOO_GOVERNANCE_KIND_LABELS[row.kind]}
                    </Badge>
                    <Link
                      href={`/tasks/odoo/${row.taskOdooId}`}
                      className="text-sm font-semibold hover:text-cyan inline-flex items-center gap-1"
                    >
                      <Briefcase className="size-3.5" />
                      {row.taskName}
                    </Link>
                    {row.projectId && row.projectName && (
                      <Link
                        href={`/projects/odoo/${row.projectId}`}
                        className="text-[11px] text-muted-foreground hover:text-cyan"
                      >
                        · {row.projectName}
                      </Link>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground" dir="ltr">
                    {row.deadline
                      ? `Deadline: ${row.deadline}`
                      : "No deadline set"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {hasMore && (
        <div
          ref={sentinelRef}
          className="mt-4 flex items-center justify-center py-4 text-xs text-muted-foreground"
        >
          عرض {visible} من {items.length} — مرّر للأسفل
        </div>
      )}
    </>
  );
}
