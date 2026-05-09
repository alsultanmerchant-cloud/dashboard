import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  Briefcase, Calendar, User, ListTodo, PauseCircle,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getProject, getProjectTaskSummary } from "@/lib/data/projects";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  ProjectStatusBadge, PriorityBadge, ServiceBadge,
} from "@/components/status-badges";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatArabicShortDate } from "@/lib/utils-format";
import { EmptyState } from "@/components/empty-state";
import Link from "next/link";
import { GanttChart } from "lucide-react";
import { TaskBoard, type BoardTask } from "./task-board";
import { BulkReassignDialog } from "./bulk-reassign-dialog";
import { listEmployees } from "@/lib/data/employees";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MessageButton } from "@/components/dm/message-button";
import { listServiceCategories } from "@/lib/data/service-categories";
import { WhatsAppPanel, type WhatsAppGroupRow } from "./whatsapp-panel";
import { HoldDialog } from "./hold-dialog";
import { listProjectWhatsAppGroups, suggestGroupName } from "@/lib/data/whatsapp";
import { listProjectRenewalCycles, daysUntilRenewal } from "@/lib/data/renewals";
import { RenewalsPanel } from "./renewals/renewals-panel";
import { loadTaskBoardForGlobalView } from "../../tasks/_loaders";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requirePagePermission("projects.view");
  const project = await getProject(session.orgId, id);
  if (!project) notFound();

  const [summary, tasks] = await Promise.all([
    getProjectTaskSummary(session.orgId, project.id),
    loadTaskBoardForGlobalView(session.orgId, { projectId: project.id }),
  ]);
  const renewalDays = daysUntilRenewal((project as { next_renewal_date?: string | null }).next_renewal_date ?? null);
  const canManageRenewal =
    session.isOwner || session.permissions.has("renewal.manage");

  const client = Array.isArray(project.client) ? project.client[0] : project.client;
  const am = Array.isArray(project.account_manager) ? project.account_manager[0] : project.account_manager;
  const socialSp = Array.isArray((project as { social_specialist?: unknown }).social_specialist)
    ? ((project as { social_specialist?: { id: string; full_name: string; job_title: string | null }[] }).social_specialist?.[0] ?? null)
    : ((project as { social_specialist?: { id: string; full_name: string; job_title: string | null } | null }).social_specialist ?? null);
  const mediaSp = Array.isArray((project as { media_specialist?: unknown }).media_specialist)
    ? ((project as { media_specialist?: { id: string; full_name: string; job_title: string | null }[] }).media_specialist?.[0] ?? null)
    : ((project as { media_specialist?: { id: string; full_name: string; job_title: string | null } | null }).media_specialist ?? null);
  const seoSp = Array.isArray((project as { seo_specialist?: unknown }).seo_specialist)
    ? ((project as { seo_specialist?: { id: string; full_name: string; job_title: string | null }[] }).seo_specialist?.[0] ?? null)
    : ((project as { seo_specialist?: { id: string; full_name: string; job_title: string | null } | null }).seo_specialist ?? null);
  const specialists: { label: string; emp: { full_name: string; job_title: string | null } | null }[] = [
    { label: "السوشال", emp: socialSp },
    { label: "الميديا", emp: mediaSp },
    { label: "السيو", emp: seoSp },
  ];

  return (
    <div>
      <PageHeader
        title={
          ((project as { project_code?: string | null }).project_code
            ? `${(project as { project_code?: string | null }).project_code} · `
            : "") + project.name
        }
        description={project.description ?? undefined}
        breadcrumbs={[{ label: "المشاريع", href: "/projects" }, { label: project.name }]}
        actions={
          <div className="flex items-center gap-2">
            <HoldDialog
              projectId={project.id}
              status={project.status}
              heldAt={project.held_at}
              holdReason={project.hold_reason}
            />
            {renewalDays !== null && renewalDays >= 0 && renewalDays <= 14 && (
              <span
                className="inline-flex items-center rounded-full border border-amber/40 bg-amber-dim px-2 py-0.5 text-[10px] font-semibold text-amber"
                title="موعد التجديد قريب"
              >
                تجديد خلال {renewalDays} يوم
              </span>
            )}
            <PriorityBadge priority={project.priority} />
            <ProjectStatusBadge status={project.status} />
            <Link
              href={`/projects/${project.id}/gantt`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted/50 transition-colors"
            >
              <GanttChart className="size-3.5" />
              مخطط جانت
            </Link>
            {session.permissions.has("tasks.manage") && (
              <Suspense fallback={null}>
                <BulkReassignSection orgId={session.orgId} projectId={project.id} />
              </Suspense>
            )}
          </div>
        }
      />

      {/*
        HOLD ribbon. Per dispatch T3: key off held_at IS NOT NULL (the
        canonical signal, since project_status is text on this DB and
        adding a 'hold' enum is not required). holdProjectAction also
        flips status to 'on_hold' for legacy reads, but the visual cue
        here is grounded on the timestamp so a partially-applied state
        (status without held_at, or vice versa) still surfaces a ribbon.
      */}
      {project.held_at && (
        <Card className="mb-6 border-amber/30 bg-amber-dim/30">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <PauseCircle className="size-5 text-amber shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-amber">المشروع موقوف مؤقتًا</p>
                  <p className="text-[11px] text-muted-foreground">
                    منذ {formatArabicShortDate(project.held_at)}
                  </p>
                </div>
                {project.hold_reason && (
                  <p className="mt-1 text-xs text-foreground/80 leading-relaxed">
                    {project.hold_reason}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <MetricCard
          label="إجمالي المهام"
          value={summary.total}
          icon={<ListTodo className="size-5" />}
          className="p-3"
        />
        <MetricCard
          label="قيد التنفيذ"
          value={summary.in_progress}
          tone="info"
          icon={<Briefcase className="size-5" />}
          className="p-3"
        />
        <MetricCard
          label="قيد المراجعة"
          value={summary.manager_review + summary.specialist_review}
          tone="warning"
          icon={<ListTodo className="size-5" />}
          className="p-3"
        />
        <MetricCard
          label="مع العميل"
          value={summary.ready_to_send + summary.sent_to_client + summary.client_changes}
          tone="info"
          icon={<ListTodo className="size-5" />}
          className="p-3"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-8">
        <Card>
          <CardContent className="p-4 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <User className="size-4 text-cyan" /> العميل
            </h3>
            <div>
              <p className="text-base font-medium">{client?.name ?? "—"}</p>
              {client?.contact_name && (
                <p className="text-xs text-muted-foreground mt-0.5">{client.contact_name}</p>
              )}
              {client?.phone && <p className="text-xs text-muted-foreground" dir="ltr">{client.phone}</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Calendar className="size-4 text-cyan" /> الجدول الزمني
            </h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">البدء</span>
                <span>{formatArabicShortDate(project.start_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">الانتهاء</span>
                <span>{formatArabicShortDate(project.end_date)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <User className="size-4 text-cyan" /> مدير الحساب
            </h3>
            {am ? (
              <div className="flex items-center gap-2.5">
                <Avatar size="sm">
                  <AvatarFallback>{am.full_name[0]}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{am.full_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{am.job_title ?? ""}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">لم يتم تعيين مدير حساب بعد</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {specialists.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <User className="size-4 text-cyan" /> مسؤول {s.label}
              </h3>
              {s.emp ? (
                <div className="flex items-center gap-2.5">
                  <Avatar size="sm">
                    <AvatarFallback>{s.emp.full_name[0]}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.emp.full_name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{s.emp.job_title ?? ""}</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">لم يُعيَّن بعد</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <SectionTitle title="الخدمات" />
      <Card className="mb-8">
        <CardContent className="p-4">
          {(project.project_services ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد خدمات مرتبطة بعد.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(project.project_services ?? []).map((ps) => {
                const s = Array.isArray(ps.service) ? ps.service[0] : ps.service;
                if (!s) return null;
                return <ServiceBadge key={ps.id} slug={s.slug} name={s.name} />;
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <SectionTitle
        title="مجموعات واتساب"
        description="القناة الرسمية مع العميل والقروب الداخلي للفريق — تابع تسمية المنشور في الدليل."
      />
      <div className="mb-8">
        <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">جاري تحميل مجموعات واتساب...</CardContent></Card>}>
          <ProjectWhatsAppSection
            orgId={session.orgId}
            projectId={project.id}
            clientName={client?.name ?? null}
          />
        </Suspense>
      </div>

      <SectionTitle title="فريق المشروع" />
      <Card className="mb-8">
        <CardContent className="p-4">
          {(project.project_members ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا يوجد أعضاء فريق مضافون بعد.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(project.project_members ?? []).map((m) => {
                const e = Array.isArray(m.employee) ? m.employee[0] : m.employee;
                if (!e) return null;
                return (
                  <li key={m.id} className="flex items-center gap-3 rounded-xl border border-soft bg-soft-1 p-2.5">
                    <Avatar size="sm">
                      <AvatarFallback>{e.full_name[0]}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{e.full_name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{m.role_label ?? e.job_title ?? ""}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <SectionTitle
        title="متابعون"
        description="المُورَّدون من Odoo (`mail.followers`) — يستلمون التنبيهات على المشروع."
      />
      <Card className="mb-8">
        <CardContent className="p-4">
          <Suspense fallback={<div className="text-sm text-muted-foreground">جاري تحميل المتابعين...</div>}>
            <ProjectFollowersSection
              orgId={session.orgId}
              projectId={project.id}
            />
          </Suspense>
        </CardContent>
      </Card>

      <SectionTitle
        title="دورات التجديد"
        description="جدول التجديد المعتمد للمشروع وسجل الدورات السابقة."
      />
      <div className="mb-8">
        <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">جاري تحميل دورات التجديد...</CardContent></Card>}>
          <ProjectRenewalsSection
            orgId={session.orgId}
            projectId={project.id}
            cycleLengthMonths={(project as { cycle_length_months?: number | null }).cycle_length_months ?? null}
            nextRenewalDate={(project as { next_renewal_date?: string | null }).next_renewal_date ?? null}
            canManage={canManageRenewal}
          />
        </Suspense>
      </div>

      <SectionTitle
        title="لوحة المهام"
        description={`${tasks.length} مهمة — اسحب البطاقة بين الأعمدة لتغيير المرحلة`}
      />
      {tasks.length === 0 ? (
        <EmptyState
          title="لا توجد مهام بعد"
          description="ستظهر هنا تلقائيًا عند ربط خدمة لها قالب مهام."
          variant="compact"
        />
      ) : (
        <TaskBoard tasks={tasks} />
      )}
    </div>
  );
}

async function BulkReassignSection({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  const [allEmployees, allCategories] = await Promise.all([
    listEmployees(orgId),
    listServiceCategories(orgId),
  ]);

  return (
    <BulkReassignDialog
      projectId={projectId}
      categories={allCategories
        .filter((category) => category.is_active)
        .map((category) => ({ id: category.id, name: category.name_ar }))}
      employees={allEmployees
        .filter((employee) => employee.employment_status === "active")
        .map((employee) => ({
          id: employee.id,
          full_name: employee.full_name,
          user_id: employee.user_id ?? null,
          job_title: employee.job_title ?? null,
        }))}
    />
  );
}

async function ProjectWhatsAppSection({
  orgId,
  projectId,
  clientName,
}: {
  orgId: string;
  projectId: string;
  clientName: string | null;
}) {
  const waGroups = await listProjectWhatsAppGroups(orgId, projectId);
  const rows: WhatsAppGroupRow[] = (["client", "internal"] as const).map((kind) => {
    const existing = waGroups.find((group) => group.kind === kind);
    return existing
      ? {
          id: existing.id,
          kind: existing.kind,
          name: existing.name,
          invite_url: existing.invite_url,
        }
      : {
          id: null,
          kind,
          name: clientName ? suggestGroupName(kind, clientName) : "",
          invite_url: null,
        };
  });

  return <WhatsAppPanel projectId={projectId} rows={rows} />;
}

async function ProjectFollowersSection({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  const { data } = await supabaseAdmin
    .from("project_followers")
    .select("employee:employee_profiles ( id, full_name, avatar_url, job_title )")
    .eq("organization_id", orgId)
    .eq("project_id", projectId);

  const followers = ((data ?? []) as Array<{
    employee:
      | { id: string; full_name: string; avatar_url: string | null; job_title: string | null }
      | { id: string; full_name: string; avatar_url: string | null; job_title: string | null }[]
      | null;
  }>)
    .map((row) => (Array.isArray(row.employee) ? row.employee[0] : row.employee))
    .filter((employee): employee is NonNullable<typeof employee> => employee !== null);

  if (followers.length === 0) {
    return <p className="text-sm text-muted-foreground">لا يوجد متابعون.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {followers.map((employee) => (
        <div
          key={employee.id}
          className="inline-flex items-center gap-2 rounded-full border border-soft bg-soft-1 ps-2 pe-1 py-1 text-xs text-foreground"
          title={employee.job_title ?? employee.full_name}
        >
          {employee.avatar_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={employee.avatar_url}
              alt={employee.full_name}
              className="size-5 rounded-full object-cover"
            />
          ) : (
            <span className="grid size-5 place-items-center rounded-full bg-cyan/20 text-[10px] font-semibold text-cyan">
              {employee.full_name.slice(0, 1)}
            </span>
          )}
          <span>{employee.full_name}</span>
          <MessageButton
            employeeId={employee.id}
            employeeName={employee.full_name}
            contextProjectId={projectId}
            size="xs"
          />
        </div>
      ))}
    </div>
  );
}

async function ProjectRenewalsSection({
  orgId,
  projectId,
  cycleLengthMonths,
  nextRenewalDate,
  canManage,
}: {
  orgId: string;
  projectId: string;
  cycleLengthMonths: number | null;
  nextRenewalDate: string | null;
  canManage: boolean;
}) {
  const renewalCycles = await listProjectRenewalCycles(orgId, projectId);

  return (
    <RenewalsPanel
      projectId={projectId}
      cycleLengthMonths={cycleLengthMonths}
      nextRenewalDate={nextRenewalDate}
      cycles={renewalCycles}
      canManage={canManage}
    />
  );
}
