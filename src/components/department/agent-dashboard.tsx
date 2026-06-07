import { Suspense } from "react";
import Link from "next/link";
import { CheckSquare2, CalendarCheck, MessageCircle, Upload, Gauge, Clock, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ServerSession } from "@/lib/auth-server";
import { getEmployeePerformance, type DeptScope, type EmployeePerfRow } from "@/lib/data/department";

const NA = "—";

function MyPerformance({ row }: { row: EmployeePerfRow | undefined }) {
  const cells: { icon: typeof Gauge; label: string; value: string; tone: string }[] = [
    { icon: CheckSquare2, label: "مهام مُسندة", value: String(row?.assigned ?? 0), tone: "text-cyan" },
    { icon: CheckSquare2, label: "مكتملة", value: String(row?.completed ?? 0), tone: "text-cc-green" },
    { icon: AlertTriangle, label: "متأخرة", value: String(row?.overdue ?? 0), tone: (row?.overdue ?? 0) > 0 ? "text-cc-red" : "text-muted-foreground" },
    {
      icon: Gauge,
      label: "الالتزام بالمواعيد",
      value: row?.onTimePct == null ? NA : `${row.onTimePct}%`,
      tone: row?.onTimePct == null ? "text-muted-foreground" : row.onTimePct >= 85 ? "text-cc-green" : row.onTimePct >= 70 ? "text-amber" : "text-cc-red",
    },
    {
      icon: Clock,
      label: "متوسط زمن الإنجاز",
      value: row?.avgCompletionHours == null ? NA : `${row.avgCompletionHours} س`,
      tone: "text-foreground",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-4">
            <c.icon className={cn("size-4", c.tone)} />
            <p className={cn("mt-2 text-2xl font-bold tabular-nums", c.tone)}>{c.value}</p>
            <p className="text-[11px] text-muted-foreground">{c.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function MyPerformanceSection({ scope }: { scope: DeptScope }) {
  const rows = await getEmployeePerformance(scope);
  return <MyPerformance row={rows[0]} />;
}

const QUICK_LINKS: { href: string; label: string; icon: typeof CheckSquare2 }[] = [
  { href: "/tasks", label: "مهامي", icon: CheckSquare2 },
  { href: "/uploads", label: "رفع اليوم", icon: Upload },
  { href: "/my-activities", label: "أنشطتي", icon: CalendarCheck },
  { href: "/messages", label: "المحادثات", icon: MessageCircle },
];

export function AgentDashboard({
  session,
  employeeId,
}: {
  session: ServerSession;
  employeeId: string;
}) {
  const scope: DeptScope = { orgId: session.orgId, departmentId: null, memberEmployeeIds: [employeeId] };

  return (
    <div>
      <PageHeader title={`مرحبًا ${session.fullName}`} description="مساحتك الشخصية: مهامك وأداؤك" />

      <section className="mb-8">
        <SectionTitle title="أدائي" description="مؤشرات أدائك الشخصية" />
        <Suspense fallback={<Skeleton className="h-[110px] rounded-2xl" />}>
          <MyPerformanceSection scope={scope} />
        </Suspense>
      </section>

      <section className="mb-8">
        <SectionTitle title="روابط سريعة" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK_LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              <Card className="transition-colors hover:bg-soft-1">
                <CardContent className="flex items-center gap-3 p-4">
                  <l.icon className="size-5 text-cyan" />
                  <span className="text-sm font-medium">{l.label}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
