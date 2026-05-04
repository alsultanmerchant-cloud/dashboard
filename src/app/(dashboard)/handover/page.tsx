import Link from "next/link";
import { Inbox, Send } from "lucide-react";
import { requirePagePermissionAny } from "@/lib/auth-server";
import { listHandovers } from "@/lib/data/handover";
import { listAccountManagers, listServices } from "@/lib/data/employees";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import {
  HandoverStatusBadge, UrgencyBadge,
} from "@/components/status-badges";
import { formatArabicDateTime } from "@/lib/utils-format";
import { Pagination } from "@/components/pagination";
import { HandoverForm } from "./handover-form";

const PAGE_SIZE = 25;

export default async function HandoverPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePagePermissionAny(["handover.create", "handover.manage"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [services, accountManagers, handoverPage] = await Promise.all([
    listServices(session.orgId),
    listAccountManagers(session.orgId),
    listHandovers(session.orgId, { page, pageSize: PAGE_SIZE }),
  ]);
  const { rows: handovers, total } = handoverPage;

  const amOptions = accountManagers.map((a) => ({
    id: a.id,
    label: a.full_name + (a.job_title ? ` — ${a.job_title}` : ""),
  }));

  return (
    <div>
      <PageHeader
        title="التسليم من المبيعات"
        description="نموذج موحّد لتحويل صفقة مغلقة إلى مشروع تشغيلي. عند الإرسال يتم إنشاء العميل والمشروع وتوليد المهام وتنبيه مدير الحساب — كله في خطوة واحدة."
      />

      <HandoverForm services={services} accountManagers={amOptions} />

      <div className="mt-12">
        <SectionTitle
          title="آخر التسليمات"
          description={`${total} نموذج مسجَّل`}
        />
        {total === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title="لا توجد تسليمات بعد"
            description="ستظهر هنا كل نماذج التسليم فور إرسالها."
            variant="compact"
          />
        ) : (
          <div className="space-y-2.5">
            {handovers.map((h) => {
              const am = Array.isArray(h.assigned_account_manager)
                ? h.assigned_account_manager[0]
                : h.assigned_account_manager;
              const project = Array.isArray(h.project) ? h.project[0] : h.project;
              return (
                <Card key={h.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="text-sm font-semibold">{h.client_name}</h3>
                          <HandoverStatusBadge status={h.status} />
                          <UrgencyBadge level={h.urgency_level} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {h.selected_service_ids.length} خدمة
                          {am ? ` · مدير الحساب: ${am.full_name}` : ""}
                          {h.client_phone ? ` · ${h.client_phone}` : ""}
                        </p>
                        {h.sales_notes && (
                          <p className="mt-2 text-xs text-foreground/80 line-clamp-2 leading-relaxed">
                            {h.sales_notes}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 text-[11px] text-muted-foreground shrink-0">
                        <span dir="ltr">{formatArabicDateTime(h.created_at)}</span>
                        {project?.id && (
                          <Link
                            href={`/projects/${project.id}`}
                            className="inline-flex items-center gap-1 text-cyan hover:text-cyan/80 transition-colors"
                          >
                            <Send className="size-3 icon-flip-rtl" />
                            عرض المشروع
                          </Link>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {total > 0 && (
          <div className="mt-4">
            <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} />
          </div>
        )}
      </div>
    </div>
  );
}
