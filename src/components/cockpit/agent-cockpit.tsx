import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CalendarCheck,
  UploadCloud,
  AtSign,
  MessageCircle,
  CheckSquare2,
  ArrowLeft,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ServerSession } from "@/lib/auth-server";
import { getMyWork, getMyMentions, getMyChats, type MyTaskItem, type MyWork } from "@/lib/data/cockpit";
import { listMyUploadQueue } from "@/lib/data/uploads";
import { listMyActivities } from "@/lib/data/my-activities";
import { TaskRow, cleanTaskTitle } from "@/components/cockpit/task-row";

const NA = "—";

function relDay(d: string | null): string {
  if (!d) return NA;
  const days = Math.round((new Date(d).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return "اليوم";
  if (days < 0) return `متأخر ${-days}ي`;
  if (days === 1) return "غدًا";
  return `بعد ${days}ي`;
}

const BUCKET_DUE = {
  overdue: "text-cc-red",
  today: "text-amber",
  upcoming: "text-muted-foreground",
} as const;

const BUCKET_ACCENT = {
  overdue: "red",
  today: "amber",
  upcoming: "cyan",
} as const;

function TaskLine({ t }: { t: MyTaskItem }) {
  return (
    <TaskRow
      href={`/tasks/${t.id}`}
      title={t.title}
      taskCode={t.taskCode}
      meta={t.clientName ?? t.projectName}
      stage={t.stage}
      priority={t.priority}
      progressPercent={t.progressPercent}
      accent={BUCKET_ACCENT[t.bucket]}
      trailing={
        <span className={cn("text-[10px] font-semibold tabular-nums", BUCKET_DUE[t.bucket])}>{relDay(t.dueDate)}</span>
      }
    />
  );
}

function HeroTile({ href, label, value, hint, icon: Icon, accent }: {
  href: string; label: string; value: number; hint: string; icon: typeof CheckSquare2;
  accent: "red" | "amber" | "cyan";
}) {
  const map = {
    red: { border: value > 0 ? "border-cc-red/30" : "border-border", icon: "bg-red-dim text-cc-red", val: value > 0 ? "text-cc-red" : "text-muted-foreground" },
    amber: { border: value > 0 ? "border-amber/30" : "border-border", icon: "bg-amber-dim text-amber", val: value > 0 ? "text-amber" : "text-muted-foreground" },
    cyan: { border: "border-cyan/20", icon: "bg-cyan-dim text-cyan", val: "text-foreground" },
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

function Group({ items, title, tone }: { items: MyTaskItem[]; title: string; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={cn("mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]", tone)}>{title}</p>
      <div className="space-y-1.5">{items.map((t) => <TaskLine key={t.id} t={t} />)}</div>
    </div>
  );
}

async function MyWorkSection({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const work: MyWork = await getMyWork(orgId, employeeId);
  const empty = work.counts.overdue + work.counts.today + work.counts.upcoming === 0;
  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <HeroTile href="/tasks?filter=overdue" label="متأخرة" value={work.counts.overdue} hint="مهام تجاوزت موعدها" icon={AlertTriangle} accent="red" />
        <HeroTile href="/tasks" label="تسليم اليوم" value={work.counts.today} hint="مستحقة اليوم" icon={CalendarClock} accent="amber" />
        <HeroTile href="/tasks" label="قادم" value={work.counts.upcoming} hint="مهام قادمة" icon={CalendarCheck} accent="cyan" />
      </div>

      <SectionTitle title="مهامي" description="ابدأ بالأكثر إلحاحًا" />
      <Card className="mb-8">
        <CardContent className="space-y-4 p-4">
          {empty ? (
            <p className="py-6 text-center text-sm text-muted-foreground">لا مهام مفتوحة لديك حاليًا 🎉</p>
          ) : (
            <>
              <Group items={work.overdue} title="متأخرة" tone="text-cc-red" />
              <Group items={work.today} title="تسليم اليوم" tone="text-amber" />
              <Group items={work.upcoming} title="قادم" tone="text-muted-foreground" />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function PanelHeader({ icon: Icon, tone, title }: { icon: typeof CheckSquare2; tone: string; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className={cn("flex size-7 items-center justify-center rounded-lg", tone)}><Icon className="size-3.5" /></span>
      <span className="text-xs font-semibold">{title}</span>
    </div>
  );
}

async function UploadsSection({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const rows = await listMyUploadQueue(orgId, employeeId);
  const due = rows.filter((r) => r.bucket === "overdue" || r.bucket === "today");
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <PanelHeader icon={UploadCloud} tone="bg-cyan-dim text-cyan" title="مواعيد الرفع اليوم" />
        {due.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">لا مواعيد رفع مستحقة اليوم.</p>
        ) : (
          <div className="space-y-1.5">
            {due.slice(0, 6).map((r) => (
              <Link key={r.id} href={`/tasks/${r.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-2.5 py-2 text-xs transition-all hover:border-cyan/40">
                <span className="truncate">{r.title}</span>
                <span className={cn("shrink-0 rounded-full px-1.5 text-[10px] font-medium tabular-nums", r.bucket === "overdue" ? "bg-red-dim text-cc-red" : "bg-amber-dim text-amber")}>
                  {r.bucket === "overdue" ? `متأخر ${-r.days_delta}ي` : "اليوم"}
                </span>
              </Link>
            ))}
          </div>
        )}
        <Link href="/uploads" className="mt-3 inline-flex items-center gap-1 text-[11px] text-cyan hover:underline">
          كل مواعيد الرفع <ArrowLeft className="size-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

async function ActivitiesSection({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const rows = await listMyActivities(orgId, employeeId);
  const open = rows.filter((r) => !r.completed_at).slice(0, 6);
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <PanelHeader icon={CalendarCheck} tone="bg-purple-dim text-cc-purple" title="أنشطتي المجدولة" />
        {open.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">لا أنشطة مجدولة.</p>
        ) : (
          <div className="space-y-1.5">
            {open.map((r) => (
              <Link key={r.id} href={`/tasks/${r.task_id}`} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-2.5 py-2 text-xs transition-all hover:border-cyan/40">
                <span className="truncate">{r.summary || r.task_title}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{relDay(r.due_date)}</span>
              </Link>
            ))}
          </div>
        )}
        <Link href="/my-activities" className="mt-3 inline-flex items-center gap-1 text-[11px] text-cyan hover:underline">
          كل الأنشطة <ArrowLeft className="size-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

async function InboxSection({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const [mentions, chats] = await Promise.all([getMyMentions(orgId, employeeId), getMyChats(orgId, employeeId)]);
  const empty = mentions.length === 0 && chats.unreadTotal === 0;
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <PanelHeader icon={AtSign} tone="bg-green-dim text-cc-green" title="إشارات ومحادثات" />
        {empty ? (
          <p className="text-[11px] text-muted-foreground">لا إشارات أو رسائل غير مقروءة.</p>
        ) : (
          <div className="space-y-1.5">
            {mentions.slice(0, 4).map((m) => (
              <Link key={m.id} href={m.taskId ? `/tasks/${m.taskId}` : "#"} className="flex items-center gap-2 rounded-xl border border-border/60 px-2.5 py-2 text-xs transition-all hover:border-cyan/40">
                <AtSign className="size-3 shrink-0 text-cyan" />
                <span className="truncate">{m.taskTitle ? cleanTaskTitle(m.taskTitle) : "مهمة"} — {m.body?.slice(0, 36)}</span>
              </Link>
            ))}
            {chats.unreadTotal > 0 && (
              <Link href="/messages" className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-2.5 py-2 text-xs transition-all hover:border-cyan/40">
                <span className="inline-flex items-center gap-1.5"><MessageCircle className="size-3 text-cc-green" /> رسائل غير مقروءة</span>
                <span className="rounded-full bg-green-dim px-2 text-[10px] font-bold text-cc-green tabular-nums">{chats.unreadTotal}</span>
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AgentCockpit({ session, employeeId }: { session: ServerSession; employeeId: string }) {
  const orgId = session.orgId;
  return (
    <div>
      <PageHeader title={`مرحبًا ${session.fullName}`} description="مساحتك: ما الذي يحتاج عملك الآن" />

      <Suspense fallback={<Skeleton className="mb-6 h-[340px] rounded-2xl" />}>
        <MyWorkSection orgId={orgId} employeeId={employeeId} />
      </Suspense>

      <SectionTitle title="مساحتي" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<Skeleton className="h-[200px] rounded-2xl" />}>
          <UploadsSection orgId={orgId} employeeId={employeeId} />
        </Suspense>
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
