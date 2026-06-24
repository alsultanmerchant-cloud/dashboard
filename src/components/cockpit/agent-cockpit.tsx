import { Suspense } from "react";
import Link from "next/link";
import { getNow, getTranslations } from "next-intl/server";
import { getLocale } from "@/i18n/locale";
import {
  AlertTriangle,
  CalendarClock,
  CalendarCheck,
  CalendarDays,
  UploadCloud,
  AtSign,
  MessageCircle,
  CheckSquare2,
  FolderKanban,
  ListChecks,
  Flame,
  ShieldAlert,
  ArrowLeft,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ServerSession } from "@/lib/auth-server";
import {
  getMyWork,
  getMyMentions,
  getMyChats,
  getActionRequired,
} from "@/lib/data/cockpit";
import { listMyOpenActivities } from "@/lib/data/my-activities";
import { buildAgentPrioritySignals } from "@/lib/agent-priorities/signals";
import { buildAgentTipContext } from "@/lib/tech-tips/context";
import { getAgentAiCache } from "@/lib/data/agent-ai-cache";
import type { AgentTechTipAi } from "@/lib/tech-tips/schema";
import type { CachedPriorityAi } from "@/components/cockpit/today-priorities";
import { cleanTaskTitle } from "@/components/cockpit/task-row";
import { MyTasksPanel } from "@/components/cockpit/my-tasks-panel";
import { AutoRefresh } from "@/components/cockpit/auto-refresh";
import { TodayPriorities, type PriorityItem } from "@/components/cockpit/today-priorities";
import { TechTipCard } from "@/components/cockpit/tech-tip-card";
import { GrowthSection } from "@/components/cockpit/growth-section";
import { DeliveryCommitmentCard } from "@/components/performance/delivery-commitment-card";
import { MonthlyHistorySection } from "@/components/performance/monthly-history-section";

// ---- Section 1: Work Snapshot --------------------------------------------

type TileAccent = "red" | "amber" | "cyan" | "green";

function HeroTile({ href, label, value, hint, icon: Icon, accent }: {
  href: string; label: string; value: number; hint: string; icon: typeof CheckSquare2;
  accent: TileAccent;
}) {
  const map = {
    red: { border: value > 0 ? "border-cc-red/30" : "border-border", icon: "bg-red-dim text-cc-red", val: value > 0 ? "text-cc-red" : "text-muted-foreground" },
    amber: { border: value > 0 ? "border-amber/30" : "border-border", icon: "bg-amber-dim text-amber", val: value > 0 ? "text-amber" : "text-muted-foreground" },
    cyan: { border: "border-cyan/20", icon: "bg-cyan-dim text-cyan", val: "text-foreground" },
    green: { border: "border-cc-green/20", icon: "bg-green-dim text-cc-green", val: "text-foreground" },
  }[accent];
  return (
    <Link href={href} className={cn("group rounded-2xl border bg-gradient-to-br from-card to-card/40 p-4 transition-all hover:shadow-[0_0_30px_rgba(0,212,255,0.08)]", map.border)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg", map.icon)}><Icon className="size-4" /></span>
      </div>
      <div className={cn("mt-3 text-4xl font-bold leading-none tabular-nums", map.val)}>{value}</div>
      <div className="mt-2 text-[11px] text-muted-foreground">{hint}</div>
    </Link>
  );
}

async function SnapshotSection({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const [work, t, now] = await Promise.all([
    getMyWork(orgId, employeeId),
    getTranslations("AgentCockpit"),
    getNow(),
  ]);
  const c = work.counts;
  const empty = c.open === 0;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* Drill-downs are scoped to the agent (`mine`) and open the kanban
            board. Active-projects groups that board by project so she sees the
            projects she's assigned in as columns. */}
        <HeroTile href="/tasks?view=kanban&groupBy=project&filter=mine,open" label={t("activeProjects")} value={c.activeProjects} hint={t("activeProjectsHint")} icon={FolderKanban} accent="cyan" />
        <HeroTile href="/tasks?view=kanban&filter=mine,open" label={t("openTasks")} value={c.open} hint={t("incomplete")} icon={ListChecks} accent="cyan" />
        <HeroTile href="/tasks?view=kanban&filter=mine,overdue" label={t("overdue")} value={c.overdue} hint={t("pastDeadline")} icon={AlertTriangle} accent="red" />
        <HeroTile href="/tasks?view=kanban&filter=mine,due_today" label={t("dueToday")} value={c.today} hint={t("dueTodayHint")} icon={CalendarClock} accent="amber" />
        <HeroTile href="/tasks?view=kanban&filter=mine,open,due_week" label={t("thisWeek")} value={c.dueWeek} hint={t("withinDays", { count: 7 })} icon={CalendarDays} accent="green" />
      </div>

      <SectionTitle title={t("myTasks")} description={t("startUrgent")} />
      <div className="mb-8">
        {empty ? (
          <Card>
            <CardContent className="p-4">
              <p className="py-6 text-center text-sm text-muted-foreground">{t("noOpenTasks")}</p>
            </CardContent>
          </Card>
        ) : (
          <MyTasksPanel
            overdue={work.overdue}
            today={work.today}
            upcoming={work.upcoming}
            now={now.getTime()}
          />
        )}
      </div>
    </>
  );
}

// ---- Section 2: Action Required ------------------------------------------

function ActionRow({ href, title, taskCode, trailing, tone }: {
  href: string; title: string; taskCode?: string | null; trailing: React.ReactNode; tone: string;
}) {
  return (
    <Link href={href} className={cn("flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-xs transition-all", tone)}>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="truncate">{cleanTaskTitle(title)}</span>
        {taskCode ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground ltr">{taskCode}</span> : null}
      </span>
      {trailing}
    </Link>
  );
}

function ActionBlock({ icon: Icon, tone, title, count, children }: {
  icon: typeof UploadCloud; tone: string; title: string; count: number; children: React.ReactNode;
}) {
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className={cn("flex size-7 items-center justify-center rounded-lg", tone)}><Icon className="size-3.5" /></span>
          <span className="text-xs font-semibold">{title}</span>
          <span className="ml-auto rounded-full bg-soft-1 px-2 text-[10px] font-bold tabular-nums text-muted-foreground">{count}</span>
        </div>
        <div className="space-y-1.5">{children}</div>
      </CardContent>
    </Card>
  );
}

async function ActionRequiredSection({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const [data, t] = await Promise.all([
    getActionRequired(orgId, employeeId),
    getTranslations("AgentCockpit"),
  ]);
  const showUpload = data.flags.hasUploadRole && data.needsUpload.length > 0;
  const showReview = data.flags.hasReviewRole && data.stuckInReview.length > 0;
  const showBreaches = data.slaBreaches.length > 0;

  // Hide the whole section when nothing applies to this role / nothing pending.
  if (!showUpload && !showReview && !showBreaches) return null;

  return (
    <section className="mb-8">
      <SectionTitle title={t("actionRequired")} description={t("actionRequiredDescription")} />
      <div className="grid gap-4 lg:grid-cols-3">
        {showUpload && (
          <ActionBlock icon={UploadCloud} tone="bg-cyan-dim text-cyan" title={t("uploadNeeded")} count={data.needsUpload.length}>
            {data.needsUpload.slice(0, 6).map((r) => (
              <ActionRow
                key={r.id}
                href={`/tasks/${r.id}`}
                title={r.title}
                tone="border-border/60 hover:border-cyan/40"
                trailing={
                  <span className={cn("shrink-0 rounded-full px-1.5 text-[10px] font-medium tabular-nums", r.bucket === "overdue" ? "bg-red-dim text-cc-red" : "bg-amber-dim text-amber")}>
                    {r.bucket === "overdue"
                      ? t("relative.overdue", { count: -r.days_delta })
                      : t("relative.today")}
                  </span>
                }
              />
            ))}
          </ActionBlock>
        )}

        {showReview && (
          <ActionBlock icon={ShieldAlert} tone="bg-purple-dim text-cc-purple" title={t("awaitingReview")} count={data.stuckInReview.length}>
            {data.stuckInReview.slice(0, 6).map((r) => (
              <ActionRow
                key={r.id}
                href={`/tasks/${r.id}`}
                title={r.title}
                taskCode={r.taskCode}
                tone={r.breachedSla ? "border-cc-red/30 hover:border-cc-red/50" : "border-border/60 hover:border-cyan/40"}
                trailing={
                  <span className={cn("shrink-0 rounded-full px-1.5 text-[10px] font-medium tabular-nums", r.breachedSla ? "bg-red-dim text-cc-red" : "bg-soft-1 text-muted-foreground")}>
                    {t("hoursShort", { count: r.hoursWaiting })}
                  </span>
                }
              />
            ))}
          </ActionBlock>
        )}

        {showBreaches && (
          <ActionBlock icon={Flame} tone="bg-red-dim text-cc-red" title={t("slaBreached")} count={data.slaBreaches.length}>
            {data.slaBreaches.slice(0, 6).map((r) => (
              <ActionRow
                key={r.id}
                href={`/tasks/${r.id}`}
                title={r.title}
                taskCode={r.taskCode}
                tone="border-cc-red/30 hover:border-cc-red/50"
                trailing={
                  <span className="shrink-0 rounded-full bg-red-dim px-1.5 text-[10px] font-medium tabular-nums text-cc-red">
                    +{t("hoursShort", { count: r.hoursOver })}
                  </span>
                }
              />
            ))}
          </ActionBlock>
        )}
      </div>
    </section>
  );
}

// ---- Section 3: Today Priorities (AI) ------------------------------------

async function PrioritiesSection({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const locale = await getLocale();
  const [signals, cached] = await Promise.all([
    buildAgentPrioritySignals(orgId, employeeId, locale),
    getAgentAiCache<CachedPriorityAi>(orgId, employeeId, "today_priorities"),
  ]);
  const items: PriorityItem[] = signals.map((s) => ({
    taskId: s.taskId,
    title: s.title,
    taskCode: s.taskCode,
    stage: s.stage,
    projectName: s.projectName,
    clientName: s.clientName,
    isOverdue: s.isOverdue,
    slaOverByHours: s.slaOverByHours,
    uploadSoon: s.uploadSoon,
    dependentsCount: s.dependentsCount,
    reasonHint: s.reasonHint,
    actionHint: s.actionHint,
  }));
  return (
    <TodayPriorities
      initialItems={items}
      initialAi={cached?.payload ?? null}
      generatedAt={cached?.generatedAt ?? null}
    />
  );
}

// ---- Technical tip (AI, specialization-aware) ----------------------------

async function TechTipSection({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const locale = await getLocale();
  const [ctx, cached] = await Promise.all([
    buildAgentTipContext(orgId, employeeId, locale),
    getAgentAiCache<AgentTechTipAi>(orgId, employeeId, "tech_tip"),
  ]);
  return (
    <TechTipCard
      specialization={ctx.specialization}
      focusTask={ctx.focusTask ? { id: ctx.focusTask.id, title: ctx.focusTask.title } : null}
      initial={cached?.payload ?? null}
      generatedAt={cached?.generatedAt ?? null}
    />
  );
}

// ---- Secondary panels (activities + inbox) -------------------------------

function PanelHeader({ icon: Icon, tone, title }: { icon: typeof CheckSquare2; tone: string; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className={cn("flex size-7 items-center justify-center rounded-lg", tone)}><Icon className="size-3.5" /></span>
      <span className="text-xs font-semibold">{title}</span>
    </div>
  );
}

async function ActivitiesSection({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const [rows, t, now] = await Promise.all([
    listMyOpenActivities(orgId, employeeId, 6),
    getTranslations("AgentCockpit"),
    getNow(),
  ]);
  const relDay = (d: string | null): string => {
    if (!d) return "—";
    const days = Math.round((new Date(d).getTime() - now.getTime()) / 86_400_000);
    if (days === 0) return t("relative.today");
    if (days < 0) return t("relative.overdue", { count: -days });
    if (days === 1) return t("relative.tomorrow");
    return t("relative.inDays", { count: days });
  };
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <PanelHeader icon={CalendarCheck} tone="bg-purple-dim text-cc-purple" title={t("scheduledActivities")} />
        {rows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t("noScheduledActivities")}</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <Link key={r.id} href={`/tasks/${r.task_id}`} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-2.5 py-2 text-xs transition-all hover:border-cyan/40">
                <span className="truncate">{r.summary || r.task_title}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{relDay(r.due_date)}</span>
              </Link>
            ))}
          </div>
        )}
        <Link href="/my-activities" className="mt-3 inline-flex items-center gap-1 text-[11px] text-cyan hover:underline">
          {t("allActivities")} <ArrowLeft className="size-3 rtl:rotate-0 ltr:rotate-180" />
        </Link>
      </CardContent>
    </Card>
  );
}

async function InboxSection({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const [mentions, chats, t] = await Promise.all([
    getMyMentions(orgId, employeeId),
    getMyChats(orgId, employeeId),
    getTranslations("AgentCockpit"),
  ]);
  const empty = mentions.length === 0 && chats.unreadTotal === 0;
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <PanelHeader icon={AtSign} tone="bg-green-dim text-cc-green" title={t("mentionsAndChats")} />
        {empty ? (
          <p className="text-[11px] text-muted-foreground">{t("noMentionsOrMessages")}</p>
        ) : (
          <div className="space-y-1.5">
            {mentions.slice(0, 4).map((m) => (
              <Link key={m.id} href={m.taskId ? `/tasks/${m.taskId}` : "#"} className="flex items-center gap-2 rounded-xl border border-border/60 px-2.5 py-2 text-xs transition-all hover:border-cyan/40">
                <AtSign className="size-3 shrink-0 text-cyan" />
                <span className="truncate">{m.taskTitle ? cleanTaskTitle(m.taskTitle) : t("taskFallback")} — {m.body?.slice(0, 36)}</span>
              </Link>
            ))}
            {chats.unreadTotal > 0 && (
              <Link href="/messages" className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-2.5 py-2 text-xs transition-all hover:border-cyan/40">
                <span className="inline-flex items-center gap-1.5"><MessageCircle className="size-3 text-cc-green" /> {t("unreadMessages")}</span>
                <span className="rounded-full bg-green-dim px-2 text-[10px] font-bold text-cc-green tabular-nums">{chats.unreadTotal}</span>
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export async function AgentCockpit({ session, employeeId }: { session: ServerSession; employeeId: string }) {
  const orgId = session.orgId;
  const t = await getTranslations("AgentCockpit");
  return (
    <div>
      <PageHeader title={t("welcome", { name: session.fullName })} description={t("description")} />
      {/* Keep the snapshot + action numbers live without a manual reload. */}
      <AutoRefresh />

      <Suspense fallback={<Skeleton className="mb-6 h-[340px] rounded-2xl" />}>
        <SnapshotSection orgId={orgId} employeeId={employeeId} />
      </Suspense>

      <Suspense fallback={<Skeleton className="mb-8 h-[160px] rounded-2xl" />}>
        <ActionRequiredSection orgId={orgId} employeeId={employeeId} />
      </Suspense>

      <section className="mb-8">
        <SectionTitle title={t("priorities.title")} description={t("priorities.description")} />
        <Suspense fallback={<Skeleton className="h-[200px] rounded-2xl" />}>
          <PrioritiesSection orgId={orgId} employeeId={employeeId} />
        </Suspense>
      </section>

      <section className="mb-8">
        <SectionTitle title={t("delivery.title")} description={t("delivery.description")} />
        <Suspense fallback={<Skeleton className="h-[220px] rounded-2xl" />}>
          <DeliveryCommitmentCard orgId={orgId} employeeId={employeeId} />
        </Suspense>
      </section>

      <section className="mb-8">
        <SectionTitle title={t("growth.title")} description={t("growth.description")} />
        <Suspense fallback={<Skeleton className="h-[260px] rounded-2xl" />}>
          <GrowthSection orgId={orgId} employeeId={employeeId} />
        </Suspense>
      </section>

      <section className="mb-8">
        <SectionTitle title={t("monthlyHistory.title")} description={t("monthlyHistory.description")} />
        <Suspense fallback={<Skeleton className="h-[200px] rounded-2xl" />}>
          <MonthlyHistorySection orgId={orgId} employeeId={employeeId} />
        </Suspense>
      </section>

      <section className="mb-8">
        <SectionTitle title={t("techTip.title")} description={t("techTip.description")} />
        <Suspense fallback={<Skeleton className="h-[160px] rounded-2xl" />}>
          <TechTipSection orgId={orgId} employeeId={employeeId} />
        </Suspense>
      </section>

      <SectionTitle title={t("mySpace")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-[200px] rounded-2xl" />}>
          <ActivitiesSection orgId={orgId} employeeId={employeeId} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-[200px] rounded-2xl" />}>
          <InboxSection orgId={orgId} employeeId={employeeId} />
        </Suspense>
      </div>
    </div>
  );
}
