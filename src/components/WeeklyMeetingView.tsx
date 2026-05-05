"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchWeeklyRetentionStats, fetchWeeklyReferralStats } from "@/lib/supabase/db";

/* ─── Design Tokens ─── */
const T = {
  bg: "#07090F", surface: "#0D1117", card: "#111827", border: "#1E2A3A",
  teal: "#00D4FF", green: "#10B981", red: "#EF4444", amber: "#F59E0B",
  purple: "#8B5CF6", pink: "#EC4899", text: "#F1F5F9", mid: "#94A3B8", dim: "#475569",
};

const LS_KEY = "cc:weekly";
const LS_HISTORY = "cc:weekly_history";
const GOAL_90DAY = 70000;
const WEEKLY_TARGET = 17500;

/* ─── Types ─── */
interface Member { name: string; calls: string; demos: string; closed: string; avgVal: string; rate: string; status: string; }
interface WeeklyRev { w: string; rev: string; tgt: number; }
interface Task { task: string; owner: string; deadline: string; }
interface WeeklyData {
  weekLabel: string;
  revenue: string; closed: string; closeRate: string; renewRate: string;
  members: Member[];
  weeklyRev: WeeklyRev[];
  srcNew: string; srcUps: string; srcRef: string; srcRen: string;
  retention: { renewed: string; expiring: string; contacted: string; upsell: string; renewRate: string; };
  referral: { active: string; newRefs: string; converted: string; rewards: string; convRate: string; };
  decisions: { worst: string; best: string; mainDecision: string; };
  tasks: Task[];
}

function emptyData(): WeeklyData {
  return {
    weekLabel: `أسبوع ${new Date().toLocaleDateString("ar-SA-u-nu-latn", { day: "numeric", month: "long" })}`,
    revenue: "", closed: "", closeRate: "", renewRate: "",
    members: [
      { name: "أ", calls: "", demos: "", closed: "", avgVal: "", rate: "", status: "🟡" },
      { name: "ب", calls: "", demos: "", closed: "", avgVal: "", rate: "", status: "🟡" },
      { name: "ج", calls: "", demos: "", closed: "", avgVal: "", rate: "", status: "🟡" },
      { name: "د", calls: "", demos: "", closed: "", avgVal: "", rate: "", status: "🟡" },
      { name: "هـ", calls: "", demos: "", closed: "", avgVal: "", rate: "", status: "🟡" },
    ],
    weeklyRev: [
      { w: "أسبوع 1", rev: "", tgt: 17500 },
      { w: "أسبوع 2", rev: "", tgt: 17500 },
      { w: "أسبوع 3", rev: "", tgt: 17500 },
      { w: "أسبوع 4", rev: "", tgt: 17500 },
    ],
    srcNew: "", srcUps: "", srcRef: "", srcRen: "",
    retention: { renewed: "", expiring: "", contacted: "", upsell: "", renewRate: "" },
    referral: { active: "", newRefs: "", converted: "", rewards: "", convRate: "" },
    decisions: { worst: "", best: "", mainDecision: "" },
    tasks: [
      { task: "", owner: "", deadline: "" },
      { task: "", owner: "", deadline: "" },
      { task: "", owner: "", deadline: "" },
    ],
  };
}

/* ─── Shared Styles ─── */
const cardStyle: React.CSSProperties = {
  background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20,
};
const inputBase: React.CSSProperties = {
  background: "transparent", border: "none", borderBottom: `1px solid ${T.border}`,
  color: T.text, fontSize: 18, fontFamily: "monospace", outline: "none", width: "100%",
  padding: "6px 0", textAlign: "right" as const, direction: "rtl" as const,
};
const textareaBase: React.CSSProperties = {
  ...inputBase, fontSize: 14, fontFamily: "inherit", minHeight: 80, resize: "vertical" as const,
};

function pctColor(pct: number) { return pct >= 100 ? T.green : pct >= 70 ? T.teal : pct < 40 ? T.red : T.amber; }
function statusEmoji(pct: number) { return pct >= 100 ? "🟢" : pct >= 70 ? "🟡" : "🔴"; }

function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const c = color || pctColor(pct);
  return (
    <div style={{ height: 6, borderRadius: 3, background: T.border, width: "100%", marginTop: 6 }}>
      <div style={{ height: "100%", borderRadius: 3, background: c, width: `${pct}%`, transition: "width 0.3s" }} />
    </div>
  );
}

type RetentionStats = { renewed: number; expiring: number; contacted: number; upsell: number; renewRate: number };
type ReferralStats = { active: number; newRefs: number; converted: number; rewards: number; convRate: number };

export default function WeeklyMeetingView() {
  const [data, setData] = useState<WeeklyData>(emptyData);
  const [tab, setTab] = useState(0);
  const [saved, setSaved] = useState(true);
  const [retentionStats, setRetentionStats] = useState<RetentionStats | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  // Load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WeeklyData;
        setData(parsed);
      }
    } catch { /* ignore */ }
    loaded.current = true;
  }, []);

  // Load real stats from DB
  useEffect(() => {
    async function loadStats() {
      setLoadingStats(true);
      try {
        const [ret, ref] = await Promise.all([
          fetchWeeklyRetentionStats(),
          fetchWeeklyReferralStats(),
        ]);
        setRetentionStats(ret);
        setReferralStats(ref);
      } catch { /* ignore */ }
      setLoadingStats(false);
    }
    loadStats();
  }, []);

  // Auto-save with debounce
  const schedSave = useCallback((d: WeeklyData) => {
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch { /* ignore */ }
      setSaved(true);
    }, 700);
  }, []);

  function update(partial: Partial<WeeklyData>) {
    setData(prev => {
      const next = { ...prev, ...partial };
      schedSave(next);
      return next;
    });
  }

  function updateMember(idx: number, field: keyof Member, val: string) {
    setData(prev => {
      const members = prev.members.map((m, i) => i === idx ? { ...m, [field]: val } : m);
      const next = { ...prev, members };
      schedSave(next);
      return next;
    });
  }

  function updateWeeklyRev(idx: number, val: string) {
    setData(prev => {
      const weeklyRev = prev.weeklyRev.map((w, i) => i === idx ? { ...w, rev: val } : w);
      const next = { ...prev, weeklyRev };
      schedSave(next);
      return next;
    });
  }

  function updateTask(idx: number, field: keyof Task, val: string) {
    setData(prev => {
      const tasks = prev.tasks.map((t, i) => i === idx ? { ...t, [field]: val } : t);
      const next = { ...prev, tasks };
      schedSave(next);
      return next;
    });
  }

  function addTask() {
    setData(prev => {
      const next = { ...prev, tasks: [...prev.tasks, { task: "", owner: "", deadline: "" }] };
      schedSave(next);
      return next;
    });
  }

  function removeTask(idx: number) {
    setData(prev => {
      const next = { ...prev, tasks: prev.tasks.filter((_, i) => i !== idx) };
      schedSave(next);
      return next;
    });
  }

  function archiveWeek() {
    try {
      const raw = localStorage.getItem(LS_HISTORY);
      const history: WeeklyData[] = raw ? JSON.parse(raw) : [];
      history.unshift(data);
      if (history.length > 12) history.length = 12;
      localStorage.setItem(LS_HISTORY, JSON.stringify(history));
    } catch { /* ignore */ }
    const fresh = emptyData();
    setData(fresh);
    try { localStorage.setItem(LS_KEY, JSON.stringify(fresh)); } catch { /* ignore */ }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.weekLabel.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tabs = ["📊 أرقام الأسبوع", "👥 أداء الفريق", "💰 تتبع الإيراد", "🔄 الاحتفاظ والإحالة", "🎯 قرارات ومهام"];

  // Computed
  const rev = parseFloat(data.revenue) || 0;
  const totalWeeklyRev = data.weeklyRev.reduce((s, w) => s + (parseFloat(w.rev) || 0), 0);
  const progressPct = GOAL_90DAY > 0 ? Math.round((totalWeeklyRev / GOAL_90DAY) * 100) : 0;
  const progressColor = progressPct >= 100 ? T.green : progressPct >= 70 ? T.teal : T.amber;

  return (
    <div style={{ direction: "rtl", color: T.text, fontFamily: "inherit" }}>
      {/* ─── Header ─── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <input
          value={data.weekLabel}
          onChange={e => update({ weekLabel: e.target.value })}
          style={{ ...inputBase, fontSize: 20, fontWeight: 700, fontFamily: "inherit", flex: "1 1 200px", minWidth: 200 }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: saved ? T.green : T.amber }}>
            {saved ? "✓ محفوظ" : "⟳ جاري الحفظ..."}
          </span>
          <button onClick={archiveWeek} style={btnStyle}>📁 أسبوع جديد</button>
          <button onClick={exportJSON} style={btnStyle}>⬇ تصدير</button>
        </div>
      </div>

      {/* ─── 90-Day Progress ─── */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>هدف 90 يوم: {GOAL_90DAY.toLocaleString("en-US")} ريال</span>
          <span style={{ fontSize: 13, color: progressColor, fontWeight: 700 }}>{progressPct}%</span>
        </div>
        <div style={{ height: 10, borderRadius: 5, background: T.border }}>
          <div style={{ height: "100%", borderRadius: 5, background: progressColor, width: `${Math.min(progressPct, 100)}%`, transition: "width 0.3s" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: T.mid }}>
          <span>المحقق: {totalWeeklyRev.toLocaleString("en-US")} ريال</span>
          <span>المتبقي: {Math.max(GOAL_90DAY - totalWeeklyRev, 0).toLocaleString("en-US")} ريال</span>
          <span>الهدف الأسبوعي: {WEEKLY_TARGET.toLocaleString("en-US")} ريال</span>
        </div>
      </div>

      {/* ─── Tab Switcher ─── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap", background: T.surface, borderRadius: 12, padding: 4 }}>
        {tabs.map((t, i) => (
          <button key={i} onClick={() => setTab(i)} style={{
            padding: "8px 14px", borderRadius: 10, border: "none", cursor: "pointer",
            background: tab === i ? T.teal : "transparent",
            color: tab === i ? T.bg : T.mid,
            fontWeight: tab === i ? 700 : 400, fontSize: 12, fontFamily: "inherit",
            transition: "all 0.2s", whiteSpace: "nowrap",
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* ─── Tab Content ─── */}
      {tab === 0 && <Tab1Numbers data={data} update={update} />}
      {tab === 1 && <Tab2Team data={data} updateMember={updateMember} />}
      {tab === 2 && <Tab3Revenue data={data} update={update} updateWeeklyRev={updateWeeklyRev} />}
      {tab === 3 && <Tab4Retention data={data} update={update} retentionStats={retentionStats} referralStats={referralStats} loadingStats={loadingStats} />}
      {tab === 4 && <Tab5Decisions data={data} update={update} updateTask={updateTask} addTask={addTask} removeTask={removeTask} />}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 10, border: `1px solid ${T.border}`, cursor: "pointer",
  background: T.surface, color: T.text, fontSize: 12, fontFamily: "inherit", fontWeight: 600,
};

/* ═══════════════════════════════════════════════════════════════
   TAB 1 — أرقام الأسبوع
   ═══════════════════════════════════════════════════════════════ */
function Tab1Numbers({ data, update }: { data: WeeklyData; update: (p: Partial<WeeklyData>) => void }) {
  const cards = [
    { label: "💰 الإيراد الفعلي", key: "revenue" as const, target: 17500, unit: "ريال", color: T.teal },
    { label: "📦 صفقات مغلقة", key: "closed" as const, target: 15, unit: "", color: T.green },
    { label: "📈 نسبة الإغلاق %", key: "closeRate" as const, target: 35, unit: "%", color: T.purple },
    { label: "🔄 نسبة التجديد %", key: "renewRate" as const, target: 75, unit: "%", color: T.amber },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
      {cards.map(c => {
        const val = parseFloat(data[c.key]) || 0;
        const pct = c.target > 0 ? Math.round((val / c.target) * 100) : 0;
        return (
          <div key={c.key} style={{ ...cardStyle, borderTop: `2px solid ${c.color}` }}>
            <p style={{ fontSize: 13, color: T.mid, marginBottom: 8 }}>{c.label}</p>
            <input
              type="number"
              value={data[c.key]}
              onChange={e => update({ [c.key]: e.target.value })}
              placeholder="0"
              style={{ ...inputBase, fontSize: 28, fontWeight: 700, color: c.color }}
              onFocus={e => { e.target.style.borderBottomColor = T.teal; }}
              onBlur={e => { e.target.style.borderBottomColor = T.border; }}
            />
            <ProgressBar value={val} max={c.target} color={c.color} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11 }}>
              <span style={{ color: T.mid }}>الهدف: {c.target.toLocaleString("en-US")} {c.unit}</span>
              <span style={{ color: pctColor(pct) }}>{statusEmoji(pct)} {pct}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 2 — أداء الفريق
   ═══════════════════════════════════════════════════════════════ */
function Tab2Team({ data, updateMember }: { data: WeeklyData; updateMember: (i: number, f: keyof Member, v: string) => void }) {
  const cols = [
    { label: "الموظف", field: "name" as const },
    { label: "المكالمات", field: "calls" as const },
    { label: "العروض", field: "demos" as const },
    { label: "مغلق", field: "closed" as const },
    { label: "متوسط القيمة", field: "avgVal" as const },
    { label: "نسبة الإغلاق", field: "rate" as const },
    { label: "الحالة", field: "status" as const },
  ];
  const targets = { calls: "75", demos: "40", closed: "15", avgVal: "700+", rate: "35%+" };
  const statuses = ["🟢", "🟡", "🔴"];

  return (
    <div style={{ ...cardStyle, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.field} style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600, color: T.mid, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.members.map((m, i) => (
            <tr key={i} style={{ transition: "background 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.surface; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              {cols.map(c => (
                <td key={c.field} style={{ padding: "8px", borderBottom: `1px solid ${T.border}20` }}>
                  {c.field === "status" ? (
                    <select
                      value={m.status}
                      onChange={e => updateMember(i, "status", e.target.value)}
                      style={{ background: "transparent", border: "none", fontSize: 18, cursor: "pointer", color: T.text }}
                    >
                      {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input
                      value={m[c.field]}
                      onChange={e => updateMember(i, c.field, e.target.value)}
                      type={c.field === "name" ? "text" : "text"}
                      style={{
                        ...inputBase, fontSize: 14,
                        fontFamily: c.field === "name" ? "inherit" : "monospace",
                        color: c.field === "name" ? T.text : T.teal,
                      }}
                      onFocus={e => { e.target.style.borderBottomColor = T.teal; }}
                      onBlur={e => { e.target.style.borderBottomColor = T.border; }}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
          {/* Target row */}
          <tr style={{ background: `${T.teal}10` }}>
            <td style={{ padding: "10px 8px", fontWeight: 700, fontSize: 12, color: T.teal }}>الهدف الكلي</td>
            {(["calls", "demos", "closed", "avgVal", "rate"] as const).map(f => (
              <td key={f} style={{ padding: "10px 8px", fontSize: 12, fontWeight: 600, color: T.mid, fontFamily: "monospace" }}>
                {targets[f]}
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 3 — تتبع الإيراد
   ═══════════════════════════════════════════════════════════════ */
function Tab3Revenue({ data, update, updateWeeklyRev }: {
  data: WeeklyData;
  update: (p: Partial<WeeklyData>) => void;
  updateWeeklyRev: (i: number, v: string) => void;
}) {
  const sources = [
    { label: "عملاء جدد", key: "srcNew" as const, target: 30000, color: T.teal },
    { label: "Upsell", key: "srcUps" as const, target: 10000, color: T.purple },
    { label: "إحالات", key: "srcRef" as const, target: 5000, color: T.green },
    { label: "تجديدات", key: "srcRen" as const, target: 25000, color: T.amber },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Weekly revenue tracker */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>تتبع الإيراد الأسبوعي</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {data.weeklyRev.map((w, i) => {
            const val = parseFloat(w.rev) || 0;
            const pct = w.tgt > 0 ? Math.round((val / w.tgt) * 100) : 0;
            return (
              <div key={i} style={{ ...cardStyle, borderTop: `2px solid ${pctColor(pct)}` }}>
                <p style={{ fontSize: 12, color: T.mid, marginBottom: 6 }}>{w.w}</p>
                <input
                  type="number"
                  value={w.rev}
                  onChange={e => updateWeeklyRev(i, e.target.value)}
                  placeholder="0"
                  style={{ ...inputBase, fontSize: 22, fontWeight: 700, color: T.teal }}
                  onFocus={e => { e.target.style.borderBottomColor = T.teal; }}
                  onBlur={e => { e.target.style.borderBottomColor = T.border; }}
                />
                <ProgressBar value={val} max={w.tgt} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: T.mid }}>
                  <span>الهدف: {w.tgt.toLocaleString("en-US")}</span>
                  <span>{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Revenue sources */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>مصادر الإيراد</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {sources.map(s => {
            const val = parseFloat(data[s.key]) || 0;
            const pct = s.target > 0 ? Math.round((val / s.target) * 100) : 0;
            return (
              <div key={s.key} style={{ ...cardStyle, borderTop: `2px solid ${s.color}` }}>
                <p style={{ fontSize: 12, color: T.mid, marginBottom: 6 }}>{s.label}</p>
                <input
                  type="number"
                  value={data[s.key]}
                  onChange={e => update({ [s.key]: e.target.value })}
                  placeholder="0"
                  style={{ ...inputBase, fontSize: 22, fontWeight: 700, color: s.color }}
                  onFocus={e => { e.target.style.borderBottomColor = T.teal; }}
                  onBlur={e => { e.target.style.borderBottomColor = T.border; }}
                />
                <ProgressBar value={val} max={s.target} color={s.color} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: T.mid }}>
                  <span>الهدف: {s.target.toLocaleString("en-US")} ريال</span>
                  <span>{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 4 — الاحتفاظ والإحالة
   ═══════════════════════════════════════════════════════════════ */
function Tab4Retention({ data, update, retentionStats, referralStats, loadingStats }: {
  data: WeeklyData;
  update: (p: Partial<WeeklyData>) => void;
  retentionStats: RetentionStats | null;
  referralStats: ReferralStats | null;
  loadingStats: boolean;
}) {
  const retRows: { label: string; field: keyof RetentionStats; target?: number; unit?: string; color: string }[] = [
    { label: "تجديدات هذا الأسبوع", field: "renewed", color: T.teal },
    { label: "اشتراكات تنتهي قريباً", field: "expiring", color: T.amber },
    { label: "تم التواصل معهم", field: "contacted", color: T.green },
    { label: "Upsell مكتمل", field: "upsell", target: 5, color: T.purple },
    { label: "نسبة التجديد %", field: "renewRate", target: 75, unit: "%", color: T.teal },
  ];
  const refRows: { label: string; field: keyof ReferralStats; target?: number; unit?: string; color: string }[] = [
    { label: "محيلين نشطين", field: "active", target: 30, color: T.purple },
    { label: "إحالات جديدة", field: "newRefs", target: 15, color: T.teal },
    { label: "تحولت لعملاء", field: "converted", target: 5, color: T.green },
    { label: "مكافآت صُرفت", field: "rewards", unit: "ر.س", color: T.amber },
    { label: "نسبة التحويل %", field: "convRate", target: 33, unit: "%", color: T.purple },
  ];

  const dbBadge: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 4,
    fontSize: 10, padding: "2px 8px", borderRadius: 6,
    background: `${T.teal}15`, color: T.teal, fontWeight: 600,
  };

  const loadingDot = loadingStats ? "⟳" : "✓";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
      {/* Retention */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: T.teal }}>🔄 الاحتفاظ بالعملاء</h3>
          <span style={dbBadge}>{loadingDot} من قاعدة البيانات</span>
        </div>
        {retRows.map(r => {
          const dbVal = retentionStats ? retentionStats[r.field] : null;
          const displayVal = dbVal !== null ? (r.unit === "%" ? `${dbVal}%` : String(dbVal)) : "—";
          const pct = r.target && dbVal !== null ? Math.min(Math.round((dbVal / r.target) * 100), 100) : null;
          return (
            <div key={r.field} style={{ padding: "12px 0", borderBottom: `1px solid ${T.border}20` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: T.mid, flex: 1 }}>
                  {r.label}
                  {r.target ? <span style={{ fontSize: 10, color: T.dim }}> / هدف: {r.target}{r.unit || ""}</span> : null}
                </span>
                <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", color: r.color, minWidth: 60, textAlign: "left" as const }}>
                  {loadingStats ? "..." : displayVal}
                </span>
              </div>
              {pct !== null && !loadingStats && (
                <div style={{ height: 4, borderRadius: 2, background: T.border, marginTop: 6, width: "100%" }}>
                  <div style={{ height: "100%", borderRadius: 2, background: r.color, width: `${pct}%`, transition: "width 0.3s" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Referral */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: T.purple }}>🎁 برنامج الإحالة</h3>
          <span style={{ ...dbBadge, background: `${T.purple}15`, color: T.purple }}>{loadingDot} من قاعدة البيانات</span>
        </div>
        {refRows.map(r => {
          const dbVal = referralStats ? referralStats[r.field] : null;
          const displayVal = dbVal !== null ? (r.unit === "%" ? `${dbVal}%` : r.unit === "ر.س" ? `${dbVal.toLocaleString("en-US")} ر.س` : String(dbVal)) : "—";
          const pct = r.target && dbVal !== null ? Math.min(Math.round((dbVal / r.target) * 100), 100) : null;
          return (
            <div key={r.field} style={{ padding: "12px 0", borderBottom: `1px solid ${T.border}20` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: T.mid, flex: 1 }}>
                  {r.label}
                  {r.target ? <span style={{ fontSize: 10, color: T.dim }}> / هدف: {r.target}{r.unit || ""}</span> : null}
                </span>
                <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", color: r.color, minWidth: 60, textAlign: "left" as const }}>
                  {loadingStats ? "..." : displayVal}
                </span>
              </div>
              {pct !== null && !loadingStats && (
                <div style={{ height: 4, borderRadius: 2, background: T.border, marginTop: 6, width: "100%" }}>
                  <div style={{ height: "100%", borderRadius: 2, background: r.color, width: `${pct}%`, transition: "width 0.3s" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 5 — قرارات ومهام
   ═══════════════════════════════════════════════════════════════ */
function Tab5Decisions({ data, update, updateTask, addTask, removeTask }: {
  data: WeeklyData;
  update: (p: Partial<WeeklyData>) => void;
  updateTask: (i: number, f: keyof Task, v: string) => void;
  addTask: () => void;
  removeTask: (i: number) => void;
}) {
  const decisions = [
    { label: "📉 وش الرقم الأسوأ؟", field: "worst" as const, borderColor: T.red },
    { label: "📈 وش الرقم الأفضل؟", field: "best" as const, borderColor: T.green },
    { label: "⚡ القرار الواحد الأهم", field: "mainDecision" as const, borderColor: T.amber },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Decision cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
        {decisions.map(d => (
          <div key={d.field} style={{ ...cardStyle, borderRight: `3px solid ${d.borderColor}` }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: T.text }}>{d.label}</p>
            <textarea
              value={data.decisions[d.field]}
              onChange={e => update({ decisions: { ...data.decisions, [d.field]: e.target.value } })}
              placeholder="اكتب هنا..."
              style={textareaBase}
              onFocus={e => { e.target.style.borderBottomColor = T.teal; }}
              onBlur={e => { e.target.style.borderBottomColor = T.border; }}
            />
          </div>
        ))}
      </div>

      {/* Tasks table */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>المهام</h3>
          <button onClick={addTask} style={{ ...btnStyle, fontSize: 12, padding: "6px 14px" }}>+ إضافة مهمة</button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["#", "المهمة", "المسؤول", "الديدلاين", "×"].map(h => (
                <th key={h} style={{ padding: "10px 8px", textAlign: h === "×" ? "center" : "right", fontWeight: 600, color: T.mid, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.tasks.map((t, i) => (
              <tr key={i}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.surface; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <td style={{ padding: "8px", color: T.dim, fontSize: 12, borderBottom: `1px solid ${T.border}20` }}>{i + 1}</td>
                <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}20` }}>
                  <input value={t.task} onChange={e => updateTask(i, "task", e.target.value)}
                    style={{ ...inputBase, fontSize: 13, fontFamily: "inherit" }}
                    placeholder="المهمة..."
                    onFocus={e => { e.target.style.borderBottomColor = T.teal; }}
                    onBlur={e => { e.target.style.borderBottomColor = T.border; }} />
                </td>
                <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}20` }}>
                  <input value={t.owner} onChange={e => updateTask(i, "owner", e.target.value)}
                    style={{ ...inputBase, fontSize: 13, fontFamily: "inherit", width: 100 }}
                    placeholder="المسؤول"
                    onFocus={e => { e.target.style.borderBottomColor = T.teal; }}
                    onBlur={e => { e.target.style.borderBottomColor = T.border; }} />
                </td>
                <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}20` }}>
                  <input type="date" value={t.deadline} onChange={e => updateTask(i, "deadline", e.target.value)}
                    style={{ ...inputBase, fontSize: 12, fontFamily: "monospace", width: 130, direction: "ltr" as const, textAlign: "right" as const }}
                    onFocus={e => { e.target.style.borderBottomColor = T.teal; }}
                    onBlur={e => { e.target.style.borderBottomColor = T.border; }} />
                </td>
                <td style={{ padding: "8px", textAlign: "center", borderBottom: `1px solid ${T.border}20` }}>
                  <button onClick={() => removeTask(i)} style={{
                    background: `${T.red}20`, border: "none", borderRadius: 6, color: T.red,
                    cursor: "pointer", padding: "4px 10px", fontSize: 14, fontWeight: 700,
                  }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
