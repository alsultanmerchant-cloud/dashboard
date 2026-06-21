import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { FileSignature, ArrowUpLeft, Briefcase } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import {
  getContractById,
  getContractInstallments,
  getContractCycles,
  getClientSiblingContracts,
} from "@/lib/data/contracts";
import { getContractActivityBundle } from "@/lib/data/entity-activity";
import { EntityActivityFeed } from "@/components/activity/entity-activity-feed";
import { EntityCommentComposer } from "@/components/activity/entity-comment-composer";
import { PageHeader } from "@/components/page-header";
import { RefreshFromSheetButton } from "./refresh-from-sheet-button";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { formatShortDate } from "@/lib/utils-format";
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

function translateStatus(t: Awaited<ReturnType<typeof getTranslations>>, key: string) {
  switch (key) {
    case "active":
    case "hold":
    case "closed":
    case "expired":
    case "renewed":
    case "lost":
      return t(`grid.statusLabels.${key}` as const);
    default:
      return STATUS_LABEL[key] ?? key;
  }
}

function translateTarget(t: Awaited<ReturnType<typeof getTranslations>>, key: string) {
  switch (key) {
    case "On-Target":
      return t("grid.targetLabels.onTarget");
    case "Overdue":
      return t("grid.targetLabels.overdue");
    case "Lost":
      return t("grid.targetLabels.lost");
    case "Renewed":
      return t("grid.targetLabels.renewed");
    default:
      return TARGET_LABEL[key] ?? key;
  }
}

function translateCycleState(t: Awaited<ReturnType<typeof getTranslations>>, key: string) {
  switch (key) {
    case "pending":
    case "active":
    case "done":
    case "overdue":
    case "skipped":
      return t(`detail.sections.cycles.states.${key}` as const);
    default:
      return CYCLE_STATE[key] ?? key;
  }
}

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
  const t = await getTranslations("ContractsPage");
  const locale = await getLocale();
  const { id } = await params;

  const contract = await getContractById(session.orgId, id);
  if (!contract) notFound();

  const [installments, cycles, siblings, activityBundle] =
    await Promise.all([
      getContractInstallments(session.orgId, id),
      getContractCycles(session.orgId, id),
      getClientSiblingContracts(
        session.orgId,
        (contract.client as { id?: string } | null)?.id ?? "",
        id,
      ),
      getContractActivityBundle(
        session.orgId,
        id,
        (contract.external_id as string | null) ?? null,
      ),
    ]);
  const { activity, mentionable, events } = activityBundle;

  const canManage = hasPermission(session, "contract.manage");

  const client = contract.client as {
    id?: string;
    name?: string;
    external_id?: string | null;
  } | null;
  // Sheet-sourced clients carry a "C27"-style external id; only those can be
  // re-pulled from the Google Sheet per-contract.
  const sheetClientId =
    client?.external_id && /^C\d+$/i.test(client.external_id)
      ? client.external_id
      : null;
  const am = contract.am as { full_name?: string } | null;
  const type = contract.type as { key?: string; name_ar?: string } | null;
  const pkg = contract.package as { name_ar?: string; grace_days?: number } | null;
  const project = contract.project as { id?: string; name?: string } | null;

  const total = Number(contract.total_value || 0);
  const paid = Number(contract.paid_value || 0);
  const outstanding = total - paid;
  const nextContractValue =
    contract.next_contract_value == null ? null : Number(contract.next_contract_value);
  const repeatedServicesValue =
    contract.repeated_services_value == null ? null : Number(contract.repeated_services_value);
  const paymentStatus = (contract.payment_status as string | null) ?? null;

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
          <div className="flex items-center gap-3">
            {canManage && sheetClientId && (
              <RefreshFromSheetButton clientExternalId={sheetClientId} />
            )}
            <Link
              href="/contracts"
              className="text-xs text-cyan hover:underline inline-flex items-center gap-1"
            >
              <ArrowUpLeft className="size-3 icon-flip-rtl" />
              {t("title")}
            </Link>
          </div>
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
              {t("detail.hold.active")}
              {holdStart ? ` ${t("detail.hold.since")} ${formatShortDate(holdStart, locale)}` : ""}
              {holdEnd ? (
                <>
                  {" — "}
                  {t("detail.hold.until")}{" "}
                  <strong className="font-semibold">{formatShortDate(holdEnd, locale)}</strong>
                </>
              ) : null}
            </span>
          ) : (
            <span>{t("detail.hold.wasHeldThisMonth")}</span>
          )}
        </div>
      )}

      {siblings.length > 0 && (
        <div className="mb-4 rounded-xl border border-cyan/25 bg-cyan-dim/30 px-4 py-3">
          <p className="mb-2 text-sm">
            {t("detail.siblings.prefix")}{" "}
            <strong className="font-semibold">
              {t("detail.siblings.count", { count: siblings.length })}
            </strong>{" "}
            {t("detail.siblings.suffix")}
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
                  {translateStatus(t, s.status)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MetricCard
          label={t("detail.metrics.total")}
          value={formatCurrency(total)}
          icon={<FileSignature className="size-5" />}
          tone="default"
        />
        <MetricCard label={t("detail.metrics.paid")} value={formatCurrency(paid)} tone="success" />
        <MetricCard
          label={t("detail.metrics.outstanding")}
          value={formatCurrency(outstanding)}
          tone={outstanding > 0 ? "warning" : "default"}
        />
        <MetricCard
          label={t("detail.metrics.status")}
          value={translateStatus(t, contract.status)}
          tone={contract.status === "active" ? "info" : "default"}
        />
      </div>

      <Card className="mb-6">
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <DetailField label={t("detail.fields.accountManager")} value={am?.full_name ?? "—"} />
          <DetailField
            label={t("detail.fields.startDate")}
            value={formatShortDate(contract.start_date as string, locale)}
          />
          <DetailField
            label={t("detail.fields.endDate")}
            value={formatShortDate(contract.end_date as string | null, locale)}
          />
          <DetailField
            label={t("detail.fields.duration")}
            value={String(contract.duration_months ?? "—")}
          />
          <DetailField
            label={t("detail.fields.target")}
            value={translateTarget(t, contract.target as string)}
          />
          <DetailField
            label={t("detail.fields.paymentStatus")}
            value={
              paymentStatus === "Installments"
                ? t("grid.paymentLabels.installments")
                : paymentStatus === "Complete"
                  ? t("grid.paymentLabels.complete")
                  : "—"
            }
          />
          <DetailField
            label={t("detail.fields.nextContractValue")}
            value={nextContractValue == null ? "—" : formatCurrency(nextContractValue)}
          />
          <DetailField
            label={t("detail.fields.repeatedServicesValue")}
            value={repeatedServicesValue == null ? "—" : formatCurrency(repeatedServicesValue)}
          />
          <DetailField
            label={t("detail.fields.graceDays")}
            value={pkg?.grace_days != null ? t("detail.days", { count: pkg.grace_days }) : "—"}
          />
          <DetailField
            label={t("detail.fields.project")}
            value={
              project?.id ? (
                <Link
                  href={`/projects/${project.id}`}
                  className="inline-flex items-center gap-1 text-cyan hover:underline"
                >
                  <Briefcase className="size-3.5" />
                  {project.name ?? t("detail.projectFallback")}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <DetailField
            label={t("detail.fields.notes")}
            value={(contract.notes as string | null) ?? "—"}
            className="col-span-2 md:col-span-4"
            valueClassName="whitespace-pre-wrap break-words [unicode-bidi:plaintext]"
          />
        </CardContent>
      </Card>

      {/* Installments timeline */}
      <SectionTitle
        title={t("detail.sections.installments.title")}
        description={t("detail.sections.installments.description")}
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
        title={t("detail.sections.cycles.title")}
        description={t("detail.sections.cycles.description")}
      />
      <div className="mb-8">
        {cycles.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              {t("detail.sections.cycles.empty")}
            </CardContent>
          </Card>
        ) : (
          <DataTableShell>
            <DataTable>
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>{t("detail.sections.cycles.headers.cycle")}</DataTableHeaderCell>
                  <DataTableHeaderCell>{t("detail.sections.cycles.headers.month")}</DataTableHeaderCell>
                  <DataTableHeaderCell>{t("detail.sections.cycles.headers.expectedMeeting")}</DataTableHeaderCell>
                  <DataTableHeaderCell>{t("detail.sections.cycles.headers.actualMeeting")}</DataTableHeaderCell>
                  <DataTableHeaderCell>{t("detail.sections.cycles.headers.delay")}</DataTableHeaderCell>
                  <DataTableHeaderCell>{t("detail.sections.cycles.headers.status")}</DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {cycles.map((c) => (
                  <DataTableRow key={c.id}>
                    <DataTableCell className="tabular-nums">{c.cycle_no}</DataTableCell>
                    <DataTableCell className="text-xs">
                      {formatShortDate(c.month, locale)}
                    </DataTableCell>
                    <DataTableCell className="text-xs">
                      {formatShortDate(c.expected_meeting_date, locale)}
                    </DataTableCell>
                    <DataTableCell className="text-xs">
                      {formatShortDate(c.actual_meeting_date, locale)}
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">
                      {c.meeting_delay_days ?? "—"}
                    </DataTableCell>
                    <DataTableCell>
                      {translateCycleState(t, c.state)}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </tbody>
            </DataTable>
          </DataTableShell>
        )}
      </div>

      {/* Unified activity feed (comments + sheet logs + contract events) */}
      {/* TODO(i18n): reuses the events-section labels — a dedicated
          `detail.sections.activity` key pair would read better here. */}
      <SectionTitle
        title={t("detail.sections.events.title")}
        description={t("detail.sections.events.description")}
      />
      <div className="mb-4">
        <EntityActivityFeed items={activity} />
      </div>
      <EntityCommentComposer
        entityType="contract"
        entityId={contract.id}
        mentionable={mentionable}
        floating
      />
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
