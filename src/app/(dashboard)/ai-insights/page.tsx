import {
  Sparkles, AlertTriangle, Clock, Activity, Repeat, Lightbulb,
  TrendingUp, Inbox, ListTodo, MessageSquare, AtSign, Bell,
} from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import { getAiEventCounts, getActivityFeed } from "@/lib/data/dashboard";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AI_EVENT_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

const EVENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  HANDOVER_SUBMITTED: Inbox,
  PROJECT_CREATED: Sparkles,
  PROJECT_SERVICE_ATTACHED: TrendingUp,
  TASK_CREATED: ListTodo,
  TASK_STATUS_CHANGED: Activity,
  TASK_COMMENT_ADDED: MessageSquare,
  MENTION_CREATED: AtSign,
  NOTIFICATION_CREATED: Bell,
  TASK_OVERDUE_DETECTED: AlertTriangle,
  CLIENT_CREATED: Sparkles,
};

export default async function AiInsightsPage() {
  const session = await requireSession();
  const [counts, recent] = await Promise.all([
    getAiEventCounts(session.orgId),
    getActivityFeed(session.orgId, 20),
  ]);

  const insights = [
    {
      title: "المخاطر اليومية",
      description: "إشارات تحتاج اهتمام فوري — تأخر تسليم، توقف مهمة، أو حالة حرجة في تسليم جديد.",
      icon: <AlertTriangle className="size-5" />,
      tone: "destructive" as const,
      readyIn: "Phase 9",
    },
    {
      title: "المهام المتأخرة",
      description: "ملخص المهام التي تجاوزت تاريخ التسليم، مع توقعات الأسباب الشائعة.",
      icon: <Clock className="size-5" />,
      tone: "warning" as const,
      readyIn: "Phase 9",
    },
    {
      title: "صحة المشاريع",
      description: "نظرة لكل مشروع: نسبة الإنجاز، التواصل، التأخيرات، وأبرز المخاطر.",
      icon: <Activity className="size-5" />,
      tone: "info" as const,
      readyIn: "Phase 9",
    },
    {
      title: "نشاط الفريق",
      description: "كثافة العمل لكل عضو، توزيع المهام، ومناطق الضغط.",
      icon: <TrendingUp className="size-5" />,
      tone: "success" as const,
      readyIn: "Phase 9",
    },
    {
      title: "أنماط متكررة",
      description: "اكتشاف الأخطاء أو التأخيرات التي تتكرر عبر المشاريع لرفعها للإدارة.",
      icon: <Repeat className="size-5" />,
      tone: "purple" as const,
      readyIn: "Phase 9",
    },
    {
      title: "إجراءات مقترحة",
      description: "اقتراحات قابلة للتنفيذ مبنية على البيانات (إعادة توزيع · تذكيرات · تواصل مع عميل).",
      icon: <Lightbulb className="size-5" />,
      tone: "default" as const,
      readyIn: "Phase 9",
    },
  ];

  const eventTypes = Object.keys(counts.byType).sort(
    (a, b) => (counts.byType[b] ?? 0) - (counts.byType[a] ?? 0),
  );

  return (
    <div>
      <PageHeader
        title="الرؤى الذكية"
        description="رؤى مستخرجة تلقائيًا من نشاط الفريق. هذه المرحلة الأساسية تجمع الأحداث الذكية وتقدم اللقطة الإجمالية. التحليل المتقدم بالذكاء الاصطناعي يأتي في المرحلة التالية."
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Sparkles className="size-3 text-cyan" />
            بنية تحتية جاهزة · التحليل في مرحلة 9
          </Badge>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <MetricCard
          label="إجمالي الأحداث الذكية"
          value={counts.total}
          icon={<Sparkles className="size-5" />}
          tone="default"
        />
        <MetricCard
          label="أحداث عالية الأهمية"
          value={counts.importanceHigh}
          icon={<AlertTriangle className="size-5" />}
          tone="destructive"
        />
        <MetricCard
          label="أنواع الأحداث المسجَّلة"
          value={eventTypes.length}
          icon={<Activity className="size-5" />}
          tone="info"
        />
      </div>

      <SectionTitle
        title="بطاقات الرؤى"
        description="تظهر هنا تحليلات الذكاء الاصطناعي. تتفعل عند ربط النموذج التحليلي."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-10">
        {insights.map((c) => (
          <Card key={c.title}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className={cn(
                  "flex size-10 items-center justify-center rounded-xl",
                  c.tone === "destructive" && "bg-red-dim text-cc-red",
                  c.tone === "warning" && "bg-amber-dim text-amber",
                  c.tone === "info" && "bg-blue-dim text-cc-blue",
                  c.tone === "success" && "bg-green-dim text-cc-green",
                  c.tone === "purple" && "bg-purple-dim text-cc-purple",
                  c.tone === "default" && "bg-cyan-dim text-cyan",
                )}>
                  {c.icon}
                </div>
                <Badge variant="ghost" className="text-[10px]">{c.readyIn}</Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold">{c.title}</h3>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{c.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <SectionTitle
        title="توزيع الأحداث الذكية"
        description="عدد الأحداث المسجَّلة لكل نوع — يستخدمها النموذج التحليلي لاحقًا."
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mb-10">
        {eventTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground col-span-full rounded-xl border border-dashed border-white/10 bg-card/30 px-4 py-6 text-center">
            لم يُسجَّل أي حدث ذكي بعد.
          </p>
        ) : (
          eventTypes.map((t) => {
            const Icon = EVENT_ICONS[t] ?? Sparkles;
            const label = AI_EVENT_LABELS[t] ?? t;
            return (
              <Card key={t}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-dim text-cyan shrink-0">
                      <Icon className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{label}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{t}</p>
                    </div>
                  </div>
                  <span className="text-2xl font-bold tabular-nums text-cyan">
                    {counts.byType[t]}
                  </span>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <SectionTitle title="آخر 20 حدثًا" description="تيار حي للأحداث الذكية" />
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-white/[0.04]">
            {recent.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">لا يوجد نشاط بعد</li>
            ) : (
              recent.map((a) => {
                const Icon = EVENT_ICONS[a.event_type] ?? Sparkles;
                const label = AI_EVENT_LABELS[a.event_type] ?? a.event_type;
                const isHigh = a.importance === "high" || a.importance === "critical";
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={cn(
                      "flex size-8 items-center justify-center rounded-lg shrink-0",
                      isHigh ? "bg-cc-red/15 text-cc-red" : "bg-cyan-dim text-cyan",
                    )}>
                      <Icon className="size-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {a.entity_type ?? "—"} · {a.importance}
                      </p>
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0" dir="ltr">
                      {new Date(a.created_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
