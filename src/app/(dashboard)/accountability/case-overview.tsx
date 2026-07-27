"use client";

import { AlertOctagon, History, Repeat } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CaseAsk, CaseBrief } from "@/lib/data/accountability-case-brief";

// The CEO band above the case feed. The feed answers "can we prove it";
// this answers "what is it costing me, who do I deal with, is it my system,
// and is it getting better". Every number here is code-computed; nothing is
// AI-written. See [[project_accountability_cases]].

const SEV_DOT: Record<CaseAsk["severity"], string> = {
  critical: "bg-cc-red",
  proven: "bg-amber",
  signal: "bg-cyan",
};

function money(n: number): string {
  return n.toLocaleString("en-US");
}

export function CaseOverview({ brief }: { brief: CaseBrief }) {
  const { exposure, asks, history } = brief;

  return (
    <div className="space-y-3">
      {/* ---- Scope, not alarm ----
          This used to be a "العملاء تحت الخطر" card headlining the contract
          value behind every case. It was dropped: the bar for inclusion is
          "has one task past its deadline", which ~41% of the client base and
          55% of the live book clears on any given day — a number that flags
          half the company as at-risk is noise dressed as alarm, and it named
          nobody. Money now lives where it is actionable: on each ask row,
          beside a name. Client-level risk (overdue payments, churn) is owned by
          the CEO brief and /satisfaction — see [[project_dashboard_kpi_dedup]]. */}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <b className="text-foreground/80 tabular-nums">{exposure.stalledTasks}</b> مهمة متعثّرة تحت مسؤولية{" "}
        <b className="text-foreground/80 tabular-nums">{exposure.cases}</b> من الفريق · منها{" "}
        <b className="text-cc-red tabular-nums">{exposure.zeroActionTasks}</b> بلا أي إجراء من المسؤول عنها ·{" "}
        <b className="text-foreground/80 tabular-nums">{exposure.clients}</b> عميل متأثّر
        {/* Held work is excluded on purpose (HOLD/LOST tag or a dashboard hold):
            a paused task's slipped deadline is the consequence of a decision,
            not evidence against its owner. Stated so the scope reads as a
            choice rather than a number that quietly shrank. */}
        {exposure.heldTasksExcluded > 0 && (
          <>
            {" · "}
            <span className="text-muted-foreground/70">
              <b className="tabular-nums">{exposure.heldTasksExcluded}</b> مهمة مؤجَّلة (HOLD) مستثناة
            </span>
          </>
        )}
      </p>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <AlertOctagon className="size-3.5 text-cc-red" />
              تعامل مع هؤلاء أولًا
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              مرتّبون بالمال غير المحصَّل المعرَّض للخطر تحت أيديهم (دفعات متأخرة + تجديد متوقّع)، لا بعدد الأدلة.
            </p>
            <div className="mt-3 space-y-2.5">
              {asks.length === 0 ? (
                <p className="rounded-lg border border-cc-green/25 bg-green-dim px-3 py-4 text-center text-xs text-cc-green">
                  لا توجد قضايا مفتوحة.
                </p>
              ) : (
                asks.map((a, i) => <AskRow key={a.employeeId ?? a.employeeName} a={a} rank={i + 1} />)
              )}
            </div>
          </CardContent>
        </Card>

        <div>
          {history && (
            <Card>
              <CardContent className="p-4">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <History className="size-3.5 text-cyan" />
                  ما تغيّر خلال الفترة
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  المشاكل الجديدة، التي عادت بعد الإغلاق، والتي انتهت داخل الفترة المحددة.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Stat value={history.newProblems} label="مشكلة جديدة" tone="text-amber" />
                  <Stat value={history.reopened} label="عادت بعد إغلاقها" tone="text-cc-red" icon={Repeat} />
                  <Stat value={history.resolvedInWindow} label="انتهت" tone="text-cc-green" />
                  <Stat value={history.longRunning} label="مزمنة حاليًا (٥ رصدات+)" tone="text-foreground" />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/70">
                  {history.decided} من {history.openProblems + history.decided} مشكلة حالية اتُّخذ فيها قرار.
                </p>
                {/* first_seen_at is floored by the store's own start date, so the
                    day-zero cohort is excluded from "new" rather than inflating it. */}
                {history.partial && (
                  <p className="mt-1.5 rounded-md border border-border bg-soft-1/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground/70">
                    الرصد بدأ في{" "}
                    <span dir="ltr" className="tabular-nums">
                      {history.trackingSince}
                    </span>
                    ، لذا «الجديدة» تحسب فقط ما ظهر بعد ذلك اليوم — المشاكل الأقدم عمرها الحقيقي غير معروف.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  tone,
  icon: Icon,
}: {
  value: number;
  label: string;
  tone: string;
  icon?: typeof Repeat;
}) {
  return (
    <div className="rounded-lg border border-border bg-soft-1/40 px-2.5 py-2">
      <p className={cn("inline-flex items-center gap-1 text-lg font-bold tabular-nums", tone)} dir="ltr">
        {Icon && value > 0 && <Icon className="size-3.5" />}
        {value}
      </p>
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

function AskRow({ a, rank }: { a: CaseAsk; rank: number }) {
  return (
    <div className="rounded-lg border border-border bg-soft-1/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-soft-2 text-[10px] font-bold tabular-nums text-muted-foreground">
          {rank}
        </span>
        <span className={cn("size-1.5 rounded-full", SEV_DOT[a.severity])} aria-hidden />
        <span className="text-sm font-bold">{a.employeeName}</span>
        <span className="text-[10px] text-muted-foreground">
          {a.role ?? "—"}
          {a.department ? ` · ${a.department}` : ""}
        </span>
        {/* Money = what the affected clients haven't paid yet — not their
            total contract value (that read as portfolio size, unrelated to
            the problem). Two separate chips: dues already late, and the
            renewal money a stalled relationship threatens. */}
        {a.dueValue > 0 && (
          <span
            className="rounded-md border border-cc-red/25 bg-red-dim px-1.5 py-0.5 text-[10px] font-bold text-cc-red tabular-nums"
            title="دفعات متأخرة على العملاء المتأثّرين لم تُسدَّد بعد"
          >
            <span dir="ltr">{money(a.dueValue)}</span> ر.س مستحقّة
          </span>
        )}
        {a.renewalValue > 0 && (
          <span
            className="rounded-md border border-amber/25 bg-amber-dim px-1.5 py-0.5 text-[10px] font-bold text-amber tabular-nums"
            title="قيمة التجديد المتوقعة (الخدمات المتكررة) لعقود العملاء المتأثّرين"
          >
            <span dir="ltr">{money(a.renewalValue)}</span> ر.س تجديد متوقّع
          </span>
        )}
        {a.recurrenceNote && (
          <span className="inline-flex items-center gap-1 rounded-md border border-cc-red/25 bg-red-dim px-1.5 py-0.5 text-[10px] font-semibold text-cc-red">
            <Repeat className="size-3" />
            {a.recurrenceNote}
          </span>
        )}
      </div>

      {/* The ask leads; the proof backs it. */}
      <p className="mt-2 text-xs font-semibold leading-relaxed text-foreground">{a.ask}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{a.why}</p>
      {a.clientNames.length > 0 && (
        <p className="mt-1.5 text-[10px] text-muted-foreground/70">
          العملاء:{" "}
          {a.clientNames.map((name, i) => {
            // The heads only know the Rawasm/group names — the contract name
            // alone doesn't tell them which project this is about.
            const projects = a.clientProjects[name] ?? [];
            return (
              <span key={name}>
                {i > 0 && "، "}
                {name}
                {projects.length > 0 && (
                  <span className="text-[9px] text-muted-foreground/50">
                    {" "}
                    (رواسم: {projects.join("، ")})
                  </span>
                )}
              </span>
            );
          })}
          {a.moreClients > 0 && ` +${a.moreClients}`}
        </p>
      )}
    </div>
  );
}
