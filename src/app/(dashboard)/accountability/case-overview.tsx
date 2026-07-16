"use client";

import Link from "next/link";
import { AlertOctagon, ArrowLeft, History, Layers, Repeat } from "lucide-react";
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
  const { exposure, asks, patterns, history } = brief;

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
      </p>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* ---- 2. The three asks ---- */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <AlertOctagon className="size-3.5 text-cc-red" />
              تعامل مع هؤلاء أولًا
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              مرتّبون بقيمة ما يتعثّر تحت أيديهم، لا بعدد الأدلة.
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

        <div className="space-y-3">
          {/* ---- 3. Systemic patterns ---- */}
          <Card>
            <CardContent className="p-4">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Layers className="size-3.5 text-cyan" />
                نمط متكرّر — لا تقصير فردي
              </p>
              {patterns.length === 0 ? (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  لا يوجد تركّز واضح في مرحلة أو قسم — التعثّر موزّع على حالات فردية.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {patterns.map((p) => (
                    <li key={`${p.kind}-${p.key}`} className="rounded-lg border border-border bg-soft-1/40 p-2.5">
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{p.text}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold tabular-nums text-foreground/70" dir="ltr">
                          {p.tasks} tasks · {p.people} people · {p.worstDays}d
                        </span>
                        {p.href && (
                          <Link
                            href={p.href}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-cyan hover:underline"
                          >
                            افتح المهام
                            <ArrowLeft className="size-3" />
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ---- 4. What moved ---- */}
          {history && (
            <Card>
              <CardContent className="p-4">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <History className="size-3.5 text-cyan" />
                  ما تغيّر هذا الأسبوع
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Stat value={history.newCases} label="قضية جديدة" tone="text-amber" />
                  <Stat value={history.reopened} label="عادت بعد إغلاقها" tone="text-cc-red" icon={Repeat} />
                  <Stat value={history.resolvedInWindow} label="انتهت" tone="text-cc-green" />
                  <Stat value={history.longRunning} label="مزمنة (٥ رصدات+)" tone="text-foreground" />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/70">
                  {history.decided} من {history.openCases + history.decided} قضية حالية اتُّخذ فيها قرار.
                </p>
                {/* first_seen_at is floored by the store's own start date, so the
                    day-zero cohort is excluded from "new" rather than inflating it. */}
                {history.partial && (
                  <p className="mt-1.5 rounded-md border border-border bg-soft-1/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground/70">
                    الرصد بدأ في{" "}
                    <span dir="ltr" className="tabular-nums">
                      {history.trackingSince}
                    </span>
                    ، لذا «الجديدة» تحسب فقط ما ظهر بعد ذلك اليوم — القضايا الأقدم عمرها الحقيقي غير معروف.
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
        {a.employeeId ? (
          <Link
            href={`/accountability?emp=${a.employeeId}&view=scorecard`}
            className="text-sm font-bold hover:text-cyan"
          >
            {a.employeeName}
          </Link>
        ) : (
          <span className="text-sm font-bold">{a.employeeName}</span>
        )}
        <span className="text-[10px] text-muted-foreground">
          {a.role ?? "—"}
          {a.department ? ` · ${a.department}` : ""}
        </span>
        {a.contractValue > 0 && (
          <span
            className="rounded-md border border-amber/25 bg-amber-dim px-1.5 py-0.5 text-[10px] font-bold text-amber tabular-nums"
            dir="ltr"
            title="قيمة عقود العملاء المتأثّرين بعمله المتعثّر"
          >
            {money(a.contractValue)} ر.س
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
          العملاء: {a.clientNames.join("، ")}
          {a.moreClients > 0 && ` +${a.moreClients}`}
        </p>
      )}
    </div>
  );
}
