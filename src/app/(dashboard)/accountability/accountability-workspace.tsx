"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Gauge,
  Hourglass,
  Info,
  MousePointerClick,
  Quote,
  RefreshCw,
  Scale,
  Sparkles,
  Timer,
  TrendingDown,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  getAccountabilityEvidenceAction,
  refreshAccountabilityScorecardAction,
} from "./_actions";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FilterChip } from "@/components/filter-chip";
import { cn } from "@/lib/utils";
import { TASK_OWNER_ROLE_KEYS, TASK_OWNER_ROLE_LABELS } from "@/lib/labels";
import { ClientFinanceBadges } from "@/components/client-finance-badges";
import { Explained, MetricInfo } from "@/components/metric-info";
import { EmployeeEvidence } from "./employee-evidence";
import { ReviewerRigorSection as SharedReviewerRigorSection } from "./reviewer-rigor-section";
import { AccountabilityRangePicker } from "./accountability-range-picker";
import { AccountabilityPeriodTrend } from "./accountability-period-trend";
import type { ClientFinanceMap } from "@/lib/data/client-finance";
import type { DashboardRange } from "@/lib/dashboard-range";
import type {
  AccountabilityEvidence,
  AccountabilityOverview,
  AccountabilityScorecardRow,
  AiLinkedSignal,
  ReviewerRigorRow,
} from "@/lib/data/accountability";

const NA = "—";
// Filter bucket key for employees with no position set on /organization/employees.
const NONE_KEY = "__none__";

type SortKey = "onTime" | "overdue" | "trend" | "name";

type CoachIssueKind = "deadline" | "sla" | "rework" | "review" | "pending_review";

interface CoachIssue {
  id: string;
  employeeId: string;
  employeeName: string;
  position: string | null;
  kind: CoachIssueKind;
  severity: "critical" | "warning" | "watch";
  title: string;
  why: string;
  evidence: string;
  nextAction: string;
  source: string;
  sort: number;
}

interface Props {
  overview: AccountabilityOverview;
  evidence: AccountabilityEvidence | null;
  selectedId: string | null;
  financeMap: ClientFinanceMap;
  reviewerRange: DashboardRange;
}

// Low-confidence rows render neutral (never red): a tiny sample must not look
// like an indictment. Tone only kicks in at high confidence.
function scoreTone(score: number | null, lowConfidence: boolean): string {
  if (score === null || lowConfidence) return "text-muted-foreground";
  if (score >= 70) return "text-cc-green";
  if (score >= 50) return "text-amber";
  return "text-cc-red";
}

function scoreBadgeTone(score: number | null, lowConfidence: boolean): string {
  if (score === null || lowConfidence) return "border-border bg-soft-1 text-muted-foreground";
  if (score >= 70) return "border-cc-green/25 bg-green-dim text-cc-green";
  if (score >= 50) return "border-amber/25 bg-amber-dim text-amber";
  return "border-cc-red/25 bg-red-dim text-cc-red";
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function severityTone(severity: CoachIssue["severity"]): string {
  if (severity === "critical") return "border-cc-red/30 bg-red-dim text-cc-red";
  if (severity === "warning") return "border-amber/30 bg-amber-dim text-amber";
  return "border-cyan/25 bg-cyan/10 text-cyan";
}

function severityLabel(severity: CoachIssue["severity"]): string {
  if (severity === "critical") return "حرج";
  if (severity === "warning") return "يحتاج متابعة";
  return "راقب";
}

function strongerSeverity(
  a: CoachIssue["severity"],
  b: CoachIssue["severity"],
): CoachIssue["severity"] {
  const rank: Record<CoachIssue["severity"], number> = { critical: 3, warning: 2, watch: 1 };
  return rank[a] >= rank[b] ? a : b;
}

function coachIconFor(kind: CoachIssueKind) {
  if (kind === "deadline") return AlertTriangle;
  if (kind === "sla") return Timer;
  if (kind === "rework") return TrendingDown;
  if (kind === "review") return CheckCircle2;
  return Hourglass;
}

function buildCoachingIssues(
  rows: AccountabilityScorecardRow[],
  reviewers: AccountabilityOverview["reviewers"],
): CoachIssue[] {
  const issues: CoachIssue[] = [];

  for (const r of rows) {
    const low = r.confidence === "low";
    const position = r.positionLabel ?? r.jobTitle;
    const nonOverdue = r.openTasks > 0 ? Math.round(100 * (1 - r.overdueOwned / r.openTasks)) : null;

    if (r.overdueOwned > 0) {
      issues.push({
        id: `${r.employeeId}:deadline`,
        employeeId: r.employeeId,
        employeeName: r.fullName,
        position,
        kind: "deadline",
        severity: r.overdueOwned >= 3 ? "critical" : "warning",
        title: "ترك مهام في العهدة بعد موعدها",
        why: "هذا خطأ لأنه يحوّل التأخير من مشكلة داخلية إلى خطر ظاهر على العميل والمشروع، خصوصًا عندما تكون المرحلة الحالية مملوكة لهذا الدور من قالب المهمة.",
        evidence: `${r.overdueOwned} مهمة متأخرة من ${r.openTasks} قيد العمل الآن${nonOverdue === null ? "" : `، ونسبة غير المتأخر ${nonOverdue}%`}.`,
        nextAction: "يفتح مهامه المتأخرة يوميًا، يكتب سبب التعطّل كتحديث واضح، ثم يحرّك المهمة أو يطلب إزالة العائق قبل نهاية يوم العمل.",
        source: "المهام + ملكية المرحلة من قوالب المهام",
        sort: 1000 + r.overdueOwned * 80 + (100 - (r.onTimeRate ?? 100)),
      });
    }

    if (!low && r.onTimeRate !== null && r.onTimeRate < 70) {
      issues.push({
        id: `${r.employeeId}:sla`,
        employeeId: r.employeeId,
        employeeName: r.fullName,
        position,
        kind: "sla",
        severity: r.onTimeRate < 45 ? "critical" : "warning",
        title: "لا يلتزم بزمن المرحلة المتفق عليه",
        why: "هذا خطأ لأن زمن كل مرحلة هو وعد تشغيلي. عندما يتكرر كسر الـ SLA يصبح المشروع غير قابل للتوقع حتى لو أُنجزت المهمة في النهاية.",
        evidence: `الالتزام بالمواعيد ${r.onTimeRate}% عبر ${r.slaSampleSize} حدثًا قابلًا للقياس في آخر 30 يومًا.`,
        nextAction: "قبل استلام أي مهمة جديدة، يراجع سقف المرحلة، يقسم العمل إلى خطوة اليوم، ويصعّد مبكرًا إذا لن يسلّم داخل الوقت بدل الانتظار حتى تظهر كمخالفة.",
        source: "سجل المراحل + إعدادات SLA",
        sort: 900 + (70 - r.onTimeRate) * 8,
      });
    }

    if (r.reworkReturns30d > 0) {
      issues.push({
        id: `${r.employeeId}:rework`,
        employeeId: r.employeeId,
        employeeName: r.fullName,
        position,
        kind: "rework",
        severity: r.reworkReturns30d >= 3 ? "warning" : "watch",
        title: "عمله يرجع بعد أن يتقدّم",
        why: "هذا خطأ لأنه يعني أن التسليم لم يُطابق المطلوب من أول مرة، فيستهلك وقت مراجعة جديد ويزيد الاحتكاك مع العميل.",
        evidence: `${r.reworkReturns30d} ارتداد إلى in_progress أو client_changes خلال آخر 30 يومًا.`,
        nextAction: "قبل نقل المهمة للمراجعة، يقارن الناتج مع البريف وقالب المهمة، ويضيف ملاحظة تسليم توضّح ما تم وما يحتاج اعتمادًا.",
        source: "سجل المراحل + البريف + قوالب المهام",
        sort: 700 + r.reworkReturns30d * 60,
      });
    }
  }

  for (const section of [reviewers.managerReview, reviewers.specialistReview]) {
    for (const r of section) {
      const low = r.confidence === "low";
      if (!low && r.fastReviewShare !== null && r.fastReviewShare >= 30) {
        issues.push({
          id: `${r.employeeId}:review`,
          employeeId: r.employeeId,
          employeeName: r.fullName,
          position: null,
          kind: "review",
          severity: r.fastReviewShare >= 50 ? "warning" : "watch",
          title: "مراجعاته سريعة بشكل مقلق",
          why: "هذا خطأ عندما تتحول المراجعة إلى تمرير شكلي. دور المراجعة هو منع الخطأ قبل وصوله للمرحلة التالية، لا مجرد تحريك البطاقة.",
          evidence: `${r.fastReviewCount} من ${r.reviewsCompleted} تاسك مراجَع أُغلق في أقل من 10 دقائق عمل.`,
          nextAction: "يستخدم قائمة فحص قصيرة قبل الاعتماد: المطلوب من البريف، جودة المخرَج، المرفقات، وتعليق واضح إذا أعادها للتعديل.",
          source: "صرامة المراجعة + سجل المراحل",
          sort: 650 + r.fastReviewShare,
        });
      }

      if (r.pendingReviews > 0 && r.oldestPendingBusinessMinutes !== null) {
        issues.push({
          id: `${r.employeeId}:pending-review`,
          employeeId: r.employeeId,
          employeeName: r.fullName,
          position: null,
          kind: "pending_review",
          severity: r.pendingReviews >= 3 ? "warning" : "watch",
          title: "مراجعات تنتظر قراره",
          why: "هذا خطأ لأن العمل لا يستطيع التقدم بدون قرار واضح: اعتماد، رفض بسبب محدد، أو طلب تعديل.",
          evidence: `${r.pendingReviews} مراجعة مفتوحة، أقدمها منتظرة ${Math.round(r.oldestPendingBusinessMinutes / 60)} ساعة عمل تقريبًا.`,
          nextAction: "يفتح طابور المراجعات مرتين يوميًا، ويغلق كل مراجعة بقرار واحد واضح وتعليق مختصر يشرح السبب.",
          source: "طابور المراجعة الحالي",
          sort: 600 + r.pendingReviews * 40,
        });
      }
    }
  }

  return issues.sort((a, b) => b.sort - a.sort);
}

export function AccountabilityWorkspace({ overview, evidence, selectedId, financeMap, reviewerRange }: Props) {
  const t = useTranslations("AccountabilityPage");
  const searchParams = useSearchParams();
  const [refreshing, startRefresh] = useTransition();

  // Filtering + selection stay client-side (instant). getAccountabilityOverview
  // already loaded every row; evidence for the selected person is pulled lazily
  // via a server action and cached, so drilling down never triggers a full-page
  // navigation (which would scroll-jump and re-render the whole tree). URL state
  // is mirrored via history.replaceState so links/refresh restore the view.
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [roleFilter, setRoleFilter] = useState<string>(() => searchParams.get("role") ?? "all");
  const [sortKey, setSortKey] = useState<SortKey>(
    () => (searchParams.get("sort") as SortKey) ?? "onTime",
  );
  const [selId, setSelId] = useState<string | null>(selectedId);
  const [evidenceCache, setEvidenceCache] = useState<Record<string, AccountabilityEvidence | null>>(
    () => (selectedId && evidence ? { [selectedId]: evidence } : {}),
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleRefresh = () =>
    startRefresh(async () => {
      const res = await refreshAccountabilityScorecardAction();
      if (res.ok) {
        toast.success("تم تحديث البيانات");
        setEvidenceCache({}); // force re-fetch of evidence against fresh numbers
        window.location.reload();
      } else {
        toast.error(res.error ?? "تعذّر التحديث");
      }
    });

  const mirrorUrl = (next: { q?: string; role?: string; sort?: SortKey; emp?: string | null }) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = next.q ?? query;
    const role = next.role ?? roleFilter;
    const sort = next.sort ?? sortKey;
    const emp = next.emp === undefined ? selId : next.emp;
    if (q.trim()) params.set("q", q.trim());
    else params.delete("q");
    if (role !== "all") params.set("role", role);
    else params.delete("role");
    if (sort !== "onTime") params.set("sort", sort);
    else params.delete("sort");
    if (emp) params.set("emp", emp);
    else params.delete("emp");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };

  const select = (id: string) => {
    setSelId(id);
    mirrorUrl({ emp: id });
    if (id in evidenceCache) return; // cached (null included) — no refetch
    setLoadingId(id);
    getAccountabilityEvidenceAction(id).then((res) => {
      setEvidenceCache((c) => ({ ...c, [id]: res.ok ? res.evidence : null }));
      setLoadingId((cur) => (cur === id ? null : cur));
    });
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    mirrorUrl({ q: value });
  };
  const onRoleChange = (key: string) => {
    setRoleFilter(key);
    mirrorUrl({ role: key });
  };
  const onSortChange = (key: SortKey) => {
    setSortKey(key);
    mirrorUrl({ sort: key });
  };

  const fmtMinutes = (min: number | null): string => {
    if (min == null) return NA;
    const m = Math.round(min);
    if (m < 60) return t("fmt.minutes", { n: m });
    const h = m / 60;
    if (h < 8) return t("fmt.hours", { n: Math.round(h * 10) / 10 });
    return t("fmt.workdays", { n: Math.round((h / 8) * 10) / 10 });
  };

  const positionGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of overview.rows) {
      const k = r.positionRole ?? NONE_KEY;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const groups: { key: string; label: string; count: number }[] = [];
    for (const key of TASK_OWNER_ROLE_KEYS) {
      const c = counts.get(key);
      if (c) groups.push({ key, label: TASK_OWNER_ROLE_LABELS[key], count: c });
    }
    const none = counts.get(NONE_KEY);
    if (none) groups.push({ key: NONE_KEY, label: "غير محدد", count: none });
    return groups;
  }, [overview.rows]);

  const coachingIssues = useMemo(
    () => buildCoachingIssues(overview.rows, overview.reviewers),
    [overview.rows, overview.reviewers],
  );

  // Per-employee coaching issues (already globally sorted by severity/impact).
  const coachingByEmployee = useMemo(() => {
    const m = new Map<string, CoachIssue[]>();
    for (const i of coachingIssues) {
      const arr = m.get(i.employeeId);
      if (arr) arr.push(i);
      else m.set(i.employeeId, [i]);
    }
    return m;
  }, [coachingIssues]);

  // Per-employee reviewer rows, tagged with which review stage they came from.
  const reviewerByEmployee = useMemo(() => {
    const m = new Map<string, { stage: "manager" | "specialist"; row: ReviewerRigorRow }[]>();
    const push = (stage: "manager" | "specialist", rows: ReviewerRigorRow[]) => {
      for (const row of rows) {
        const arr = m.get(row.employeeId);
        if (arr) arr.push({ stage, row });
        else m.set(row.employeeId, [{ stage, row }]);
      }
    };
    push("manager", overview.reviewers.managerReview);
    push("specialist", overview.reviewers.specialistReview);
    return m;
  }, [overview.reviewers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (r: AccountabilityScorecardRow) =>
      r.onTimeRate === null ? 2 : r.confidence === "low" ? 1 : 0;
    const base = overview.rows.filter((r) => {
      if (roleFilter !== "all" && (r.positionRole ?? NONE_KEY) !== roleFilter) return false;
      if (q && !r.fullName.toLowerCase().includes(q)) return false;
      return true;
    });
    // Low/no-confidence rows always sink so a 2-event sample never headlines.
    return base.sort((a, b) => {
      if (sortKey === "name") return a.fullName.localeCompare(b.fullName, "ar");
      if (sortKey === "overdue") {
        if (b.overdueOwned !== a.overdueOwned) return b.overdueOwned - a.overdueOwned;
        return rank(a) - rank(b);
      }
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      if (sortKey === "trend") {
        return (a.periodTrend.difference ?? 999) - (b.periodTrend.difference ?? 999);
      }
      return (a.periodTrend.currentRate ?? 999) - (b.periodTrend.currentRate ?? 999);
    });
  }, [overview.rows, query, roleFilter, sortKey]);

  // Keep a valid selection: if the selected person drops out of the filter (or
  // nothing is selected yet), fall back to the top row so the detail pane is
  // never empty. Guarded so it doesn't fight an explicit click.
  const filteredKey = filtered.map((r) => r.employeeId).join(",");
  useEffect(() => {
    if (filtered.length === 0) return;
    if (selId && filtered.some((r) => r.employeeId === selId)) return;
    select(filtered[0].employeeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredKey]);

  const stats = useMemo(() => {
    const measured = overview.rows.filter((r) => r.score !== null && r.confidence === "high");
    return {
      measured: overview.rows.length,
      median: median(measured.map((r) => r.score as number)),
      overdueOwned: overview.coverage.distinctOverdueTasks,
      lowConfidence: overview.rows.filter((r) => r.confidence === "low" || r.score === null).length,
    };
  }, [overview.rows, overview.coverage.distinctOverdueTasks]);

  const headStats = [
    {
      icon: Users,
      label: t("stats.measured"),
      value: String(stats.measured),
      tone: "text-cyan",
      help: t("metricTooltips.accountability_measured"),
    },
    {
      icon: Gauge,
      label: t("stats.medianScore"),
      value: stats.median == null ? NA : `${stats.median}%`,
      tone: scoreTone(stats.median, false),
      help: t("metricTooltips.accountability_medianScore"),
    },
    {
      icon: AlertTriangle,
      label: t("stats.overdueOwned"),
      value: String(stats.overdueOwned),
      tone: stats.overdueOwned > 0 ? "text-cc-red" : "text-cc-green",
      help: t("metricTooltips.accountability_overdueOwned"),
    },
    {
      icon: Hourglass,
      label: t("stats.lowConfidence"),
      value: String(stats.lowConfidence),
      tone: "text-muted-foreground",
      help: t("metricTooltips.accountability_lowConfidence"),
    },
  ];

  const selectedRow = filtered.find((r) => r.employeeId === selId) ?? null;
  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "onTime", label: "الالتزام" },
    { key: "overdue", label: "الأكثر تأخّرًا" },
    { key: "trend", label: "الأكثر تراجعًا" },
    { key: "name", label: "الاسم" },
  ];

  return (
    <div className="space-y-4">
      {/* Top bar: methodology (collapsible) + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MethodologyNote methodology={t("methodology")} evidenceRule={t("evidenceRule")} />
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-soft-1 disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          {refreshing ? "جارٍ التحديث…" : "تحديث البيانات"}
        </button>
      </div>

      <AccountabilityRangePicker range={reviewerRange} />

      {/* Head stats */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {headStats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <s.icon className={cn("size-4", s.tone)} />
              <p className={cn("mt-2 text-2xl font-bold tabular-nums", s.tone)}>
                <Explained text={s.help}>
                  <span dir="ltr">{s.value}</span>
                </Explained>
              </p>
              <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                {s.label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar: search + role filter */}
      <FilterBar
        className="mb-0"
        search={{ value: query, onChange: onQueryChange, placeholder: t("search") }}
        hasActiveFilters={query.trim() !== "" || roleFilter !== "all"}
        onClear={() => {
          setQuery("");
          setRoleFilter("all");
          mirrorUrl({ q: "", role: "all" });
        }}
      >
        {[{ key: "all", label: t("roleFilter.all"), count: overview.rows.length }, ...positionGroups].map(
          (g) => (
            <FilterChip
              key={g.key}
              as="button"
              active={roleFilter === g.key}
              count={g.count}
              onClick={() => onRoleChange(g.key)}
            >
              {g.label}
            </FilterChip>
          ),
        )}
      </FilterBar>

      {/* Master–detail: ranked people list ←→ contextual evidence pane */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
          <MasterList
            rows={filtered}
            selectedId={selId}
            onSelect={select}
            coachingByEmployee={coachingByEmployee}
            sortOptions={sortOptions}
            sortKey={sortKey}
            onSortChange={onSortChange}
            t={t}
          />
          <DetailPane
            row={selectedRow}
            issues={selectedRow ? coachingByEmployee.get(selectedRow.employeeId) ?? [] : []}
            reviewerRows={selectedRow ? reviewerByEmployee.get(selectedRow.employeeId) ?? [] : []}
            evidence={selId ? evidenceCache[selId] ?? null : null}
            loading={loadingId === selId}
            fmtMinutes={fmtMinutes}
            t={t}
          />
        </div>
      )}

      {/* Secondary: cross-team reviewer audit (collapsed by default) */}
      <SharedReviewerRigorSection
        reviewers={overview.reviewers}
        range={reviewerRange}
        onSelect={select}
        showRangePicker={false}
      />

      {/* Tier-B: AI-linked signals — always quoted, always labeled, never scored */}
      <AiLinkedSection signals={overview.aiSignals} financeMap={financeMap} t={t} />

      <p className="text-end text-[11px] text-muted-foreground/60">
        {t("generatedAt")}{" "}
        <span dir="ltr" className="tabular-nums">
          {overview.generatedAt.slice(0, 16).replace("T", " ")}
        </span>
      </p>
    </div>
  );
}

// ---- Methodology note (collapsible so it stops eating vertical space) -------
function MethodologyNote({
  methodology,
  evidenceRule,
}: {
  methodology: string;
  evidenceRule: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-cyan/20 bg-cyan/5 px-3 py-2 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-start"
        aria-expanded={open}
      >
        <Info className="size-3.5 shrink-0 text-cyan" />
        <span className="font-medium text-foreground/80">كيف تُحتسب هذه الأرقام؟</span>
        <ChevronDown className={cn("ms-auto size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <p className="mt-2 leading-relaxed">
          {methodology} <span className="text-foreground/80">{evidenceRule}</span>
        </p>
      )}
    </div>
  );
}

// ---- Master list (ranked, scannable, single-click select) ------------------
function MasterList({
  rows,
  selectedId,
  onSelect,
  coachingByEmployee,
  sortOptions,
  sortKey,
  onSortChange,
  t,
}: {
  rows: AccountabilityScorecardRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  coachingByEmployee: Map<string, CoachIssue[]>;
  sortOptions: { key: SortKey; label: string }[];
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card className="overflow-hidden border-border/80 bg-card/95 shadow-sm">
      <CardContent className="p-0">
        {/* Sort control */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-soft-1/60 px-3 py-2">
          <span className="text-[11px] font-medium text-muted-foreground">الترتيب</span>
          <div className="inline-flex flex-wrap gap-1">
            {sortOptions.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => onSortChange(o.key)}
                aria-pressed={sortKey === o.key}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  sortKey === o.key
                    ? "bg-cyan-dim text-cyan"
                    : "text-muted-foreground hover:bg-soft-2 hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <span className="ms-auto text-[11px] text-muted-foreground">
            {t("showingRows", { shown: rows.length, total: rows.length })}
          </span>
        </div>

        <ul className="divide-y divide-border/60">
          {rows.map((r) => {
            const low = r.periodTrend.currentSampleSize < 5;
            const issues = coachingByEmployee.get(r.employeeId) ?? [];
            const severity = issues.reduce<CoachIssue["severity"] | null>(
              (acc, i) => (acc ? strongerSeverity(acc, i.severity) : i.severity),
              null,
            );
            const active = selectedId === r.employeeId;
            return (
              <li key={r.employeeId}>
                <button
                  type="button"
                  onClick={() => onSelect(r.employeeId)}
                  aria-current={active}
                  className={cn(
                    "flex w-full items-center gap-3 border-s-2 border-s-transparent px-3 py-2.5 text-start transition-colors hover:bg-soft-1/70",
                    active && "border-s-cyan bg-cyan/5",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("truncate text-sm font-semibold", active && "text-cyan")}>
                        {r.fullName}
                      </span>
                      {severity && (
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                            severityTone(severity),
                          )}
                          title={`${issues.length} نقطة تدريب`}
                        >
                          <BookOpenCheck className="size-3" />
                          {issues.length}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{r.positionLabel ?? t(`role.${r.role}`)}</span>
                      {r.overdueOwned > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-cc-red">
                          <AlertTriangle className="size-3" />
                          {t("col.overdue")} {r.overdueOwned}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* On-time — the metric the team steers by */}
                  <div className="shrink-0 text-end">
                    <div
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        scoreTone(r.onTimeRate, low),
                      )}
                      dir="ltr"
                    >
                      {r.periodTrend.currentRate === null ? NA : `${r.periodTrend.currentRate}%`}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t("col.onTime")}</div>
                  </div>
                  <span className="inline-flex min-w-20 shrink-0 justify-center rounded-[var(--radius-sm)] border border-border bg-soft-1 px-1.5 py-1">
                    <AccountabilityPeriodTrend trend={r.periodTrend} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---- Detail pane (everything about the selected person) --------------------
function DetailPane({
  row,
  issues,
  reviewerRows,
  evidence,
  loading,
  fmtMinutes,
  t,
}: {
  row: AccountabilityScorecardRow | null;
  issues: CoachIssue[];
  reviewerRows: { stage: "manager" | "specialist"; row: ReviewerRigorRow }[];
  evidence: AccountabilityEvidence | null;
  loading: boolean;
  fmtMinutes: (min: number | null) => string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!row) {
    return (
      <Card className="border-border lg:sticky lg:top-4">
        <CardContent className="p-8">
          <EmptyState
            variant="compact"
            icon={<MousePointerClick className="size-6" />}
            title="اختر موظفًا من القائمة"
            description="ستظهر هنا درجاته، أخطاؤه التدريبية، سلوك مراجعته، والأدلة التفصيلية."
          />
        </CardContent>
      </Card>
    );
  }

  const low = row.confidence === "low";
  const metricBar: { label: string; value: string; tone?: string }[] = [
    { label: t("col.score"), value: row.score === null ? NA : `${row.score}%`, tone: scoreTone(row.score, low) },
    {
      label: t("col.onTime"),
      value: row.onTimeRate === null ? NA : `${row.onTimeRate}%`,
      tone: scoreTone(row.onTimeRate, low),
    },
    {
      label: t("col.overdue"),
      value: String(row.overdueOwned),
      tone: row.overdueOwned > 0 ? "text-cc-red" : "text-cc-green",
    },
    { label: t("col.openTasks"), value: String(row.openTasks) },
    { label: t("col.avgDwell"), value: fmtMinutes(row.avgDwellBusinessMinutes) },
    {
      label: t("col.rework"),
      value: String(row.reworkReturns30d),
      tone: row.reworkReturns30d > 0 ? "text-amber" : undefined,
    },
    { label: t("col.sample"), value: String(row.sampleSize) },
  ];

  return (
    <Card className="border-cyan/30 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <CardContent className="space-y-4 p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-bold">{row.fullName}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="rounded-md border border-border/60 bg-soft-2 px-1.5 py-0.5 font-medium">
                {row.positionLabel ?? t(`role.${row.role}`)}
              </span>
              {row.jobTitle && <span className="truncate">{row.jobTitle}</span>}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-lg border px-2.5 py-1.5 text-base font-bold tabular-nums",
              scoreBadgeTone(row.score, low),
            )}
            dir="ltr"
          >
            {row.score === null ? NA : `${row.score}%`}
          </span>
        </div>

        {/* Metric bar */}
        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-7 lg:grid-cols-4 xl:grid-cols-7">
          {metricBar.map((m) => (
            <div key={m.label} className="bg-card px-2 py-2 text-center">
              <p className={cn("text-sm font-bold tabular-nums", m.tone ?? "text-foreground")} dir="ltr">
                {m.value}
              </p>
              <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
        {low && (
          <p className="rounded-md border border-border bg-soft-1 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            {t("lowSampleHint")}
          </p>
        )}

        {/* Coaching — this person's flagged mistakes */}
        <section>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <BookOpenCheck className="size-4 text-cyan" />
            سجل الأخطاء والتدريب
          </p>
          {issues.length === 0 ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-cc-green/20 bg-green-dim/40 px-2.5 py-2 text-[11px] text-cc-green">
              <CheckCircle2 className="size-3.5" />
              لا توجد أخطاء تدريبية واضحة لهذا الموظف في النافذة الحالية.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {issues.map((issue) => {
                const Icon = coachIconFor(issue.kind);
                return (
                  <div key={issue.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold leading-snug">
                        <Icon className={cn("size-3.5", severityTone(issue.severity).split(" ").at(-1))} />
                        {issue.title}
                      </p>
                      <span
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                          severityTone(issue.severity),
                        )}
                      >
                        {severityLabel(issue.severity)}
                      </span>
                    </div>
                    <div className="mt-2 space-y-2">
                      <div>
                        <p className="text-[11px] font-semibold text-muted-foreground">لماذا خطأ؟</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-foreground/85">{issue.why}</p>
                      </div>
                      <div className="rounded-md border border-border bg-soft-1/70 p-2">
                        <p className="text-[11px] font-semibold text-muted-foreground">الدليل</p>
                        <p className="mt-0.5 text-xs leading-relaxed">{issue.evidence}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-muted-foreground">كيف يتجنبها؟</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-foreground/85">
                          {issue.nextAction}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 border-t border-border/70 pt-1.5 text-[10px] text-muted-foreground">
                      {issue.source}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Review behavior — only when this person reviews */}
        {reviewerRows.length > 0 && (
          <section>
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold">
              <Scale className="size-4 text-cyan" />
              سلوك المراجعة
            </p>
            <div className="mt-2 space-y-2">
              {reviewerRows.map(({ stage, row: rev }) => {
                const revLow = rev.confidence === "low";
                const rubberStamp = !revLow && rev.fastReviewCount > 0;
                return (
                  <div key={`${stage}-${rev.employeeId}`} className="rounded-lg border border-border bg-card p-3">
                    <p className="text-[11px] font-semibold text-foreground/90">
                      {stage === "manager"
                        ? t("reviewers.managerReviewTitle")
                        : t("reviewers.specialistReviewTitle")}
                    </p>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                      <div>
                        <p className="text-sm font-bold tabular-nums">{rev.reviewsCompleted}</p>
                        <p className="text-[10px] text-muted-foreground">{t("reviewers.col.reviews")}</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold tabular-nums text-muted-foreground">
                          {fmtMinutes(rev.medianReviewBusinessMinutes)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{t("reviewers.col.medianTime")}</p>
                      </div>
                      <div>
                        <p
                          className={cn(
                            "text-sm font-bold tabular-nums",
                            rubberStamp ? "text-amber" : "text-muted-foreground",
                          )}
                          dir="ltr"
                        >
                          {rev.fastReviewCount}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{t("reviewers.col.fastShare")}</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold tabular-nums">{rev.pendingReviews}</p>
                        <p className="text-[10px] text-muted-foreground">{t("reviewers.col.pending")}</p>
                      </div>
                    </div>
                    {rubberStamp && (
                      <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-amber">
                        <Timer className="size-3" />
                        {t("reviewers.rubberStamp")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Evidence — shared with the employee file in the Team lens. */}
        <EmployeeEvidence evidence={evidence} loading={loading} />
      </CardContent>
    </Card>
  );
}

// ---- Tier-B: AI-linked signals ----------------------------------------------
function AiLinkedSection({
  signals,
  financeMap,
  t,
}: {
  signals: AiLinkedSignal[];
  financeMap: ClientFinanceMap;
  t: ReturnType<typeof useTranslations>;
}) {
  const [range, setRange] = useState<"today" | "week">("week");

  const complaints = useMemo(() => {
    const cutoff = new Date();
    if (range === "today") cutoff.setHours(0, 0, 0, 0);
    else cutoff.setDate(cutoff.getDate() - 7);
    const cutoffMs = cutoff.getTime();
    const latest = new Map<string, AiLinkedSignal>();
    for (const s of signals) {
      if (s.kind !== "complaint" || !s.occurredAt) continue;
      const ts = new Date(s.occurredAt).getTime();
      if (Number.isNaN(ts) || ts < cutoffMs) continue;
      const key = s.clientId ?? s.clientName ?? s.id;
      const prev = latest.get(key);
      if (!prev || new Date(prev.occurredAt as string).getTime() < ts) latest.set(key, s);
    }
    return [...latest.values()].sort(
      (a, b) => new Date(b.occurredAt as string).getTime() - new Date(a.occurredAt as string).getTime(),
    );
  }, [signals, range]);

  const rangeBtn = (key: "today" | "week", label: string) => (
    <button
      type="button"
      onClick={() => setRange(key)}
      aria-pressed={range === key}
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] transition-colors",
        range === key ? "bg-cyan-dim text-cyan font-medium" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-cyan" /> {t("ai.complaintsTitle")}
            <MetricInfo text={t("ai.complaintsHint")} label={t("ai.complaintsTitle")} />
          </p>
          <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] font-medium text-cyan">
            {t("ai.badge")}
          </span>
          <div className="ms-auto inline-flex rounded-lg border border-soft bg-card/60 p-0.5">
            {rangeBtn("today", t("ai.windowToday"))}
            {rangeBtn("week", t("ai.windowWeek"))}
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t("ai.complaintsHint")}</p>

        {complaints.length === 0 ? (
          <p className="mt-3 rounded-lg bg-soft-1/60 px-3 py-4 text-center text-xs text-muted-foreground">
            {t("ai.emptyComplaints")}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 lg:grid-cols-2">
            {complaints.map((s) => (
              <li key={s.id} className="rounded-lg border border-border bg-card p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {s.clientName && <span className="truncate font-semibold text-foreground">{s.clientName}</span>}
                    {s.clientId && <ClientFinanceBadges badge={financeMap[s.clientId]} />}
                  </span>
                  {s.occurredAt && (
                    <span dir="ltr" className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                      {s.occurredAt.slice(0, 10)}
                    </span>
                  )}
                </div>
                <blockquote className="mt-2 flex gap-2 rounded-md bg-soft-1/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                  <Quote className="mt-0.5 size-3 shrink-0 text-cc-red" />
                  <span>{s.quote}</span>
                </blockquote>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  <span className="rounded bg-soft-2 px-1.5 py-0.5">
                    {t("ai.sourceLabel")}: {s.source}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
