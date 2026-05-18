import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Briefcase, Calendar, User, ListTodo, PauseCircle,
} from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { getProject, getProjectHoldActor, getProjectTaskSummary, getProjectTagsForProject } from "@/lib/data/projects";
import { ProjectTagsPanel } from "./project-tags-panel";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  ProjectStatusBadge, PriorityBadge,
} from "@/components/status-badges";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { intlLocale } from "@/lib/utils-format";
import { EmptyState } from "@/components/empty-state";
import Link from "next/link";
import { GanttChart } from "lucide-react";
import { TaskBoard } from "./task-board";
import { BulkReassignDialog } from "./bulk-reassign-dialog";
import { listEmployees } from "@/lib/data/employees";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MessageButton } from "@/components/dm/message-button";
import { listServiceCategories } from "@/lib/data/service-categories";
import { ProjectServicesPanel, type ServiceLink, type ServiceCandidate, type EmployeePickOption } from "./services-panel";
import { WhatsAppPanel, type WhatsAppGroupRow } from "./whatsapp-panel";
import { HoldDialog } from "./hold-dialog";
import { ProjectHolidaysPanel, type ProjectHolidayRow } from "./project-holidays-panel";
import { ProjectNotesPanel, type ProjectNoteRow } from "./project-notes-panel";
import { listProjectWhatsAppGroups, suggestGroupName } from "@/lib/data/whatsapp";
import { listProjectRenewalCycles, daysUntilRenewal } from "@/lib/data/renewals";
import { RenewalsPanel } from "./renewals/renewals-panel";
import { loadTaskBoardForGlobalView } from "../../tasks/_loaders";
import { buildTaskFiltersFromParams } from "../../tasks/_filter_params";
import { SmartSearchBar } from "../../tasks/smart-search-bar";
import { ProjectDocumentsPanel } from "./project-documents-panel";

function formatShortDate(
  value: string | Date | null | undefined,
  locale: string,
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(intlLocale(locale.startsWith("ar") ? "ar-SA" : "en-US"), {
    month: "short",
    day: "numeric",
  }).format(d);
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    view?: string;
    f?: string;
    d?: string;
    filter?: string;
    q?: string;
    groupBy?: string;
  }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const locale = await getLocale();
  const t = await getTranslations("ProjectDetailPage");
  const tNav = await getTranslations("Nav");
  const session = await requirePagePermission("projects.view");
  const project = await getProject(session.orgId, id);
  if (!project) notFound();
  // Same filter surface as the global /tasks page, but scoped to this
  // project. The chip menu (SmartSearchBar) reads + writes URL params; we
  // parse those into TaskFilters here and pass them to the loader.
  const { filters: projectTaskFilters, activeKeys } = buildTaskFiltersFromParams(sp, {
    userId: session.userId,
    employeeId: session.employeeId ?? null,
    projectId: id,
  });

  const [summary, holdActor] = await Promise.all([
    getProjectTaskSummary(session.orgId, project.id),
    // Key off held_at, not status — Odoo-imported holds can sit on
    // status='archived' or other text values; the ribbon below already
    // keys off held_at for the same reason.
    project.held_at
      ? getProjectHoldActor(session.orgId, project.id)
      : Promise.resolve(null),
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
    { label: t("specialists.social"), emp: socialSp },
    { label: t("specialists.media"), emp: mediaSp },
    { label: t("specialists.seo"), emp: seoSp },
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
        breadcrumbs={[{ label: tNav("projects"), href: "/projects" }, { label: project.name }]}
        actions={
          <div className="flex items-center gap-2">
            <HoldDialog
              projectId={project.id}
              status={project.status}
              heldAt={project.held_at}
              holdReason={project.hold_reason}
              heldBy={holdActor?.name ?? null}
            />
            {renewalDays !== null && renewalDays >= 0 && renewalDays <= 14 && (
              <span
                className="inline-flex items-center rounded-full border border-amber/40 bg-amber-dim px-2 py-0.5 text-[10px] font-semibold text-amber"
                title={t("renewalSoonTitle")}
              >
                {t("renewalSoon", { days: renewalDays })}
              </span>
            )}
            <PriorityBadge priority={project.priority} />
            <ProjectStatusBadge status={project.status} />
            <Link
              href={`/projects/${project.id}/gantt`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted/50 transition-colors"
            >
              <GanttChart className="size-3.5" />
              {t("actions.gantt")}
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
                  <p className="text-sm font-semibold text-amber">{t("hold.ribbonTitle")}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("hold.since", { date: formatShortDate(project.held_at, locale) })}
                    {holdActor?.name && (
                      <>
                        {" "}· {t("hold.by")}{" "}
                        <span className="text-foreground/80">{holdActor.name}</span>
                      </>
                    )}
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
          label={t("metrics.totalTasks")}
          value={summary.total}
          icon={<ListTodo className="size-5" />}
          className="p-3"
        />
        <MetricCard
          label={t("metrics.inProgress")}
          value={summary.in_progress}
          tone="info"
          icon={<Briefcase className="size-5" />}
          className="p-3"
        />
        <MetricCard
          label={t("metrics.inReview")}
          value={summary.manager_review + summary.specialist_review}
          tone="warning"
          icon={<ListTodo className="size-5" />}
          className="p-3"
        />
        <MetricCard
          label={t("metrics.withClient")}
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
              <User className="size-4 text-cyan" /> {t("cards.client")}
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
              <Calendar className="size-4 text-cyan" /> {t("cards.timeline")}
            </h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("cards.start")}</span>
                <span>{formatShortDate(project.start_date, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("cards.end")}</span>
                <span>{formatShortDate(project.end_date, locale)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <User className="size-4 text-cyan" /> {t("cards.accountManager")}
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
              <p className="text-xs text-muted-foreground">{t("cards.noAccountManager")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {specialists.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <User className="size-4 text-cyan" /> {t("specialists.owner", { label: s.label })}
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
                <p className="text-xs text-muted-foreground">{t("specialists.unassigned")}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <SectionTitle
        title={t("sections.tags.title")}
        description={t("sections.tags.description")}
      />
      <Card className="mb-8">
        <CardContent className="p-4">
          <Suspense fallback={<p className="text-xs text-muted-foreground">{t("loading.tags")}</p>}>
            <ProjectTagsSection
              orgId={session.orgId}
              projectId={project.id}
              canManage={session.permissions.has("projects.manage") || session.isOwner}
            />
          </Suspense>
        </CardContent>
      </Card>

      {/* Sky Light feedback #12: editable multi-package list. The chip
          row mirrors the wizard's behavior post-creation; uses the same
          services catalog seeded by the Odoo importer (project.category_ids
          → services). canManage gates the add/remove affordances behind
          the projects.manage permission. */}
      <SectionTitle title={t("sections.services.title")} />
      <Card className="mb-8">
        <CardContent className="p-4">
          <ProjectServicesSection
            project={project}
            orgId={session.orgId}
            canManage={session.permissions.has("projects.manage") || session.isOwner}
          />
        </CardContent>
      </Card>

      <SectionTitle
        title={t("sections.whatsapp.title")}
        description={t("sections.whatsapp.description")}
      />
      <div className="mb-8">
        <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">{t("loading.whatsapp")}</CardContent></Card>}>
          <ProjectWhatsAppSection
            orgId={session.orgId}
            projectId={project.id}
            clientName={client?.name ?? null}
          />
        </Suspense>
      </div>

      {/* Sky Light feedback #16: per-project blackout dates. Schema + RPC
          recalculate_project_task_dates already honor these via migration 0091;
          this is the operator surface to add/remove without going through the
          org-wide /settings/holidays admin. */}
      <SectionTitle
        title={t("sections.holidays.title")}
        description={t("sections.holidays.description")}
      />
      <Card className="mb-8">
        <CardContent className="p-4">
          <Suspense
            fallback={
              <div className="text-sm text-muted-foreground">
                {t("loading.holidays")}
              </div>
            }
          >
            <ProjectHolidaysSection
              orgId={session.orgId}
              projectId={project.id}
              canManage={
                session.permissions.has("projects.manage") || session.isOwner
              }
            />
          </Suspense>
        </CardContent>
      </Card>

      {/* Sky Light feedback #14: aggregated "All Documents" section. Mirrors
          Odoo `rwasem_document_management_project`'s smart-button — pulls
          attachments from the project itself AND every task under it, then
          lists them with task code so the operator can see what belongs where. */}
      <SectionTitle
        title={t("sections.notes.title")}
        description={t("sections.notes.description")}
      />
      <Card className="mb-8">
        <CardContent className="p-4">
          <Suspense
            fallback={<div className="text-sm text-muted-foreground">{t("loading.notes")}</div>}
          >
            <ProjectNotesSection
              orgId={session.orgId}
              projectId={project.id}
              currentUserId={session.userId}
              canCreate={hasPermission(session, "projects.view")}
              canManage={hasPermission(session, "projects.manage")}
            />
          </Suspense>
        </CardContent>
      </Card>

      <SectionTitle
        title={t("sections.attachments.title")}
        description={t("sections.attachments.description")}
      />
      <Card className="mb-8">
        <CardContent className="p-4">
          <ProjectDocumentsPanel projectId={project.id} />
        </CardContent>
      </Card>

      <SectionTitle title={t("sections.team.title")} />
      <Card className="mb-8">
        <CardContent className="p-4">
          {(project.project_members ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty.team")}</p>
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
        title={t("sections.followers.title")}
        description={t("sections.followers.description")}
      />
      <Card className="mb-8">
        <CardContent className="p-4">
          <Suspense fallback={<div className="text-sm text-muted-foreground">{t("loading.followers")}</div>}>
            <ProjectFollowersSection
              orgId={session.orgId}
              projectId={project.id}
            />
          </Suspense>
        </CardContent>
      </Card>

      <SectionTitle
        title={t("sections.renewals.title")}
        description={t("sections.renewals.description")}
      />
      <div className="mb-8">
        <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">{t("loading.renewals")}</CardContent></Card>}>
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
        title={t("sections.board.title")}
        description={t("sections.board.description", { count: summary.total })}
      />
      {/* Project-scoped filter chip menu. Same surface as /tasks; URL params
          stay on this route so the filters affect only this project's task
          board. */}
      <div className="mb-3">
        <SmartSearchBar
          initialQuery={sp.q ?? ""}
          filterKey={activeKeys.size === 1 ? Array.from(activeKeys)[0] : undefined}
          view={sp.view ?? "kanban"}
        />
      </div>
      <Suspense
        fallback={
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              {t("loading.board")}
            </CardContent>
          </Card>
        }
      >
        <ProjectTaskBoardSection
          orgId={session.orgId}
          projectId={project.id}
          filterSignature={JSON.stringify(projectTaskFilters)}
          taskFilters={projectTaskFilters}
        />
      </Suspense>
    </div>
  );
}

async function ProjectTaskBoardSection({
  orgId,
  taskFilters,
}: {
  orgId: string;
  projectId: string;
  // filterSignature is passed as part of the key by the parent Suspense so a
  // filter change re-runs this server fetch; we don't read it here.
  filterSignature: string;
  taskFilters: Parameters<typeof loadTaskBoardForGlobalView>[1];
}) {
  const t = await getTranslations("ProjectDetailPage");
  const tasks = await loadTaskBoardForGlobalView(orgId, taskFilters);
  if (tasks.length === 0) {
    return (
      <EmptyState
        title={t("empty.noMatchingTasks.title")}
        description={t("empty.noMatchingTasks.description")}
        variant="compact"
      />
    );
  }
  return <TaskBoard tasks={tasks} />;
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
  const t = await getTranslations("ProjectDetailPage");
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
    return <p className="text-sm text-muted-foreground">{t("empty.followers")}</p>;
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

// Sky Light feedback #12: editable services chip row. Rendered inline as an
// async server component so the catalog query lives off the main project
// loader (the chip strip is below the fold and shouldn't block above-the-fold
// metrics).
async function ProjectTagsSection({
  orgId,
  projectId,
  canManage,
}: {
  orgId: string;
  projectId: string;
  canManage: boolean;
}) {
  const { attached, all } = await getProjectTagsForProject(orgId, projectId);
  return (
    <ProjectTagsPanel
      projectId={projectId}
      attached={attached}
      candidates={all}
      canManage={canManage}
    />
  );
}

async function ProjectServicesSection({
  project,
  orgId,
  canManage,
}: {
  project: { id: string; project_services?: unknown };
  orgId: string;
  canManage: boolean;
}) {
  const t = await getTranslations("ProjectDetailPage");
  const rawLinks = (project.project_services ?? []) as Array<{
    id: string;
    service_id: string;
    service:
      | { id: string; name: string; slug: string }
      | { id: string; name: string; slug: string }[]
      | null;
  }>;
  const rawAttached: ServiceLink[] = rawLinks.flatMap((ps) => {
    const s = Array.isArray(ps.service) ? ps.service[0] : ps.service;
    return s ? [{ id: ps.id, service_id: ps.service_id, service: s }] : [];
  });

  // §3.2: count tasks per service so each chip can surface a live badge.
  // One round-trip — RLS scopes to the project automatically through the
  // org filter + project_id check.
  const taskCountByService = new Map<string, number>();
  if (rawAttached.length > 0) {
    const { data: serviceTaskRows } = await supabaseAdmin
      .from("tasks")
      .select("service_id")
      .eq("organization_id", orgId)
      .eq("project_id", project.id)
      .not("service_id", "is", null);
    for (const row of serviceTaskRows ?? []) {
      const sid = (row as { service_id: string | null }).service_id;
      if (!sid) continue;
      taskCountByService.set(sid, (taskCountByService.get(sid) ?? 0) + 1);
    }
  }
  // §3.1: pull tag assignments per project_services row. One round-trip,
  // ids only — the catalog of project_tags is fetched separately and
  // joined client-side via the tag_id.
  const tagsByPs = new Map<string, Array<{ id: string; name: string; color: number }>>();
  if (rawAttached.length > 0) {
    const psIds = rawAttached.map((r) => r.id);
    const { data: assigns } = await supabaseAdmin
      .from("project_service_tag_assignments")
      .select("project_service_id, tag:project_tags ( id, name, color )")
      .eq("organization_id", orgId)
      .in("project_service_id", psIds);
    type Row = {
      project_service_id: string;
      tag: { id: string; name: string; color: number } | { id: string; name: string; color: number }[] | null;
    };
    for (const row of (assigns ?? []) as Row[]) {
      const tag = Array.isArray(row.tag) ? row.tag[0] : row.tag;
      if (!tag) continue;
      const list = tagsByPs.get(row.project_service_id) ?? [];
      list.push(tag);
      tagsByPs.set(row.project_service_id, list);
    }
  }

  const attached: ServiceLink[] = rawAttached.map((link) => ({
    ...link,
    task_count: taskCountByService.get(link.service_id) ?? 0,
    tags: tagsByPs.get(link.id) ?? [],
  }));

  const [{ data: catalog }, employees, { data: tagCatalog }] = await Promise.all([
    supabaseAdmin
      .from("services")
      .select("id, name, slug")
      .eq("organization_id", orgId)
      .order("name"),
    listEmployees(orgId),
    supabaseAdmin
      .from("project_tags")
      .select("id, name, color")
      .eq("organization_id", orgId)
      .order("name"),
  ]);
  const tagOptions = ((tagCatalog ?? []) as Array<{ id: string; name: string; color: number }>);
  const candidates: ServiceCandidate[] = (catalog ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    slug: s.slug as string,
  }));
  const employeeOptions: EmployeePickOption[] = employees
    .filter((e) => e.employment_status === "active")
    .map((e) => {
      const dept = Array.isArray(e.department) ? e.department[0] : e.department;
      return {
        id: e.id,
        full_name: e.full_name,
        department_name: dept?.name ?? null,
      };
    });

  if (attached.length === 0 && !canManage) {
    return <p className="text-sm text-muted-foreground">{t("empty.services")}</p>;
  }
  return (
    <ProjectServicesPanel
      projectId={project.id}
      attached={attached}
      candidates={candidates}
      employees={employeeOptions}
      canManage={canManage}
      tagOptions={tagOptions}
    />
  );
}

async function ProjectNotesSection({
  orgId,
  projectId,
  currentUserId,
  canCreate,
  canManage,
}: {
  orgId: string;
  projectId: string;
  currentUserId: string;
  canCreate: boolean;
  canManage: boolean;
}) {
  // FK author_user_id → auth.users can't be embedded (PostgREST doesn't
  // span schemas). Resolve author names via employee_profiles.user_id in a
  // second query — cheap, one IN-clause for all authors on this project.
  const { data } = await supabaseAdmin
    .from("project_log_notes")
    .select("id, body, created_at, updated_at, author_user_id")
    .eq("organization_id", orgId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    body: string;
    created_at: string;
    updated_at: string;
    author_user_id: string;
  };
  const rows = (data ?? []) as Row[];
  const authorIds = Array.from(new Set(rows.map((r) => r.author_user_id)));
  let lookup = new Map<
    string,
    { full_name: string; avatar_url: string | null }
  >();
  if (authorIds.length > 0) {
    const { data: emps } = await supabaseAdmin
      .from("employee_profiles")
      .select("user_id, full_name, avatar_url")
      .eq("organization_id", orgId)
      .in("user_id", authorIds);
    lookup = new Map(
      (emps ?? []).map((e) => [
        e.user_id as string,
        {
          full_name: (e.full_name as string) ?? "—",
          avatar_url: (e.avatar_url as string | null) ?? null,
        },
      ]),
    );
  }

  const notes: ProjectNoteRow[] = rows.map((r) => {
    const author = lookup.get(r.author_user_id) ?? {
      full_name: "—",
      avatar_url: null,
    };
    return {
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      updated_at: r.updated_at,
      edited: r.updated_at !== r.created_at,
      author: {
        user_id: r.author_user_id,
        full_name: author.full_name,
        avatar_url: author.avatar_url,
      },
      can_edit: canManage || r.author_user_id === currentUserId,
    };
  });

  return (
    <ProjectNotesPanel
      projectId={projectId}
      notes={notes}
      canCreate={canCreate}
    />
  );
}

async function ProjectHolidaysSection({
  orgId,
  projectId,
  canManage,
}: {
  orgId: string;
  projectId: string;
  canManage: boolean;
}) {
  const { data } = await supabaseAdmin
    .from("project_holidays")
    .select("id, holiday_date, name, recurring")
    .eq("organization_id", orgId)
    .eq("project_id", projectId)
    .order("holiday_date", { ascending: true });

  const rows: ProjectHolidayRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    holiday_date: r.holiday_date as string,
    name: r.name as string,
    recurring: Boolean(r.recurring),
  }));

  return (
    <ProjectHolidaysPanel
      projectId={projectId}
      rows={rows}
      canManage={canManage}
    />
  );
}
