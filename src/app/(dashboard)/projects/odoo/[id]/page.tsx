import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  ListTodo, CheckCircle2, AlertTriangle, Activity,
  Calendar, User, Building2, ChevronLeft, ArrowRight,
  Star, Hash, MapPin, DollarSign, Briefcase,
  MessageSquare, FileText, BarChart3, Users,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getLiveProject } from "@/lib/odoo/live";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTasksForGlobalView } from "../../../tasks/_loaders";
import { TaskBoard } from "../../[id]/task-board";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TaskStageBadge, PriorityBadge } from "@/components/status-badges";
import { formatArabicShortDate, isOverdue } from "@/lib/utils-format";
import { cn } from "@/lib/utils";
import { DetailTabs } from "./detail-tabs";
import { StatusBanner } from "./status-banner";
import { UpdatesFeed } from "./updates-feed";
import type { StatusValue } from "./_status-actions";

// Mirror the Rwasem card stripe palette so the detail header matches
// the project's Odoo color exactly.
const ODOO_COLORS = [
  "#9c9c9c", "#d44d4d", "#dfb700", "#3597d3", "#5b8a72",
  "#9b59b6", "#e63946", "#2a9d8f", "#264653", "#f4a261",
  "#28a745", "#5241c3",
];

function odooColor(i: number): string {
  return ODOO_COLORS[i % ODOO_COLORS.length] ?? ODOO_COLORS[11];
}

function formatOdooDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return null;
  return `${d[1]}/${d[2]}/${d[0]}`;
}

const TARGET_LABEL = {
  on_target: { label: "On Target", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  off_target: { label: "Off Target", tone: "bg-red-500/15 text-red-700 dark:text-red-300" },
  out: { label: "Out", tone: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300" },
  sales_deposit: { label: "Sales Deposit", tone: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  renewed: { label: "Renewed", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
} as const;

const STAGE_ORDER = [
  "new", "in_progress", "manager_review", "specialist_review",
  "ready_to_send", "sent_to_client", "client_changes", "done",
] as const;

const STAGE_LABEL: Record<string, string> = {
  new: "جديدة",
  in_progress: "قيد التنفيذ",
  manager_review: "مراجعة المدير",
  specialist_review: "مراجعة المتخصص",
  ready_to_send: "جاهزة للإرسال",
  sent_to_client: "أُرسلت للعميل",
  client_changes: "تعديلات العميل",
  done: "مكتملة",
};

export default async function OdooProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requirePagePermission("projects.view");

  const t = await getTranslations("ProjectCard");
  const project = await getLiveProject(Number(id));
  if (!project) notFound();

  const { analytics, tasks } = project;

  // Group tasks by stage for the legacy distribution bar (still used in Tasks tab).
  const tasksByStage = new Map<string, typeof tasks>();
  for (const stage of STAGE_ORDER) tasksByStage.set(stage, []);
  for (const t of tasks) {
    const arr = tasksByStage.get(t.stage) ?? [];
    arr.push(t);
    tasksByStage.set(t.stage, arr);
  }

  // Resolve Odoo external_id → Supabase project UUID, then load BoardTask[]
  // so the Tasks tab can render the full Rwasem kanban with drag-drop.
  const { data: supabaseProject } = await supabaseAdmin
    .from("projects")
    .select("id, last_update_status")
    .eq("organization_id", session.orgId)
    .eq("external_id", Number(id))
    .maybeSingle();
  const supabaseProjectId = supabaseProject?.id ?? null;
  // Prefer the Supabase-backed status (writeable via the banner); fall back
  // to whatever Odoo handed us so this still works pre-import.
  const liveStatus =
    (supabaseProject?.last_update_status as StatusValue | null) ??
    (project.lastUpdateStatus as StatusValue | null) ??
    null;
  const boardTasks = supabaseProjectId
    ? await loadTasksForGlobalView(session.orgId, { projectId: supabaseProjectId })
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        breadcrumbs={[
          { label: "المشاريع", href: "/projects" },
          { label: project.name },
        ]}
      />

      {/* Rwasem "Update Project" status banner — Odoo's project header. */}
      <StatusBanner
        projectId={supabaseProjectId}
        currentStatus={liveStatus}
      />

      {/* Rwasem-style hero card: stripe + ref + dates + tags + key/value grid */}
      <article className="relative overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-0 w-1.5"
          style={{ backgroundColor: odooColor(project.color || 11) }}
        />
        <div className="relative p-5 ps-6 space-y-4">
          {/* Title row */}
          <div className="flex items-start gap-3">
            <Star
              className={cn(
                "size-5 shrink-0",
                project.isFavorite ? "fill-amber-400 text-amber-500" : "text-muted-foreground",
              )}
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold text-foreground">{project.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Hash className="size-3" /> {project.ref}
                </span>
                {(project.startDate || project.endDate) && (
                  <span className="inline-flex items-center gap-1.5 tabular-nums" dir="ltr">
                    <Calendar className="size-3" />
                    {formatOdooDate(project.startDate) ?? "—"}
                    <ArrowRight className="size-3" />
                    {formatOdooDate(project.endDate) ?? "—"}
                  </span>
                )}
              </div>
            </div>

            {/* Status & target badges */}
            <div className="flex shrink-0 flex-col items-end gap-1">
              {project.lastUpdateStatus && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                    project.lastUpdateStatus === "on_track" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                    project.lastUpdateStatus === "at_risk" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                    project.lastUpdateStatus === "off_track" && "bg-red-500/15 text-red-700 dark:text-red-300",
                    project.lastUpdateStatus === "done" && "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  {project.lastUpdateStatus.replace(/_/g, " ")}
                </span>
              )}
              {project.target && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                    TARGET_LABEL[project.target].tone,
                  )}
                >
                  {TARGET_LABEL[project.target].label}
                </span>
              )}
            </div>
          </div>

          {/* Tags */}
          {project.tagNames.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {project.tagNames.map((name, idx) => (
                <li
                  key={`${name}-${idx}`}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[12px] text-foreground"
                >
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: odooColor((idx % 11) + 1) }}
                  />
                  {name}
                </li>
              ))}
            </ul>
          )}

          {/* Key/value grid (Rwasem overview fields) */}
          <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex items-baseline gap-2">
              <Briefcase className="size-3.5 shrink-0 self-center text-muted-foreground" />
              <dt className="font-semibold text-foreground">{t("storeName")}:</dt>
              <dd className="truncate text-foreground/80">
                {project.storeName ?? project.clientName ?? "—"}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <Building2 className="size-3.5 shrink-0 self-center text-muted-foreground" />
              <dt className="font-semibold text-foreground">{t("client")}:</dt>
              <dd className="truncate text-foreground/80">
                {project.clientId ? (
                  <Link
                    href={`/clients/odoo/${project.clientId}`}
                    className="hover:text-primary"
                  >
                    {project.clientName ?? "—"}
                  </Link>
                ) : (
                  project.clientName ?? "—"
                )}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <Calendar className="size-3.5 shrink-0 self-center text-muted-foreground" />
              <dt className="font-semibold text-foreground">{t("startDate")}:</dt>
              <dd className="tabular-nums text-foreground/80" dir="ltr">
                {formatArabicShortDate(project.startDate) ?? "—"}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <Calendar className="size-3.5 shrink-0 self-center text-muted-foreground" />
              <dt className="font-semibold text-foreground">{t("endDate")}:</dt>
              <dd className="tabular-nums text-foreground/80" dir="ltr">
                {formatArabicShortDate(project.endDate) ?? "—"}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <MapPin className="size-3.5 shrink-0 self-center text-muted-foreground" />
              <dt className="font-semibold text-foreground">{t("site")}:</dt>
              <dd className="truncate text-muted-foreground">
                {project.siteAddress ?? t("noAddress")}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <DollarSign className="size-3.5 shrink-0 self-center text-muted-foreground" />
              <dt className="font-semibold text-foreground">{t("cost")}:</dt>
              <dd className="truncate text-muted-foreground">{t("noCosts")}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <User className="size-3.5 shrink-0 self-center text-muted-foreground" />
              <dt className="font-semibold text-foreground">{t("projectManager")}:</dt>
              <dd className="flex min-w-0 items-center gap-1.5 text-foreground/80">
                {project.managerName && (
                  <Avatar size="sm" className="size-5">
                    <AvatarFallback
                      className="text-[10px]"
                      style={{
                        backgroundColor: odooColor(project.color || 11),
                        color: "#fff",
                      }}
                    >
                      {project.managerName.trim()[0] ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                )}
                <span className="truncate">{project.managerName ?? "—"}</span>
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <User className="size-3.5 shrink-0 self-center text-muted-foreground" />
              <dt className="font-semibold text-foreground">{t("accountManager")}:</dt>
              <dd className="truncate text-foreground/80">
                {project.accountManagerName ?? "—"}
              </dd>
            </div>
          </dl>
        </div>
      </article>

      {/* Smart-button row (Odoo project form pattern) */}
      <SmartButtonRow project={project} />

      {/* Tabbed body: Overview / Tasks / Members / Updates / Settings */}
      <DetailTabs
        overview={
          <div className="space-y-4">
            {/* Headline analytics */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                label="إجمالي المهام"
                value={analytics.total}
                icon={<ListTodo className="size-5" />}
                tone="default"
              />
              <MetricCard
                label="قيد التنفيذ"
                value={analytics.inProgress}
                icon={<Activity className="size-5" />}
                tone="info"
              />
              <MetricCard
                label="مكتملة"
                value={analytics.done}
                hint={`${analytics.completionPercent}% إنجاز`}
                icon={<CheckCircle2 className="size-5" />}
                tone="success"
              />
              <MetricCard
                label="متأخرة"
                value={analytics.overdue}
                icon={<AlertTriangle className="size-5" />}
                tone={analytics.overdue > 0 ? "destructive" : "default"}
              />
            </div>

            {project.description && (
              <Card>
                <CardContent className="p-4">
                  <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                    ملاحظات المشروع
                  </p>
                  <div
                    className="prose prose-invert prose-sm max-w-none text-sm leading-relaxed text-foreground"
                    dangerouslySetInnerHTML={{ __html: project.description }}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        }
        tasks={
          <div className="space-y-4">
            {/* Stage distribution bar */}
            <Card>
              <CardContent className="p-4">
                <p className="mb-3 text-sm font-medium">توزيع المهام حسب المرحلة</p>
                <div className="space-y-2">
                  {STAGE_ORDER.map((stage) => {
                    const count = analytics.byStage[stage] ?? 0;
                    const pct = analytics.total ? (count / analytics.total) * 100 : 0;
                    if (count === 0) return null;
                    return (
                      <div key={stage} className="flex items-center gap-3">
                        <div className="w-32 shrink-0">
                          <TaskStageBadge stage={stage} />
                        </div>
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-soft-2">
                          <div
                            className="absolute inset-y-0 right-0 bg-cyan/60"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="w-12 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
                          {count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Rwasem-style kanban: 8 stage columns with drag-drop, fold/unfold,
                and stage-history. Sourced from the Supabase mirror by the
                project's external_id; falls back to the read-only Odoo list
                when the project hasn't been imported yet. */}
            <div>
              <h2 className="mb-3 text-base font-semibold">المهام ({tasks.length})</h2>
              {supabaseProjectId ? (
                <TaskBoard
                  tasks={boardTasks}
                  projectId={supabaseProjectId}
                />
              ) : tasks.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center text-sm text-muted-foreground">
                    لا توجد مهام في هذا المشروع.
                  </CardContent>
                </Card>
              ) : (
                /* Read-only fallback when no Supabase mirror exists yet. */
                <div className="space-y-4">
                  {STAGE_ORDER.map((stage) => {
                    const stageTasks = tasksByStage.get(stage) ?? [];
                    if (stageTasks.length === 0) return null;
                    return (
                      <div key={stage}>
                        <div className="mb-2 flex items-center gap-2">
                          <TaskStageBadge stage={stage} />
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {stageTasks.length}
                          </span>
                        </div>
                        <Card>
                          <CardContent className="p-0">
                            <ul className="divide-y divide-white/[0.04]">
                              {stageTasks.map((t) => {
                                const overdue =
                                  isOverdue(t.deadline) && t.stage !== "done";
                                return (
                                  <li key={t.odooId}>
                                    <Link
                                      href={`/tasks/odoo/${t.odooId}`}
                                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-soft-2"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">
                                          {t.name}
                                        </p>
                                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                          <PriorityBadge priority={t.priority} />
                                          {t.deadline && (
                                            <span
                                              className={cn(
                                                "tabular-nums",
                                                overdue && "text-cc-red font-medium",
                                              )}
                                              dir="ltr"
                                            >
                                              {t.deadline}
                                            </span>
                                          )}
                                          {t.assigneeIds.length > 0 && (
                                            <span>{t.assigneeIds.length} منفذ</span>
                                          )}
                                        </div>
                                      </div>
                                      <ChevronLeft className="size-4 shrink-0 text-muted-foreground icon-flip-rtl" />
                                    </Link>
                                  </li>
                                );
                              })}
                            </ul>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        }
        members={<MembersPanel project={project} />}
        updates={
          <div className="space-y-3">
            <StatusBanner
              projectId={supabaseProjectId}
              currentStatus={liveStatus}
            />
            <UpdatesFeed
              organizationId={session.orgId}
              projectId={supabaseProjectId}
            />
          </div>
        }
        settings={<SettingsPanel project={project} />}
      />
    </div>
  );
}

/* ─────────────────────── Smart-button row ─────────────────────── */
function SmartButton({
  icon, label, value, hint, tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <div className="flex min-w-[8rem] items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
      <div
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-md",
          tone === "default" && "bg-primary/10 text-primary",
          tone === "success" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
          tone === "warning" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
          tone === "danger" && "bg-red-500/15 text-red-700 dark:text-red-300",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[18px] font-bold leading-none tabular-nums">{value}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground/80">{hint}</div>}
      </div>
    </div>
  );
}

function SmartButtonRow({
  project,
}: {
  project: Awaited<ReturnType<typeof getLiveProject>> extends infer T
    ? T extends null ? never : NonNullable<T> : never;
}) {
  const memberCount =
    1 +
    (project.accountManagerName ? 1 : 0) +
    (project.seoSpecialistName ? 1 : 0) +
    (project.mediaSpecialistName ? 1 : 0) +
    (project.socialSpecialistName ? 1 : 0);
  const completion = project.analytics.completionPercent;
  return (
    <div className="flex flex-wrap gap-2">
      <SmartButton
        icon={<ListTodo className="size-4" />}
        label="المهام"
        value={project.analytics.total}
        hint={`${project.analytics.done} مكتملة`}
        tone="default"
      />
      <SmartButton
        icon={<BarChart3 className="size-4" />}
        label="نسبة الإنجاز"
        value={`${completion}%`}
        tone={completion >= 70 ? "success" : completion >= 40 ? "warning" : "default"}
      />
      <SmartButton
        icon={<AlertTriangle className="size-4" />}
        label="متأخرة"
        value={project.analytics.overdue}
        tone={project.analytics.overdue > 0 ? "danger" : "default"}
      />
      <SmartButton
        icon={<Users className="size-4" />}
        label="الفريق"
        value={memberCount}
        tone="default"
      />
      <SmartButton
        icon={<MessageSquare className="size-4" />}
        label="التحديثات"
        value={project.lastUpdateStatus ? project.lastUpdateStatus.replace(/_/g, " ") : "—"}
        tone={
          project.lastUpdateStatus === "on_track" || project.lastUpdateStatus === "done"
            ? "success"
            : project.lastUpdateStatus === "at_risk"
              ? "warning"
              : project.lastUpdateStatus === "off_track"
                ? "danger"
                : "default"
        }
      />
      <SmartButton
        icon={<FileText className="size-4" />}
        label="المستندات"
        value="—"
        tone="default"
      />
    </div>
  );
}

/* ─────────────────────── Tab panels ─────────────────────── */
function MemberRow({
  role,
  name,
  color,
}: {
  role: string;
  name: string | null;
  color: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar size="sm" className="size-8">
          <AvatarFallback
            className="text-[12px]"
            style={{ backgroundColor: name ? color : "transparent", color: "#fff" }}
          >
            {name ? name.trim()[0] ?? "?" : "—"}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="text-[13px] font-medium">{name ?? "—"}</div>
          <div className="text-[11px] text-muted-foreground">{role}</div>
        </div>
      </div>
    </li>
  );
}

function MembersPanel({
  project,
}: {
  project: Awaited<ReturnType<typeof getLiveProject>> extends infer T
    ? T extends null ? never : NonNullable<T> : never;
}) {
  const stripe = odooColor(project.color || 11);
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          <MemberRow role="مدير المشروع" name={project.managerName} color={stripe} />
          <MemberRow role="مدير الحساب" name={project.accountManagerName} color={stripe} />
          <MemberRow role="SEO Specialist" name={project.seoSpecialistName ?? null} color={stripe} />
          <MemberRow role="Media Specialist" name={project.mediaSpecialistName ?? null} color={stripe} />
          <MemberRow role="Social Specialist" name={project.socialSpecialistName ?? null} color={stripe} />
        </ul>
      </CardContent>
    </Card>
  );
}

function SettingsPanel({
  project,
}: {
  project: Awaited<ReturnType<typeof getLiveProject>> extends infer T
    ? T extends null ? never : NonNullable<T> : never;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-[13px]">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Ref</span>
          <span className="font-mono tabular-nums">{project.ref}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Odoo ID</span>
          <span className="tabular-nums">{project.odooId}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Target</span>
          <span>{project.target ?? "—"}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Last Update Status</span>
          <span>{project.lastUpdateStatus ?? "—"}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">المفضلة</span>
          <span>{project.isFavorite ? "نعم" : "لا"}</span>
        </div>
      </CardContent>
    </Card>
  );
}

