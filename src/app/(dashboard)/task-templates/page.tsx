import Link from "next/link";
import { ClipboardList, ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listTaskTemplates } from "@/lib/data/templates";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { ServiceBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";

export default async function TaskTemplatesPage() {
  const session = await requirePagePermission("templates.manage");
  const templates = await listTaskTemplates(session.orgId);

  return (
    <div>
      <PageHeader
        title="قوالب المهام"
        description="سير العمل الافتراضي لكل خدمة. عند إنشاء مشروع جديد بخدمة معينة، تُولَّد المهام تلقائيًا من قالبها."
      />

      {templates.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-6" />}
          title="لا توجد قوالب بعد"
          description="القوالب الافتراضية تُحمَّل من بيانات السيد. تحقق من تطبيق ميجريشن السيد في Supabase."
        />
      ) : (
        <>
          <SectionTitle title="القوالب المتاحة" description={`${templates.length} قالب نشط`} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => {
              const service = Array.isArray(t.service) ? t.service[0] : t.service;
              const itemCount = Array.isArray(t.task_template_items) ? t.task_template_items[0]?.count ?? 0 : 0;
              return (
                <Card key={t.id} className="transition-colors hover:border-cyan/40">
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold leading-tight">{t.name}</h3>
                      {service && <ServiceBadge slug={service.slug} name={service.name} />}
                    </div>
                    {t.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                    )}
                    <div className="flex items-center justify-between pt-1.5">
                      <span className="text-[11px] text-muted-foreground">
                        {itemCount} {itemCount === 1 ? "عنصر" : "عنصرًا"}
                      </span>
                      <Link
                        href={`/task-templates/${t.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-colors"
                      >
                        عرض التفاصيل
                        <ChevronLeft className="size-3.5 icon-flip-rtl" />
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
