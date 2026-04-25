"use client";

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { formatMoney } from "@/lib/utils/format";

/* ─── Design Tokens ─── */
const T = {
  bg: "#07090F", surface: "#0D1117", card: "#111827", border: "#1E2A3A",
  teal: "#00D4FF", green: "#10B981", red: "#EF4444", amber: "#F59E0B",
  purple: "#8B5CF6", pink: "#EC4899", text: "#F1F5F9", mid: "#94A3B8", dim: "#475569",
};

/* ─── Types ─── */
interface Deal {
  id: string;
  client_name: string;
  deal_value: number;
  stage: string;
  probability: number;
  assigned_rep_name?: string;
  cycle_days: number;
  deal_date?: string;
  source?: string;
}

interface LostDeal {
  id: string;
  client_name: string;
  deal_value: number;
  loss_reason?: string;
  assigned_rep_name?: string;
  cycle_days: number;
  notes?: string;
  source?: string;
}

interface SalesKPIsViewProps {
  deals: Deal[];
  lostDeals: LostDeal[];
}

/* ─── KPI Targets ─── */
const KPI_TARGETS = {
  leadSpeed: 5,
  winRate: 35,
  demoConv: 60,
  avgCycle: 14,
  monthlyNew: 20,
  renewalRate: 85,
  avgDealValue: 45000,
  pipelineValue: 500000,
};

/* ─── Funnel Stages ─── */
const FUNNEL_STAGES = ["تواصل", "عرض سعر", "تفاوض", "إغلاق"];
const FUNNEL_STAGE_MAP: Record<string, string> = {
  "تواصل": "تواصل",
  "تفاوض": "تفاوض",
  "عرض سعر": "عرض سعر",
  "تجهيز": "عرض سعر",
  "انتظار الدفع": "إغلاق",
  "مكتملة": "إغلاق",
};

const FUNNEL_COLORS: Record<string, string> = {
  "تواصل": T.teal,
  "عرض سعر": T.amber,
  "تفاوض": T.purple,
  "إغلاق": T.green,
};

const LOSS_COLORS: Record<string, string> = {
  "سعر": T.red,
  "منافس": T.amber,
  "ميزة ناقصة": T.purple,
  "توقيت": T.teal,
  "أخرى": T.dim,
};

const SOURCE_COLORS: Record<string, string> = {
  "إعلانات": T.teal, "حملة اعلانية": T.teal,
  "تسويق": T.purple, "تسويق بالعمولة": T.purple,
  "شراكة": T.pink,
  "توصية": T.green, "من طرف عميل": T.green,
  "معرض": T.amber,
  "من الدعم": T.amber,
  "جديد لعميل حالي": T.teal,
  "فرع جديد لعميل حالي": T.teal,
  "من ارقام عشوائية": T.dim,
  "اخرى": T.dim, "أخرى": T.dim,
};

/* ─── Shared Styles ─── */
const cardS: React.CSSProperties = {
  background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20,
};

function statusBadge(actual: number, target: number, inverse = false) {
  const ratio = inverse ? (target / Math.max(actual, 1)) : (actual / Math.max(target, 1));
  if (ratio >= 1) return { label: "✓ ممتاز", color: T.green };
  if (ratio >= 0.7) return { label: "تحسين", color: T.amber };
  return { label: "⚠ متأخر", color: T.red };
}

function ProgressBar6({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: T.border, width: "100%" }}>
      <div style={{ height: "100%", borderRadius: 3, background: color, width: `${Math.min(Math.max(pct, 0), 100)}%`, transition: "width 0.3s" }} />
    </div>
  );
}

export default function SalesKPIsView({ deals, lostDeals }: SalesKPIsViewProps) {
  const metrics = useMemo(() => {
    const activeDeals = deals;
    const closedDeals = activeDeals.filter(d => d.stage === "مكتملة" || d.stage === "إغلاق");
    const allDealsCount = activeDeals.length + lostDeals.length;
    const winRate = allDealsCount > 0 ? Math.round((closedDeals.length / allDealsCount) * 100) : 0;

    const pipeline = activeDeals.filter(d => d.stage !== "مكتملة").reduce((s, d) => s + d.deal_value, 0);
    const avgCycle = activeDeals.length > 0 ? Math.round(activeDeals.reduce((s, d) => s + d.cycle_days, 0) / activeDeals.length) : 0;
    const avgDealVal = activeDeals.length > 0 ? Math.round(activeDeals.reduce((s, d) => s + d.deal_value, 0) / activeDeals.length) : 0;

    // Demo conv: deals past "تواصل" stage / all non-contact deals
    const nonContact = activeDeals.filter(d => d.stage !== "تواصل");
    const demoReached = activeDeals.filter(d => ["عرض سعر", "تجهيز", "تفاوض", "انتظار الدفع", "مكتملة", "إغلاق"].includes(d.stage));
    const demoConv = activeDeals.length > 0 ? Math.round((demoReached.length / activeDeals.length) * 100) : 0;

    // Funnel data
    const funnelMap: Record<string, { count: number; value: number }> = {};
    FUNNEL_STAGES.forEach(s => { funnelMap[s] = { count: 0, value: 0 }; });
    activeDeals.forEach(d => {
      const mapped = FUNNEL_STAGE_MAP[d.stage] || "تواصل";
      if (funnelMap[mapped]) {
        funnelMap[mapped].count++;
        funnelMap[mapped].value += d.deal_value;
      }
    });
    const funnelData = FUNNEL_STAGES.map(s => ({ stage: s, ...funnelMap[s] }));

    // Lost reasons
    const lossReasons: Record<string, number> = {};
    lostDeals.forEach(d => {
      const reason = d.loss_reason || "أخرى";
      lossReasons[reason] = (lossReasons[reason] || 0) + 1;
    });
    const lossReasonData = Object.entries(lossReasons)
      .map(([reason, count]) => ({ reason, count, color: LOSS_COLORS[reason] || T.dim }))
      .sort((a, b) => b.count - a.count);

    // Rep performance
    const repMap: Record<string, { deals: number; closed: number; value: number; cycleDays: number }> = {};
    activeDeals.forEach(d => {
      const rep = d.assigned_rep_name || "غير محدد";
      if (!repMap[rep]) repMap[rep] = { deals: 0, closed: 0, value: 0, cycleDays: 0 };
      repMap[rep].deals++;
      repMap[rep].value += d.deal_value;
      repMap[rep].cycleDays += d.cycle_days;
      if (d.stage === "مكتملة") repMap[rep].closed++;
    });
    const repPerformance = Object.entries(repMap)
      .map(([name, data]) => ({
        name,
        deals: data.deals,
        closed: data.closed,
        value: data.value,
        winRate: data.deals > 0 ? Math.round((data.closed / data.deals) * 100) : 0,
        avgCycle: data.deals > 0 ? Math.round(data.cycleDays / data.deals) : 0,
      }))
      .sort((a, b) => b.value - a.value);

    // Source ROI
    const sourceMap: Record<string, { count: number; value: number; won: number }> = {};
    activeDeals.forEach(d => {
      const src = d.source || "أخرى";
      if (!sourceMap[src]) sourceMap[src] = { count: 0, value: 0, won: 0 };
      sourceMap[src].count++;
      sourceMap[src].value += d.deal_value;
      if (d.stage === "مكتملة") sourceMap[src].won++;
    });
    const sourceData = Object.entries(sourceMap)
      .map(([source, data]) => ({
        source,
        count: data.count,
        value: data.value,
        won: data.won,
        winRate: data.count > 0 ? Math.round((data.won / data.count) * 100) : 0,
        avgValue: data.count > 0 ? Math.round(data.value / data.count) : 0,
        color: SOURCE_COLORS[source] || T.dim,
      }))
      .filter(s => s.count > 0);

    // Last 3 lost deals
    const recentLost = [...lostDeals].slice(0, 3);

    return { winRate, pipeline, avgCycle, avgDealVal, demoConv, funnelData, lossReasonData, repPerformance, sourceData, recentLost, closedCount: closedDeals.length, allDealsCount };
  }, [deals, lostDeals]);

  if (deals.length === 0 && lostDeals.length === 0) {
    return (
      <div style={{ ...cardS, textAlign: "center", padding: 60 }}>
        <p style={{ fontSize: 40, marginBottom: 12 }}>📊</p>
        <p style={{ color: T.mid, fontSize: 14 }}>لا توجد بيانات لعرض مؤشرات الأداء</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, direction: "rtl", color: T.text }}>

      {/* ═══ 1. KPI STATUS CARDS ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <KPIStatusCard label="معدل الإغلاق" actual={metrics.winRate} target={KPI_TARGETS.winRate} unit="%" />
        <KPIStatusCard label="تحويل Demo من SQL" actual={metrics.demoConv} target={KPI_TARGETS.demoConv} unit="%" />
        <KPIStatusCard label="متوسط دورة المبيعات" actual={metrics.avgCycle} target={KPI_TARGETS.avgCycle} unit=" يوم" inverse />
        <KPIStatusCard label="قيمة الـ Pipeline" actual={metrics.pipeline} target={KPI_TARGETS.pipelineValue} unit="" isMoney />
      </div>

      {/* ═══ 2. SALES FUNNEL ═══ */}
      <div style={cardS}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>قمع المبيعات</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {metrics.funnelData.map((f, i) => {
            const maxCount = Math.max(...metrics.funnelData.map(x => x.count), 1);
            const widthPct = Math.max((f.count / maxCount) * 100, 12);
            const prevCount = i > 0 ? metrics.funnelData[i - 1].count : 0;
            const convRate = prevCount > 0 ? Math.round((f.count / prevCount) * 100) : null;
            const color = FUNNEL_COLORS[f.stage] || T.teal;
            return (
              <div key={f.stage}>
                {convRate !== null && (
                  <div style={{ textAlign: "center", fontSize: 11, color: T.mid, margin: "2px 0 4px" }}>
                    ← {convRate}%
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12, color: T.mid, width: 70, textAlign: "right", flexShrink: 0 }}>{f.stage}</span>
                  <div style={{ flex: 1, height: 36, background: `${color}15`, borderRadius: 8, position: "relative", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 8, background: `${color}40`, width: `${widthPct}%`, transition: "width 0.3s" }} />
                    <span style={{ position: "absolute", top: "50%", right: 12, transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: T.text }}>
                      {f.count} عميل — {(f.value / 1000).toFixed(0)}K
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* Win rate summary */}
        <div style={{ marginTop: 16, padding: "12px 16px", background: `${T.green}15`, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: T.mid }}>معدل الإغلاق الكلي</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: T.green }}>{metrics.winRate}%</span>
        </div>
      </div>

      {/* ═══ 3. LOST DEALS ANALYSIS ═══ */}
      <div style={cardS}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>🔍 تحليل المبيعات الخاسرة</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
          {/* Bar chart */}
          <div>
            {metrics.lossReasonData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={metrics.lossReasonData} layout="vertical" margin={{ right: 60, left: 10 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="reason" tick={{ fill: T.mid, fontSize: 12 }} width={80} />
                  <Tooltip
                    contentStyle={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, fontSize: 12 }}
                    formatter={(value) => [`${value} صفقة`, "العدد"]}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {metrics.lossReasonData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: "center", padding: 40, color: T.dim }}>لا توجد صفقات خاسرة</div>
            )}
          </div>

          {/* Recent lost deals */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 12, color: T.mid, marginBottom: 4 }}>آخر الصفقات الخاسرة</p>
            {metrics.recentLost.length === 0 && (
              <p style={{ color: T.dim, fontSize: 12 }}>لا توجد بيانات</p>
            )}
            {metrics.recentLost.map(d => (
              <div key={d.id} style={{ padding: "10px 12px", background: T.surface, borderRadius: 10, borderRight: `3px solid ${T.red}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{d.client_name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.red }}>-{(d.deal_value / 1000).toFixed(0)}K</span>
                </div>
                {d.notes && <p style={{ fontSize: 11, color: T.mid, marginTop: 4, lineHeight: 1.5 }}>{d.notes.slice(0, 60)}...</p>}
                <span style={{
                  display: "inline-block", marginTop: 6, fontSize: 10, padding: "2px 8px", borderRadius: 8,
                  background: `${LOSS_COLORS[d.loss_reason || "أخرى"] || T.dim}25`,
                  color: LOSS_COLORS[d.loss_reason || "أخرى"] || T.dim,
                }}>
                  {d.loss_reason || "أخرى"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ 4. KPI TRACKER TABLE ═══ */}
      <div style={cardS}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>تتبع مؤشرات الأداء الرئيسية — KPIs</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["المؤشر", "الفعلي", "التقدم", "الحالة"].map(h => (
                  <th key={h} style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600, color: T.mid, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "معدل الإغلاق (Win Rate)", desc: "نسبة الصفقات المُغلقة من إجمالي الفرص", actual: metrics.winRate, target: KPI_TARGETS.winRate, unit: "%" },
                { label: "تحويل Demo من SQL", desc: "% العملاء المؤهلين الذين وصلوا لمرحلة العرض", actual: metrics.demoConv, target: KPI_TARGETS.demoConv, unit: "%" },
                { label: "متوسط دورة المبيعات", desc: "الهدف: إغلاق الصفقة خلال أقل من 14 يوماً", actual: metrics.avgCycle, target: KPI_TARGETS.avgCycle, unit: " يوم", inverse: true },
                { label: "متوسط قيمة الصفقة", desc: "متوسط القيمة المالية لكل صفقة", actual: metrics.avgDealVal, target: KPI_TARGETS.avgDealValue, unit: "", isMoney: true },
                { label: "قيمة خط المبيعات", desc: "إجمالي قيمة الصفقات في المراحل النشطة", actual: metrics.pipeline, target: KPI_TARGETS.pipelineValue, unit: "", isMoney: true },
                { label: "Lead Speed", desc: "< 5 دقائق", actual: -1, target: KPI_TARGETS.leadSpeed, unit: " دقائق", fixed: true, fixedDisplay: "< 5 دقائق" },
                { label: "معدل التجديد", desc: "هدف: 85%", actual: -1, target: KPI_TARGETS.renewalRate, unit: "%", fixed: true, fixedDisplay: "هدف: 85%" },
              ].map((row, i) => {
                const isFixed = "fixed" in row && row.fixed;
                const st = isFixed ? { label: "—", color: T.mid } : statusBadge(row.actual, row.target, "inverse" in row && row.inverse);
                const pct = isFixed ? 0 : ("inverse" in row && row.inverse
                  ? Math.round((row.target / Math.max(row.actual, 1)) * 100)
                  : Math.round((row.actual / Math.max(row.target, 1)) * 100));
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.border}20` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.surface; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                    <td style={{ padding: "12px 8px" }}>
                      <div style={{ fontWeight: 600 }}>{row.label}</div>
                      <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>{row.desc}</div>
                    </td>
                    <td style={{ padding: "12px 8px", fontFamily: "monospace", fontWeight: 700, color: T.teal }}>
                      {isFixed ? ("fixedDisplay" in row ? row.fixedDisplay : "—") : ("isMoney" in row && row.isMoney ? formatMoney(row.actual) : `${row.actual}${row.unit}`)}
                    </td>
                    <td style={{ padding: "12px 8px", minWidth: 120 }}>
                      {!isFixed && <ProgressBar6 pct={Math.min(pct, 100)} color={st.color} />}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <span style={{
                        display: "inline-block", padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                        background: `${st.color}20`, color: st.color,
                      }}>
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ 5. REP PERFORMANCE TABLE ═══ */}
      {metrics.repPerformance.length > 0 && (
        <div style={cardS}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>أداء المندوبين</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["الموظف", "الصفقات", "مُغلق", "معدل الإغلاق", "متوسط الدورة", "إجمالي القيمة", "الترتيب"].map(h => (
                    <th key={h} style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600, color: T.mid, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.repPerformance.map((rep, idx) => {
                  const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}`;
                  const rateColor = rep.winRate >= 35 ? T.green : rep.winRate >= 20 ? T.amber : T.red;
                  const cycleColor = rep.avgCycle <= 14 ? T.green : rep.avgCycle <= 21 ? T.amber : T.red;
                  const initial = rep.name.charAt(0);
                  return (
                    <tr key={rep.name} style={{ borderBottom: `1px solid ${T.border}20` }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.surface; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                      <td style={{ padding: "12px 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                            background: `${T.teal}20`, color: T.teal, fontSize: 14, fontWeight: 700, border: `1px solid ${T.teal}40`,
                          }}>
                            {initial}
                          </div>
                          <span style={{ fontWeight: 600 }}>{rep.name}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 8px", color: T.mid }}>{rep.deals}</td>
                      <td style={{ padding: "12px 8px", color: T.mid }}>{rep.closed}</td>
                      <td style={{ padding: "12px 8px", minWidth: 140 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700, color: rateColor, width: 35 }}>{rep.winRate}%</span>
                          <div style={{ flex: 1 }}>
                            <ProgressBar6 pct={Math.min((rep.winRate / 35) * 100, 100)} color={rateColor} />
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 8px", color: cycleColor, fontFamily: "monospace" }}>{rep.avgCycle} يوم</td>
                      <td style={{ padding: "12px 8px", fontWeight: 700, color: T.teal, fontFamily: "monospace" }}>{formatMoney(rep.value)}</td>
                      <td style={{ padding: "12px 8px", textAlign: "center", fontSize: 18 }}>{medal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ 6. SOURCE ROI GRID ═══ */}
      {metrics.sourceData.length > 0 && (
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>عائد المصادر (Source ROI)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {metrics.sourceData.map(s => (
              <div key={s.source} style={{ ...cardS, borderTop: `2px solid ${s.color}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: s.color }}>{s.source}</span>
                  <span style={{
                    padding: "2px 8px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                    background: `${s.color}20`, color: s.color,
                  }}>
                    {s.count} فرصة
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: T.mid }}>القيمة الإجمالية</span>
                    <span style={{ fontWeight: 700, color: T.teal, fontFamily: "monospace" }}>{formatMoney(s.value)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: T.mid }}>معدل الإغلاق</span>
                    <span style={{ fontWeight: 600, color: s.winRate >= 35 ? T.green : s.winRate > 0 ? T.amber : T.dim }}>{s.winRate}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: T.mid }}>متوسط القيمة</span>
                    <span style={{ fontWeight: 600, color: T.mid, fontFamily: "monospace" }}>{formatMoney(s.avgValue)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── KPI Status Card ─── */
function KPIStatusCard({ label, actual, target, unit, inverse, isMoney }: {
  label: string; actual: number; target: number; unit: string; inverse?: boolean; isMoney?: boolean;
}) {
  const st = statusBadge(actual, target, inverse);
  const pct = inverse
    ? Math.round((target / Math.max(actual, 1)) * 100)
    : Math.round((actual / Math.max(target, 1)) * 100);

  return (
    <div style={{ ...cardS, borderTop: `2px solid ${st.color}` }}>
      <p style={{ fontSize: 12, color: T.mid, marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, color: st.color, fontFamily: "monospace" }}>
        {isMoney ? formatMoney(actual) : `${actual}${unit}`}
      </p>
      <p style={{ fontSize: 11, color: T.dim, marginTop: 4 }}>
        الهدف: {isMoney ? formatMoney(target) : `${target}${unit}`}
      </p>
      <ProgressBar6 pct={Math.min(pct, 100)} color={st.color} />
      <div style={{ marginTop: 8 }}>
        <span style={{
          display: "inline-block", padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
          background: `${st.color}20`, color: st.color,
        }}>
          {st.label}
        </span>
      </div>
    </div>
  );
}
