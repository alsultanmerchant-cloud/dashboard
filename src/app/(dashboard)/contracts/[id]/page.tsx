import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSignature, ArrowUpLeft, Briefcase } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import {
  getContractById,
  getContractInstallments,
  getContractCycles,
  getContractEvents,
  getClientSiblingContracts,
} from "@/lib/data/contracts";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import {
  formatArabicShortDate,
  formatArabicDateTime,
} from "@/lib/utils-format";
import { EventRecordForm } from "./event-record-form";
import { InstallmentsEditor, type InstallmentRow } from "./installments-editor";

const STATUS_LABEL: Record<string, string> = {
  active: "نشط",
  hold: "مُعلَّق",
  lost: "مفقود",
  closed: "مغلق",
  renewed: "مُجدَّد",
};

const TARGET_LABEL: Record<string, string> = {
  "On-Target": "ضمن الهدف",
  Overdue: "متأخر",
  Lost: "مفقود",
  Renewed: "مُجدَّد",
};

const CYCLE_STATE: Record<string, string> = {
  pending: "قيد الانتظار",
  active: "جارية",
  done: "مُكتمَلة",
  overdue: "متأخرة",
  skipped: "متخطّاة",
};

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 }).format(value);
}

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePagePermission("contract.view");
  const { id } = await params;

  const contract = await getContractById(session.orgId, id);
  if (!contract) notFound();

  const [installments, cycles, events, siblings] = await Promise.all([
    getContractInstallments(session.orgId, id),
    getContractCycles(session.orgId, id),
    getContractEvents(session.orgId, id, 50),
    getClientSiblingContracts(
      session.orgId,
      (contract.client as { id?: string } | null)?.id ?? "",
      id,
    ),
  ]);

  const canManage = hasPermission(session, "contract.manage");

  const client = contract.client as { id?: string; name?: string } | null;
  const am = contract.am as { full_name?: string } | null;
  const type = contract.type as { key?: string; name_ar?: string } | null;
  const pkg = contract.package as { name_ar?: string; grace_days?: number } | null;
  const project = contract.project as { id?: string; name?: string } | null;

  const total = Number(contract.total_value || 0);
  const paid = Number(contract.paid_value || 0);
  const outstanding = total - paid;

  // Hold awareness (gap G2): currently on hold, or any hold activity logged
  // this month — the team wants this visible at a glance on the contract.
  const contractAny = contract as Record<string, unknown>;
  const onHoldNow = contract.status === "hold";
  const holdEnd = contractAny.hold_end_date as string | null;
  const holdStart = contractAny.hold_started_at as string | null;
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartIso = monthStart.toISOString().slice(0, 10);
  const HOLD_EVENT_TYPES = new Set(["ON_HOLD", "HOLD_UPDATED", "HOLD_LIFTED"]);
  const heldThisMonth =
    onHoldNow ||
    (events as Array<{ event_type: string; occurred_at: string }>).some(
      (e) =>
        HOLD_EVENT_TYPES.has(e.event_type) &&
        e.occurred_at.slice(0, 10) >= monthStartIso,
    );
  const contractCode = (contractAny.contract_code as string | null) ?? null;

  return (
    <div>
      <PageHeader
        title={
          contractCode ? `${client?.name ?? "عقد"} · ${contractCode}` : (client?.name ?? "عقد")
        }
        description={`${type?.name_ar ?? "—"} · ${pkg?.name_ar ?? "—"}`}
        actions={
          <Link
            href="/contracts"
            className="text-xs text-cyan hover:underline inline-flex items-center gap-1"
          >
            <ArrowUpLeft className="size-3 icon-flip-rtl" />
            كل العقود
          </Link>
        }
      />

      {(onHoldNow || heldThisMonth) && (
        <div
          className={
            onHoldNow
              ? "mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
              : "mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/80"
          }
        >
          <span className="text-base">⏸</span>
          {onHoldNow ? (
            <span>
              العقد موقوف مؤقتًا
              {holdStart ? ` منذ ${formatArabicShortDate(holdStart)}` : ""}
              {holdEnd ? (
                <>
                  {" — "}
                  ينتهي الإيقاف في{" "}
                  <strong className="font-semibold">{formatArabicShortDate(holdEnd)}</strong>
                </>
              ) : null}
            </span>
          ) : (
            <span>كان هذا العقد موقوفًا خلال الشهر الحالي — راجعي سجل النشاط أدناه.</span>
          )}
        </div>
      )}

      {siblings.length > 0 && (
        <div className="mb-4 rounded-xl border border-cyan/25 bg-cyan-dim/30 px-4 py-3">
          <p className="mb-2 text-sm">
            📑 هذا العميل لديه{" "}
            <strong className="font-semibold">
              {siblings.length === 1
                ? "عقد آخر واحد"
                : `${siblings.length} عقود أخرى`}
            </strong>{" "}
            معنا:
          </p>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => (
              <Link
                key={s.id}
                href={`/contracts/${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-soft bg-card px-2.5 py-1.5 text-xs hover:border-cyan/40 transition-colors"
              >
                <span className="font-mono font-medium">{s.contract_code ?? "—"}</span>
                <span className="text-muted-foreground">
                  {s.type_label ?? "—"} · {s.package_names.slice(0, 2).join("، ") || "—"}
                  {s.package_names.length > 2 ? "…" : ""}
                </span>
                <span
                  className={
                    s.status === "active"
                      ? "rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300"
                      : s.status === "hold"
                        ? "rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
                        : "rounded-full bg-zinc-500/15 px-1.5 py-0.5 text-[10px] text-zinc-300"
                  }
                >
                  {STATUS_LABEL[s.status] ?? s.status}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MetricCard
          label="القيمة الإجمالية"
          value={formatCurrency(total)}
          icon={<FileSignature className="size-5" />}
          tone="default"
        />
        <MetricCard label="المدفوع" value={formatCurrency(paid)} tone="success" />
        <MetricCard
          label="المتبقّي"
          value={formatCurrency(outstanding)}
          tone={outstanding > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="الحالة"
          value={STATUS_LABEL[contract.status] ?? contract.status}
          tone={contract.status === "active" ? "info" : "default"}
        />
      </div>

      <Card className="mb-6">
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <DetailField label="مدير الحساب المسؤول" value={am?.full_name ?? "—"} />
          <DetailField
            label="تاريخ البدء"
            value={formatArabicShortDate(contract.start_date as string)}
          />
          <DetailField
            label="تاريخ الانتهاء"
            value={formatArabicShortDate(contract.end_date as string | null)}
          />
          <DetailField
            label="المدة (شهر)"
            value={String(contract.duration_months ?? "—")}
          />
          <DetailField
            label="الهدف"
            value={TARGET_LABEL[contract.target as string] ?? (contract.target as string)}
          />
          <DetailField
            label="مهلة سماح الدورة"
            value={pkg?.grace_days != null ? `${pkg.grace_days} يوم` : "—"}
          />
          <DetailField
            label="المشروع المرتبط"
            value={
              project?.id ? (
                <Link
                  href={`/projects/${project.id}`}
                  className="inline-flex items-center gap-1 text-cyan hover:underline"
                >
                  <Briefcase className="size-3.5" />
                  {project.name ?? "المشروع"}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <DetailField
            label="ملاحظات"
            value={(contract.notes as string | null) ?? "—"}
            className="col-span-2 md:col-span-4"
            valueClassName="whitespace-pre-wrap break-words [unicode-bidi:plaintext]"
          />
        </CardContent>
      </Card>

      {/* Installments timeline */}
      <SectionTitle
        title="جدول الدفعات"
        description="الدفعات المتوقّعة والمستلمة على هذا العقد"
      />
      <div className="mb-8">
        <InstallmentsEditor
          contractId={contract.id}
          canManage={canManage}
          rows={installments.map(
            (i): InstallmentRow => ({
              id: i.id,
              sequence: i.sequence,
              expected_date: i.expected_date,
              expected_amount: Number(i.expected_amount || 0),
              actual_date: i.actual_date,
              actual_amount: i.actual_amount == null ? null : Number(i.actual_amount),
              status: i.status,
            }),
          )}
        />
      </div>

      {/* Monthly cycles */}
      <SectionTitle
        title="الدورات الشهرية"
        description="متابعة شهرية مع تواريخ الاجتماع المتوقَّعة والفعلية"
      />
      <div className="mb-8">
        {cycles.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              لا توجد دورات شهرية بعد. سيتم إنشاؤها تلقائيًا أول كل شهر.
            </CardContent>
          </Card>
        ) : (
          <DataTableShell>
            <DataTable>
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>الدورة</DataTableHeaderCell>
                  <DataTableHeaderCell>الشهر</DataTableHeaderCell>
                  <DataTableHeaderCell>الاجتماع المتوقَّع</DataTableHeaderCell>
                  <DataTableHeaderCell>الاجتماع الفعلي</DataTableHeaderCell>
                  <DataTableHeaderCell>التأخّر (يوم)</DataTableHeaderCell>
                  <DataTableHeaderCell>الحالة</DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {cycles.map((c) => (
                  <DataTableRow key={c.id}>
                    <DataTableCell className="tabular-nums">{c.cycle_no}</DataTableCell>
                    <DataTableCell className="text-xs">
                      {formatArabicShortDate(c.month)}
                    </DataTableCell>
                    <DataTableCell className="text-xs">
                      {formatArabicShortDate(c.expected_meeting_date)}
                    </DataTableCell>
                    <DataTableCell className="text-xs">
                      {formatArabicShortDate(c.actual_meeting_date)}
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">
                      {c.meeting_delay_days ?? "—"}
                    </DataTableCell>
                    <DataTableCell>
                      {CYCLE_STATE[c.state] ?? c.state}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </tbody>
            </DataTable>
          </DataTableShell>
        )}
      </div>

      {/* Events log */}
      <SectionTitle
        title="سجل الأحداث"
        description="سجل التغييرات والملاحظات على العقد"
        actions={canManage ? <EventRecordForm contractId={contract.id} /> : null}
      />
      <div className="mb-4">
        {events.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              لا توجد أحداث مسجَّلة على هذا العقد بعد.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-white/[0.04]">
                {events.map((e) => {
                  const actor = e.actor as { full_name?: string } | null;
                  const payload = e.payload as Record<string, unknown> | null;
                  const note = (payload?.note as string | undefined) ?? null;
                  return (
                    <li key={e.id} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{e.event_type}</p>
                        {note && (
                          <p className="text-xs text-muted-foreground mt-0.5">{note}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {actor?.full_name ?? "—"}
                        </p>
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {formatArabicDateTime(e.occurred_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  className = "",
  valueClassName = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] uppercase text-muted-foreground tracking-wide">
        {label}
      </p>
      <p className={`mt-1 text-sm ${valueClassName}`}>{value}</p>
    </div>
  );
}
