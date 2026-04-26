import { BarChart3, Briefcase, ListTodo, Inbox, Users, Sparkles } from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { ServiceBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";

async function getServiceBreakdown(orgId: string) {
  const { data: services } = await supabaseAdmin
    .from("services")
    .select("id, name, slug")
    .eq("organization_id", orgId);
  if (!services) return [];

  const { data: ps } = await supabaseAdmin
    .from("project_services")
    .select("service_id")
    .eq("organization_id", orgId);

  const counts: Record<string, number> = {};
  for (const row of ps ?? []) counts[row.service_id] = (counts[row.service_id] ?? 0) + 1;
  return services.map((s) => ({ ...s, projectCount: counts[s.id] ?? 0 }));
}

async function getRollupStats(orgId: string) {
  const [clients, projects, tasks, handovers, employees] = await Promise.all([
    supabaseAdmin.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabaseAdmin.from("projects").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabaseAdmin.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabaseAdmin.from("sales_handover_forms").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabaseAdmin.from("employee_profiles").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
  ]);
  return {
    clients: clients.count ?? 0,
    projects: projects.count ?? 0,
    tasks: tasks.count ?? 0,
    handovers: handovers.count ?? 0,
    employees: employees.count ?? 0,
  };
}

export default async function ReportsPage() {
  const session = await requireSession();
  const [breakdown, totals] = await Promise.all([
    getServiceBreakdown(session.orgId),
    getRollupStats(session.orgId),
  ]);

  const maxCount = Math.max(1, ...breakdown.map((s) => s.projectCount));

  return (
    <div>
      <PageHeader
        title="التقارير"
        description="ملخصات تنفيذية على الوكالة. هذه نسخة أولية — تقارير مفصلة لكل خدمة وكل قسم تأتي في مرحلة لاحقة."
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Sparkles className="size-3 text-cyan" />
            تقارير موسّعة في مرحلة 9
          </Badge>
        }
      />

      <SectionTitle title="نظرة شاملة" description="إحصاءات مجمّعة على مستوى الوكالة" />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <MetricCard label="العملاء" value={totals.clients} icon={<Users className="size-5" />} />
        <MetricCard label="المشاريع" value={totals.projects} tone="info" icon={<Briefcase className="size-5" />} />
        <MetricCard label="المهام" value={totals.tasks} tone="success" icon={<ListTodo className="size-5" />} />
        <MetricCard label="نماذج التسليم" value={totals.handovers} tone="warning" icon={<Inbox className="size-5" />} />
        <MetricCard label="الموظفون" value={totals.employees} tone="purple" icon={<Users className="size-5" />} />
      </div>

      <SectionTitle title="توزيع الخدمات على المشاريع" description="عدد المشاريع المرتبطة بكل خدمة" />
      {breakdown.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-white/10 bg-card/30 px-4 py-6 text-center">
          لا توجد خدمات بعد.
        </p>
      ) : (
        <Card>
          <CardContent className="p-5 space-y-4">
            {breakdown.map((s) => {
              const pct = (s.projectCount / maxCount) * 100;
              return (
                <div key={s.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <ServiceBadge slug={s.slug} name={s.name} />
                    <span className="text-sm font-bold tabular-nums">{s.projectCount}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-white/[0.05] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-cyan to-cc-purple"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="mt-10 rounded-2xl border border-cyan/20 bg-cyan-dim/20 p-5 flex items-start gap-3">
        <BarChart3 className="size-5 text-cyan shrink-0 mt-0.5" />
        <div className="text-sm text-foreground/90 leading-relaxed">
          هذه النسخة تكتفي بنظرة عامة + توزيع الخدمات. التقارير المفصلة (أداء الفرق، رؤية ربع سنوية، تصدير PDF/Excel، فلاتر زمنية متقدمة) جزء من المرحلة التالية بعد جمع متطلبات الإدارة.
        </div>
      </div>
    </div>
  );
}
