# Owner Decisions Log

Source: WhatsApp from owner (+966 54 394 4872) on 2026-05-02.

| # | Question | Owner answer | Engineering implication |
|---|---|---|---|
| 2a | Telesales separate from Sales? | **Yes — two distinct departments**, both under one "Sales / المبيعات" parent | Org schema needs nested departments (parent_department_id). Telesales + Sales both children of "Sales" parent. |
| 2b | Inbound + Outbound? | **Both** | `lead_sources` enum needs both; pipeline must handle the two intake paths. |
| 1 | Renewal cycle trigger? | **Varies per client.** Some monthly, some 3-monthly, some 6-monthly. Website/platform packages have their own cycles. They maintain a Sheet tracking every client's cycle, dates, packages. | `renewal_cycles` must be **per-contract / per-project**, NOT a global rule. Each project gets a `cycle_length_months` + `next_renewal_date`. Need to import the Sheet at some point. |
| **PRIORITY** | — | **"تركيزنا في بناء السستم حاليا في قسم التيكنكيتل وليس في قسم السيلز. التيكنيكال اولوية"** — Technical department is the priority. Sales is **not** in the current MVP. | **Defer Phase 14 (Sales Engine).** Reorder the master plan: build everything serving the Technical org first (AM, Media Buying, SEO, Social Media, + supporting departments). Sales/Telesales become a later phase. |

| 5 | **SLA per stage** | Owner answer (2026-05-02): see table below | Two-tier model: per-stage SLA for short stages + per-template SLA for variable stages. |

### SLA values from owner

| Stage | Max time | Notes |
|---|---|---|
| New | **per-task** | depends on the specific task — must come from `task_templates.sla_minutes` |
| In Progress | **per-task** | same — per template |
| Manager Review | **30 min** | global |
| Specialist Review | **30 min** | global |
| Ready to Send | **15 min** | global |
| Sent to Client | **4 hours** | global |
| Client Changes | **24 hours** | "ولازم يخلص التعديل" — hard cap, must complete |

**Engineering implications:**
- `sla_rules` table = global per-stage values (5 rows: Manager Review, Specialist Review, Ready to Send, Sent to Client, Client Changes).
- `task_templates.sla_minutes_new` and `task_templates.sla_minutes_in_progress` = per-template overrides for the variable stages.
- Per-task fallback: `tasks.sla_override_minutes` (manual AM override if needed).
- **Critical:** 15-min and 30-min SLAs imply the SLA watcher must run **every 5 minutes** (not 15) to catch breaches close to real-time.
- **Business hours question (re-ask):** do these SLAs pause overnight / on weekends? At 30 min, a Wed-9pm transition would breach by Wed-9:30pm. Need owner confirmation: 24/7 clock or business-hours clock?

## SLA prior values (still apply)

| 5b | Business-hours SLA clock? | **"خلال وقت الدوام فقط"** — business-hours only. |
| 5c | Exact business hours + working days? | **الأحد–الخميس، ٩ ص – ٥ م** Asia/Riyadh. |

## Owner answers — round 2 (2026-05-02 evening)

### Q3 — Org chart (definitive — seed data for T1)

| Department | Head | Team Leads | Notes |
|---|---|---|---|
| Account Management | آيه خفاجي | 3 | — |
| Media Buying | أشرف مختار | 1 | — |
| SEO | حسن شاهين | 2 | — |
| Social Media | حسن ياسر | 1 | Now also writes content (absorbed Social Content) |
| Designing | عمر الخيام | 0 | — |
| Programming | — | — | **زياد حجي only — single contributor, no hierarchy** |
| SEO Content | محمد عادل | 0 | — |
| ~~Social Content~~ | — | — | **DEPARTMENT DISSOLVED** — work moved to Social Media |
| ~~QC~~ | — | — | **DROPPED from current scope** (owner directive 2026-05-02) — re-add later if needed |

### Q1 — Client Changes SLA clarification
> "نقصد فيها نفس اليوم او اليوم التالي مباشرة"

→ **Same workday or next workday max.** With 8-hour business days, this is **8 business hours** (one full workday) — NOT 24. Override the earlier 1440-min seed.

### Q7 — Renewals
> "regarding the renewals it will be the same project not a new one"

→ **Same `projects` row.** New `renewal_cycles(project_id, cycle_no, ...)` rows track each cycle.

### Q4 — Exceptions
> "regarding exceptions use what exist in the .md file"

→ **4 types as defined in owner doc §26**: Client / Deadline / Quality / Resource.
→ **Closed list** (no additional types).
→ **Default behavior:** notification + log entry, NO auto-action. Escalation paths follow §27 model but firing is event-driven, not automatic.

### Q6 — WhatsApp
> "for whatsapp ignore it for now"

→ **T8 dropped from current scope.** Move to a future "Phase F" parking lot.

### Q8 — QC permissions
Owner directive 2026-05-02 (round 3): **"ignore the QC for now"**.
→ **QC dropped entirely from current scope.** No QC department seed, no QC dashboard, no governance-violation observer UI in T6. Re-add when owner asks.

### Q9 — Decision Rights additions — not yet answered, defer to T5 prep

## Bonus: Owner provided the Acc Sheet 📊

Saved at `docs/data/acc-sheet.xlsx`. **It is much bigger than just renewals.** 7 tabs covering the entire commercial layer:

| Tab | Rows | What it actually is |
|---|---|---|
| `Cycle_tracker` | 979 | Per-client monthly cycle: state, start date, grace days, expected vs actual meeting date, expected vs actual cycle-add date |
| `💲Installments Tracker` | 991 | Payment plans: contract value + up to 5 installment dates/amounts |
| `Edits Updates log` | 869 | Audit log of every contract event: New, Renew, Lost, Hold, etc. |
| `Clients Contracts` | 1000 | Master contract table: client, AM, start date, target, package, type, duration, paid value |
| `CEO_Dashboard` | — | Service pricing (نوفا/ذهبية/حملات…) + monthly KPIs (New/Renewed/Hold/Total/UPSELL/Win-Back) |
| `TARGET_CONTRACTS` | — | Monthly target tracking: on-target / overdue / renewed / lost / installments / expected |
| `Acc_Target_Breakdown` | — | Per-AM monthly target performance with achievement % |

**This is not a "renewal sheet" — it's the entire commercial operating system for AM, currently in Excel.** Engineering implication: we need to add **T7.5 — Commercial Layer** (service catalog · contract types · installments · monthly targets · cycle-meetings · CEO dashboard) as a major new phase between T7 (Cycles) and T9 (Reporting).

## Still open — minor

| # | Question | Priority |
|---|---|---|
| 8 | Explicitly confirm QC = "read-only + notes" | minor |
| 9 | Decision Rights additions to the 6-row matrix? | minor |
