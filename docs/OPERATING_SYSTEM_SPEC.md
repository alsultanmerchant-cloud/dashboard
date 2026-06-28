# Agency Operating System — Full Spec & Data-Availability Triage

Source: Sky Light team brief (2026-06-28). This is the **roadmap vision** for the
whole operating system. Captured here so we track it deliberately instead of
scope-creeping the activity monitor. Each item is tagged with what the data
actually supports today.

Legend: ✅ have · 🟢 buildable from existing data · 🟡 partial / proxy ·
🔴 no data (needs new instrumentation) · 📦 separate module.

---

## The 5 operational indices (CEO-facing)

### 1. Delivery Commitment — مؤشر الالتزام بالتسليم
- on-time deliveries ✅ · overdue count ✅ · avg delay (`delay_days`) ✅ ·
  late projects in cycle 🟢 · **blocked tasks 🔴** (`task_links` empty).
- Lives mostly in **/accountability** (SLA/deadline). `src/lib/data/performance/delivery-commitment.ts` exists.

### 2. Execution Quality & Client Satisfaction — جودة التنفيذ ورضا العملاء
- rework count ✅ (`client_changes` re-entries) · client-changes rate ✅ ·
  rejected-task rate 🟢 · **brief adherence 🟡** (AI) · **satisfaction 🟡** (WhatsApp AI) ·
  complaints 🟡 (WhatsApp groups). 📦 Satisfaction module already exists (/satisfaction).

### 3. Team Discipline & Activity — الالتزام والنشاط التشغيلي
- **real active hours / first-last activity / idle 🔴** (no login/session data — agents don't log in; HR remote-activity module).
- actions executed 🟡 (proxy: stage moves + Log Notes) · response speed → /accountability SLA ·
  **movement rate ✅** · **task-update rate 🟢** (`task_comments` = 93k rows) ·
  **tasks without updates 🟢** (Log Notes recency) · internal upload-deadline adherence 🟡 (`upload_offset_days_before_deadline`, 13 templates) ·
  individual delay rate ✅ · SLA time → /accountability.
- **This is نبض الفريق.** Activity = stage transitions + Log-Note updates (no logins).

### 4. Team Productivity & Capacity — الإنتاجية والقدرة التشغيلية
- completed tasks ✅ · output per team ✅ · **tasks per employee ✅** (WIP: median 15, max 214) ·
  capacity utilization 🟡 (relative to team median; no absolute capacity baseline) ·
  workload pressure ✅ · **overloaded / underutilized ✅** · load balance ✅.
- **Buildable now into نبض الفريق** (Capacity/Load dimension).

### 5. Operational Stability Index — مؤشر الاستقرار التشغيلي العام
- Composite of #1–#4 + risk + period-over-period change + escalations. 📦 Needs all
  inputs + escalation engine first. Executive-scores band is a partial precursor.

---

## Executive AI Reports — التقارير التنفيذية الذكية
Auto CEO summary, period-over-period comparison, top operational changes, current
risks, most-stable/declining departments, insights & recommendations, at-risk
projects, un-actioned escalations from Head of Technical.
- 🟡 Precursors exist: CEO brief (ceo_brief_runs), AI insights, accountability.
- 📦 Period-over-period now possible via `performance_snapshots` (0216).

---

## Finance & Contracts module 📦 (largely exists, expanding)
Accountant UI, contract registry (type/package/value/payment/status/target),
payments & collections, per-department target & commission, payroll & deductions,
expenses, alerts/escalations, financial dashboard, AI financial analysis.
- ✅ Contracts + targets exist (am_targets, monthly_target_snapshot, /contracts).
- 🔴 Payroll, commission engine, expenses, accountant UI = to build.

## HR module 📦 (to build)
Employee profile, attendance & **activity monitoring (remote)** 🔴, leave mgmt,
salary & commission, internal requests, onboarding/offboarding, warnings/violations,
recruitment/candidate DB, HR KPIs.

## Head / Team-Leader dashboards 📦
Department overview, employee performance, **monthly closing** (head-only, month
filter), capacity tracking, smart escalation system (TL → Dept Head → Head of
Technical → exec), AI agents (smart tasks, bottleneck detection, auto reports).

---

## Domain reference (workflow)
- **Standard flow:** New → In Progress → Manager Review → Ready to Send → Sent to
  Client → Client Changes → Done. (Some tasks: New → In Progress → Done.)
- **Supporting-dept flow** adds **Specialist Review** (main-dept reviews the
  supporting-dept output) before Ready to Send.
- **Stage ownership:** New/In Progress = responsible agent · Manager Review =
  head/TL · Specialist Review = main-dept owner · Ready to Send = approver ·
  Sent to Client / Client Changes = Account Manager · Done = AM or owner.
- **Known gap:** supporting-dept assignment happens *inside* the main task (not a
  separate task), so handoff-wait isn't independently measurable — must parse Log
  Notes for "when was the supporting dept requested vs assigned" to attribute delay
  fairly. AI delay analysis must account for this.

---

## Active build: نبض الفريق activity enhancements (in progress)
1. **Capacity/Load** — WIP per agent, overloaded/underutilized vs team median. ✅ data.
2. **Log-Notes update activity** — last update, tasks-without-update, updates/week. ✅ data (`task_comments`).
Out of scope here: login hours (🔴), blocked tasks (🔴 empty `task_links`), the
full 5-index composite, finance/HR/escalation modules (📦).
