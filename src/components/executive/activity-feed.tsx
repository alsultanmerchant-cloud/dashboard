import { Activity, AlertTriangle, Briefcase, Clock, FileSignature, ListChecks, ShieldAlert, ShieldCheck, Send, Sparkles, Target, Users } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AI_EVENT_META } from "@/lib/labels";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { relativeTimeAr } from "@/lib/utils-format";
import { cn } from "@/lib/utils";

function eventIcon(eventType: string) {
  if (eventType.startsWith("HANDOVER")) return Send;
  if (eventType.startsWith("CLIENT")) return Users;
  if (eventType.startsWith("PROJECT")) return Briefcase;
  if (eventType.startsWith("CONTRACT") || eventType.startsWith("RENEWAL")) return FileSignature;
  if (eventType.startsWith("EXCEPTION") || eventType.startsWith("ESCALATION")) return ShieldAlert;
  if (eventType.startsWith("GOVERNANCE")) return ShieldCheck;
  if (eventType.startsWith("SLA") || eventType.startsWith("TASK_OVERDUE")) return AlertTriangle;
  if (eventType.startsWith("EMPLOYEE") || eventType.startsWith("ORG")) return Users;
  if (eventType.startsWith("WEEKLY_DIGEST")) return ListChecks;
  if (eventType.startsWith("TASK")) return Target;
  return Activity;
}

interface Event {
  id: string;
  event_type: string;
  created_at: string;
  importance: string | null;
}

export async function ExecutiveActivityFeed({ events }: { events: Event[] }) {
  const t = await getTranslations("Executive.activity");

  const filtered = events
    .filter((a) => {
      const meta = AI_EVENT_META[a.event_type];
      return !meta || meta.tier !== "noise";
    })
    .slice(0, 6);

  if (filtered.length === 0) {
    return (
      <EmptyState
        variant="compact"
        icon={<Activity className="size-6" />}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border/40">
          {filtered.map((a) => {
            const meta = AI_EVENT_META[a.event_type];
            const label = meta?.label ?? a.event_type;
            const isHigh = a.importance === "high" || a.importance === "critical";
            const tone = isHigh
              ? "bg-red-dim text-cc-red"
              : meta?.tier === "key"
                ? "bg-cyan-dim text-cyan"
                : "bg-soft-2 text-muted-foreground";
            const Icon = eventIcon(a.event_type);
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn("flex size-8 items-center justify-center rounded-lg shrink-0", tone)}>
                    <Icon className="size-4" />
                  </div>
                  <p className="truncate text-sm font-medium">{label}</p>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="size-3" />
                  {relativeTimeAr(a.created_at)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-border/40 px-4 py-2 text-left">
          <Link href="/ai-insights" className="text-[11px] text-cyan hover:underline inline-flex items-center gap-1">
            <Sparkles className="size-3" />
            {t("viewAll")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
