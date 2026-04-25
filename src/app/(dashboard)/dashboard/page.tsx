"use client";

import {
  Briefcase,
  CheckCircle2,
  AlertTriangle,
  Bell,
  Users,
  Target,
  Sparkles,
  Inbox,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="نظرة عامة"
        description="ستعرض هذه اللوحة الإشارات الأهم: العملاء النشطون، المشاريع الجارية، المهام المتأخرة، والأحداث الذكية."
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Sparkles className="size-3 text-cyan" />
            تكتمل في مرحلة 6
          </Badge>
        }
      />

      <SectionTitle
        title="أرقام مبدئية"
        description="بطاقات الإحصاءات الفعلية ستُربط ببيانات الوكالة في مرحلة لاحقة."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="عملاء نشطون" value="—" icon={<Users className="size-5" />} tone="default" />
        <MetricCard label="مشاريع جارية" value="—" icon={<Briefcase className="size-5" />} tone="info" />
        <MetricCard label="مهام مفتوحة" value="—" icon={<CheckCircle2 className="size-5" />} tone="success" />
        <MetricCard label="مهام متأخرة" value="—" icon={<AlertTriangle className="size-5" />} tone="destructive" />
        <MetricCard label="تسليمات جديدة" value="—" icon={<Inbox className="size-5" />} tone="warning" />
        <MetricCard label="مهام مكتملة هذا الأسبوع" value="—" icon={<Target className="size-5" />} tone="success" />
        <MetricCard label="تنبيهات لم تُقرأ" value="—" icon={<Bell className="size-5" />} tone="purple" />
        <MetricCard label="أحداث ذكية اليوم" value="—" icon={<Sparkles className="size-5" />} tone="default" />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <EmptyState
          title="آخر التسليمات"
          description="ستظهر هنا آخر نماذج التسليم الواردة من فريق المبيعات بعد ربط نموذج التسليم."
          variant="compact"
        />
        <EmptyState
          title="مهام متأخرة"
          description="قائمة المهام التي تجاوزت تاريخ التسليم."
          variant="compact"
        />
        <EmptyState
          title="نشاط الفريق"
          description="سير الأحداث الذكية وأحدث الأنشطة في الوكالة."
          variant="compact"
        />
      </div>
    </div>
  );
}
