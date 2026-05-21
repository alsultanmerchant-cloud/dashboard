import { Suspense } from "react";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Briefcase, Calendar, ListTodo, Users,
} from "lucide-react";
import { ProjectInfoChrome } from "./project-info-chrome";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import {
  getProject,
  getProjectHoldActor,
  getProjectTaskSummary,
  getProjectAttachedTags,
  listProjectTags,
} from "@/lib/data/projects";
import { ProjectTagsPanel } from "./project-tags-panel";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import {
  ProjectStatusBadge, PriorityBadge,
} from "@/components/status-badges";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { intlLocale } from "@/lib/utils-format";
import { EmptyState } from "@/components/empty-state";
import Link from "next/link";
import { GanttChart } from "lucide-react";
import type { BoardTask } from "./task-board";
import { BulkReassignDialog } from "./bulk-reassign-dialog";
import { listEmployees } from "@/lib/data/employees";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listServiceCategories } from "@/lib/data/service-categories";
import { ProjectServicesPanel, type ServiceLink, type ServiceCandidate, type EmployeePickOption } from "./services-panel";
import { WhatsAppPanel, type WhatsAppGroupRow } from "./whatsapp-panel";
import { HoldDialog } from "./hold-dialog";
import { RecomputeTeamButton } from "./recompute-team-button";
import { ProjectHolidaysPanel, type ProjectHolidayRow } from "./project-holidays-panel";
import { ProjectNotesPanel, type ProjectNoteRow } from "./project-notes-panel";
import { listProjectWhatsAppGroups, suggestGroupName } from "@/lib/data/whatsapp";
import { listProjectRenewalCycles, daysUntilRenewal } from "@/lib/data/renewals";
import { RenewalsPanel } from "./renewals/renewals-panel";
import { loadTaskBoardForGlobalView } from "../../tasks/_loaders";
import { buildTaskFiltersFromParams } from "../../tasks/_filter_params";
import { SmartSearchBar } from "../../tasks/smart-search-bar";
import { cn } from "@/lib/utils";
import { ProjectFavoriteButton } from "@/components/projects/project-favorite-button";

const TaskBoard = dynamic(() => import("./task-board").then((mod) => mod.TaskBoard));
const ProjectChatterPanel = dynamic(
  () => import("./project-chatter-panel").then((mod) => mod.ProjectChatterPanel),
);

function formatLongDate(
  value: string | Date | null | undefined,
  locale: string,
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(intlLocale(locale.startsWith("ar") ? "ar-SA" : "en-US"), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

type PersonLite = {
  id?: string;
  full_name: string;
  job_title: string | null;
  avatar_url?: string | null;
} | null;

function personInitial(value: string | undefined): string {
  return value?.trim().slice(0, 1).toUpperCase() || "—";
}

function SummaryPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-soft bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-soft-2 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">{value}</p>
        </div>
      </div>
    </div>
  );
}

function InfoField({
  label,
  value,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-soft bg-soft-1/60 px-4 py-3", className)}>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="flex items-start gap-2 text-sm text-foreground">
        {icon ? <span className="mt-0.5 text-muted-foreground">{icon}</span> : null}
        <div className="min-w-0 flex-1">{value}</div>
      </div>
    </div>
  );
}

function UnderlineField({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[92px_minmax(0,1fr)] items-start gap-3", className)}>
      <p className="pt-1 text-[12px] font-medium text-foreground/90">{label}</p>
      <div className="min-w-0 border-b border-primary/80 pb-1.5 text-[12px] text-foreground">
        {value}
      </div>
    </div>
  );
}

function FormChip({
  label,
  dotClassName = "bg-primary",
}: {
  label: string;
  dotClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground/80">
      <span className={cn("size-2 rounded-full", dotClassName)} />
      <span>{label}</span>
    </span>
  );
}

function PersonCard({
  label,
  person,
  compact = false,
}: {
  label: string;
  person: PersonLite;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-2xl border border-soft bg-card px-3 py-3",
      compact && "px-2.5 py-2.5",
    )}
    >
      <Avatar size="sm">
        <AvatarFallback>{personInitial(person?.full_name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-semibold text-foreground">
          {person?.full_name ?? "—"}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {person?.job_title ?? "—"}
        </p>
      </div>
    </div>
  );
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
  const [{ id }, sp, locale, t, tNav, session] = await Promise.all([
    params,
    searchParams ? searchParams.then((value) => value ?? {}) : Promise.resolve({}),
    getLocale(),
    getTranslations("ProjectDetailPage"),
    getTranslations("Nav"),
    requirePagePermission("projects.view"),
  ]);
  // Same filter surface as the global /tasks page, but scoped to this
  // project. The chip menu (SmartSearchBar) reads + writes URL params; we
  // parse those into TaskFilters here and pass them to the loader.
  const { filters: projectTaskFilters, activeKeys } = buildTaskFiltersFromParams(sp, {
    userId: session.userId,
    employeeId: session.employeeId ?? null,
    projectId: id,
  });

  // Parallelize the critical-path fetches: project, summary, tags, follower
  // count all key off (orgId, projectId) and have no inter-dependency, so we
  // batch them into one round-trip instead of awaiting project first.
  const [project, summary, projectTags, followersRes] = await Promise.all([
    getProject(session.orgId, id),
    getProjectTaskSummary(session.orgId, id),
    getProjectAttachedTags(session.orgId, id),
    supabaseAdmin
      .from("project_followers")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.orgId)
      .eq("project_id", id),
  ]);
  if (!project) notFound();
  // Key off held_at, not status — Odoo-imported holds can sit on
  // status='archived' or other text values; the ribbon below already
  // keys off held_at for the same reason.
  const holdActor = project.held_at
    ? await getProjectHoldActor(session.orgId, project.id)
    : null;
  const attachedTags = projectTags;
  const followerCount = followersRes.count ?? 0;
  const renewalDays = daysUntilRenewal((project as { next_renewal_date?: string | null }).next_renewal_date ?? null);
  const canManageRenewal =
    session.isOwner || session.permissions.has("renewal.manage");

  const client = Array.isArray(project.client) ? project.client[0] : project.client;
  const projectManager = Array.isArray((project as { project_manager?: unknown }).project_manager)
    ? ((project as { project_manager?: { id: string; full_name: string; job_title: string | null; avatar_url: string | null }[] }).project_manager?.[0] ?? null)
    : ((project as { project_manager?: { id: string; full_name: string; job_title: string | null; avatar_url: string | null } | null }).project_manager ?? null);
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
  const serviceLinks = ((project.project_services ?? []) as Array<{
    id: string;
    service:
      | { id: string; name: string; slug: string }
      | { id: string; name: string; slug: string }[]
      | null;
  }>)
    .map((link) => (Array.isArray(link.service) ? link.service[0] : link.service))
    .filter((service): service is { id: string; name: string; slug: string } => Boolean(service));
  const projectMembers = (project.project_members ?? []) as Array<{
    id: string;
    role_label: string | null;
    employee:
      | { id: string; full_name: string; job_title: string | null; avatar_url: string | null }
      | { id: string; full_name: string; job_title: string | null; avatar_url: string | null }[]
      | null;
  }>;
  const memberCount = projectMembers.length;
  const specialistCount = specialists.filter((specialist) => specialist.emp).length;
  const description = project.description?.trim() || t("overview.emptyDescription");
  const totalProgress = summary.total > 0
    ? `${Math.round(((summary.done ?? 0) / summary.total) * 100)}%`
    : "0%";
  // Smart-button stat pills mirror Odoo's project header (Tasks, Status,
  // Collaborators, Documents). Documents opens a StackedSheet now — the
  // page no longer renders a separate documents section.
  const documentCount =
    (project as { document_count?: number | null }).document_count ?? 0;

  return (
    <div>
      <ProjectInfoChrome
        projectId={project.id}
        projectName={project.name}
        projectCode={(project as { project_code?: string | null }).project_code ?? null}
        recordKind="projects"
        moduleLabel={tNav("projects")}
        moduleHref="/projects"
        newHref="/projects/new"
        totalTasks={summary.total}
        followerCount={followerCount}
        documentCount={documentCount}
        labels={{
          totalTasks: t("metrics.totalTasks"),
          collaborators: t("sections.followers.title"),
          documents: t("sections.attachments.title"),
          activities: t("smartPills.activities"),
          documentsSheetTitle: t("sections.attachments.title"),
          documentsSheetDescription: t("sections.attachments.description"),
          followersSheetTitle: t("sections.followers.title"),
          followersSheetDescription: t("sections.followers.description"),
          activitiesSheetTitle: t("activitiesSheet.title"),
        }}
        rightActions={
          <Link
            href={`/projects/${project.id}/gantt`}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted/50 transition-colors"
          >
            <GanttChart className="size-3.5" />
            {t("actions.gantt")}
          </Link>
        }
      />


      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryPill
          icon={<ListTodo className="size-4" />}
          label={t("metrics.totalTasks")}
          value={summary.total}
        />
        <SummaryPill
          icon={<Briefcase className="size-4" />}
          label={t("metrics.inProgress")}
          value={summary.in_progress}
        />
        <SummaryPill
          icon={<Users className="size-4" />}
          label={t("sections.team.title")}
          value={memberCount}
        />
        <SummaryPill
          icon={<Calendar className="size-4" />}
          label={t("sections.services.title")}
          value={serviceLinks.length}
        />
      </div>

      <Card className="mb-8 overflow-visible rounded-[1.75rem] border-border bg-[#fcfcfd] shadow-[0_12px_30px_rgba(31,35,51,0.06)]">
        <CardContent className="p-0">
          <div className="px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-1 pb-5">
              <div className="flex flex-wrap items-center gap-2">
                <HoldDialog
                  projectId={project.id}
                  status={project.status}
                  heldAt={project.held_at}
                  holdReason={project.hold_reason}
                  heldBy={holdActor?.name ?? null}
                />
                {session.permissions.has("tasks.manage") && (
                  <Suspense fallback={null}>
                    <BulkReassignSection orgId={session.orgId} projectId={project.id} />
                  </Suspense>
                )}
                {hasPermission(session, "projects.manage") && (
                  <RecomputeTeamButton projectId={project.id} />
                )}
              </div>
              {renewalDays !== null && renewalDays >= 0 && renewalDays <= 14 && (
                <span className="inline-flex items-center rounded-full border border-amber/40 bg-amber-dim px-2 py-1 text-[10px] font-semibold text-amber">
                  {t("renewalSoon", { days: renewalDays })}
                </span>
              )}
            </div>

            <div className="pt-7">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {(project as { project_code?: string | null }).project_code ?? `PRJ-${project.id.slice(0, 8)}`}
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <ProjectFavoriteButton
                    projectId={project.id}
                    initialFavorite={Boolean((project as { is_favorite?: boolean | null }).is_favorite)}
                  />
                  <h1 className="truncate text-[1.65rem] font-semibold tracking-tight text-foreground">
                    {project.name}
                  </h1>
                </div>
                <button type="button" className="text-[12px] font-medium text-primary underline-offset-2 hover:underline">
                  EN
                </button>
              </div>

              <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
                <div className="space-y-5">
                  <UnderlineField
                    label={t("pixelFields.workingCalendar")}
                    value={<span>{t("pixelFields.standardCalendar")}</span>}
                  />
                  <UnderlineField
                    label={t("cards.client")}
                    value={<span>{client?.name ?? "—"}</span>}
                  />
                  <UnderlineField
                    label={t("pixelFields.siteAddress")}
                    value={<span className="text-muted-foreground">{client?.address ?? t("pixelFields.sitePlaceholder")}</span>}
                  />
                </div>

                <div className="space-y-5">
                  <UnderlineField
                    label={t("overview.labels.projectManager")}
                    value={
                      <div className="flex items-center gap-2">
                        <span className="grid size-5 place-items-center rounded bg-[#be275c] text-[10px] font-semibold text-white">
                          {personInitial(projectManager?.full_name)}
                        </span>
                        <span>{projectManager?.full_name ?? am?.full_name ?? "—"}</span>
                      </div>
                    }
                  />
                  <UnderlineField
                    label={t("pixelFields.startDate")}
                    value={<span>{formatLongDate(project.start_date, locale)}</span>}
                  />
                  <UnderlineField
                    label={t("pixelFields.totalProgress")}
                    value={<span>{totalProgress}</span>}
                  />
                  <UnderlineField
                    label={t("pixelFields.plannedDate")}
                    value={
                      <div className="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center gap-2">
                        <span>{formatLongDate(project.start_date, locale)}</span>
                        <span className="text-center text-muted-foreground">→</span>
                        <span>{formatLongDate(project.end_date, locale)}</span>
                      </div>
                    }
                  />
                  <UnderlineField
                    label={t("pixelFields.allocatedHours")}
                    value={<span>{t("pixelFields.defaultHours")}</span>}
                  />
                </div>
              </div>
            </div>

          </div>

          <div className="grid gap-0 border-t border-border lg:grid-cols-[minmax(0,1.15fr)_minmax(21rem,0.85fr)]">
            <div className="border-b border-soft px-5 py-5 sm:px-6 lg:border-b-0 lg:border-e">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">{t("overview.sections.teamAndTags")}</h2>
                  <p className="text-xs text-muted-foreground">{t("overview.sections.teamAndTagsHint")}</p>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {t("sections.team.title")}
                  </p>
                  {projectMembers.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-soft-2 bg-card/60 px-4 py-6 text-sm text-muted-foreground">
                      {t("empty.team")}
                    </div>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {projectMembers.map((m) => {
                        const e = Array.isArray(m.employee) ? m.employee[0] : m.employee;
                        if (!e) return null;
                        return (
                          <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-soft bg-card px-3 py-2.5">
                            <Avatar size="sm">
                              <AvatarFallback>{personInitial(e.full_name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{e.full_name}</p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {m.role_label ?? e.job_title ?? "—"}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {t("sections.tags.title")}
                  </p>
                  <Suspense fallback={<p className="text-xs text-muted-foreground">{t("loading.tags")}</p>}>
                    <ProjectTagsSection
                      orgId={session.orgId}
                      projectId={project.id}
                      attached={attachedTags}
                      canManage={session.permissions.has("projects.manage") || session.isOwner}
                    />
                  </Suspense>
                </div>
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-foreground">{t("overview.sections.quickFacts")}</h2>
                <p className="text-xs text-muted-foreground">{t("overview.sections.quickFactsHint")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoField
                  label={t("metrics.inReview")}
                  value={summary.manager_review + summary.specialist_review}
                />
                <InfoField
                  label={t("metrics.withClient")}
                  value={summary.ready_to_send + summary.sent_to_client + summary.client_changes}
                />
                <InfoField
                  label={t("overview.labels.priority")}
                  value={<span className="inline-flex"><PriorityBadge priority={project.priority} /></span>}
                />
                <InfoField
                  label={t("overview.labels.status")}
                  value={<span className="inline-flex"><ProjectStatusBadge status={project.status} /></span>}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────────────────────
          Odoo body continuation — Categories (= Services), Documents
          (Odoo's "All Documents" smart-button target), Collaborators
          (Odoo's "Collaborators" smart-button target). Pixel-perfect
          ordering per RWASEM_PARITY_NOTES §1 mandate; extensions live
          below in their own labelled section.
          ────────────────────────────────────────────────────────────── */}
      <SectionTitle title={t("sections.services.title")} />
      <Card className="mb-8">
        <CardContent className="p-4">
          <Suspense
            fallback={<div className="text-sm text-muted-foreground">{t("loading.tags")}</div>}
          >
            <ProjectServicesSection
              project={project}
              orgId={session.orgId}
              canManage={session.permissions.has("projects.manage") || session.isOwner}
            />
          </Suspense>
        </CardContent>
      </Card>

      <SectionTitle
        title={t("activityLog.title")}
        description={t("activityLog.description")}
      />
      <Card className="mb-8">
        <CardContent className="p-4">
          <ProjectChatterPanel
            projectId={project.id}
            canCompose={hasPermission(session, "projects.manage")}
          />
        </CardContent>
      </Card>

      {/* §PROJ-INFO-3 — Customer Info fields surfaced as labelled cards.
          Schema already carries store_name / target / account_manager /
          (social|media|seo)_specialist (mig 0049); this is the operator
          surface that previously only existed scattered through the form. */}
      <SectionTitle title={t("sections.customerInfo.title")} />
      <Card className="mb-8">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField
            label={t("customerInfo.storeName")}
            value={
              <span className={cn(!project.store_name && "text-muted-foreground")}>
                {project.store_name ?? t("overview.none")}
              </span>
            }
          />
          <InfoField
            label={t("customerInfo.target")}
            value={
              (project as { target?: string | null }).target ? (
                <span className="inline-flex rounded-md bg-soft-1 px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                  {t(`customerInfo.targets.${(project as { target: string }).target}`)}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("overview.none")}</span>
              )
            }
          />
          <InfoField
            label={t("customerInfo.accountManager")}
            value={
              am ? (
                <span className="inline-flex items-center gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-cyan/20 text-[10px] font-semibold text-cyan">
                    {personInitial(am.full_name)}
                  </span>
                  <span>{am.full_name}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{t("overview.none")}</span>
              )
            }
          />
          <InfoField
            label={t("specialists.social")}
            value={
              socialSp ? (
                <span>{socialSp.full_name}</span>
              ) : (
                <span className="text-muted-foreground">{t("overview.none")}</span>
              )
            }
          />
          <InfoField
            label={t("specialists.media")}
            value={
              mediaSp ? (
                <span>{mediaSp.full_name}</span>
              ) : (
                <span className="text-muted-foreground">{t("overview.none")}</span>
              )
            }
          />
          <InfoField
            label={t("specialists.seo")}
            value={
              seoSp ? (
                <span>{seoSp.full_name}</span>
              ) : (
                <span className="text-muted-foreground">{t("overview.none")}</span>
              )
            }
          />
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────────────────────
          الأقسام الإضافية / Dashboard extras (RWASEM_PARITY_NOTES §8).
          Anything below this banner is a paid-for differentiator and
          MUST stay positioned after the Odoo body so a Rwasem-trained
          operator scrolling top-to-bottom sees Rwasem's layout first.
          ────────────────────────────────────────────────────────────── */}
      <div className="my-6 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t("sections.extrasBanner")}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

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

      <div className="mt-8">
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
      </div>

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
  const tasks = (await loadTaskBoardForGlobalView(orgId, taskFilters)) as BoardTask[];
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
  attached,
  canManage,
}: {
  orgId: string;
  projectId: string;
  attached: Awaited<ReturnType<typeof getProjectAttachedTags>>;
  canManage: boolean;
}) {
  const all = await listProjectTags(orgId);
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
