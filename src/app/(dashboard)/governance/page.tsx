import {
  ShieldCheck, FileWarning, UserX, Clock, AlertTriangle,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import {
  getOdooGovernanceViolations,
  ODOO_GOVERNANCE_KIND_LABELS,
  type OdooGovernanceKind,
} from "@/lib/odoo/live";
import { ViolationsList } from "./violations-list";

export const dynamic = "force-dynamic";

const KIND_ICON: Record<OdooGovernanceKind, React.ReactNode> = {
  unowned_task: <UserX className="size-5" />,
  missing_deadline: <FileWarning className="size-5" />,
  stuck_in_review: <Clock className="size-5" />,
  overdue_no_progress: <AlertTriangle className="size-5" />,
};

const KIND_TONE: Record<OdooGovernanceKind, "warning" | "destructive" | "default"> = {
  unowned_task: "destructive",
  missing_deadline: "warning",
  stuck_in_review: "destructive",
  overdue_no_progress: "destructive",
};

export default async function GovernancePage() {
  await requirePagePermission("governance.view");
  const result = await getOdooGovernanceViolations();
  const { violations, countsByKind, total } = result;

  return (
    <div>
      <PageHeader
        title="مخالفات الحوكمة"
        description="قواعد الحوكمة محسوبة مباشرة من Odoo: مهام بلا منفّذ، بدون موعد نهائي، عالقة في المراجعة، أو متأخّرة ولم تُبدأ."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {(Object.keys(ODOO_GOVERNANCE_KIND_LABELS) as OdooGovernanceKind[]).map((k) => (
          <MetricCard
            key={k}
            label={ODOO_GOVERNANCE_KIND_LABELS[k]}
            value={countsByKind[k]}
            icon={KIND_ICON[k]}
            tone={countsByKind[k] > 0 ? KIND_TONE[k] : "default"}
          />
        ))}
      </div>

      <section>
        <h2 className="mb-3 text-base font-semibold">المخالفات المفتوحة ({total})</h2>
        {violations.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="size-6" />}
            title="لا توجد مخالفات مفتوحة"
            description="كل قواعد الحوكمة مُلتزَم بها في الوقت الراهن."
          />
        ) : (
          <ViolationsList items={violations} />
        )}
      </section>

      <div className="mt-8 rounded-2xl border border-cyan/20 bg-cyan-dim/20 p-4 text-xs text-foreground/90 leading-relaxed">
        المخالفات تُحسب لحظياً من Odoo عند كل فتح للصفحة — لا حاجة لزر &quot;حلّ&quot;. لإغلاق مخالفة، عدّل المهمة في Odoo (أضف منفّذًا، ضع موعدًا، حرّكها للمرحلة التالية).
      </div>
    </div>
  );
}
