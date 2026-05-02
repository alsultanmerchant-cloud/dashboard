# Sky Light (Rwasem) Live Odoo 17 — Read-Only Audit

**Audit date:** 2026-05-02
**Instance:** Live production (Odoo 17.0).
**Method:** read-only JSON-RPC probes via `src/lib/odoo/client.ts`.
**Cross-reference doc:** `docs/SPEC_FROM_PDF.md`. Section numbers below refer to it.
**Activity sanity-check:** latest `project.task.write_date` = `2026-05-01 12:29` and latest `mail.message` = `2026-04-30 20:29` — instance is in active daily use.

---

## 1. Executive summary

### What Skylight actually uses
- **One Odoo project = one client deal** (74 active `project.project` records, 1,918 `project.task`).
- The 8-stage PDF workflow is implemented **verbatim**: every project's `type_ids` are `[New(232), In Progress(2509), Manager Review(2379), Specialist Review(3598), Ready to Send(2380), Sent to Client(2381), Client Changes(2382), Done(2510)]`. No deviations across all 73 active projects.
- Tasks are **service-tagged via `project.category` (m2m on project, m2o on task)**. The active service taxonomy is exactly:
  - 64 ⚪ Account Manager · 134 🟢 Media Buying · 234 🔵 Social Media · 235 🟠 SEO
  - 161 🟤 Salla / Zid Store · 162 🟤 Wordpress Website · 265 🟤 Store Enhancement
  - 145 ⚫ Company Profile · 157 ⚫ Landing page
  - 71 🟠 Renewal SEO · 158 🔵 Renewal Social Media · 68 ⚪ Renewal of Acc Manager · 69 🟢 Renewal Media Buying
- **Auto-task generation** (PDF Stage 0) is the `project.category.task` template engine: 279 template rows, ~5–15 per category, each with a `task_duration` (in days) used to seed `date_deadline`. This **is** the Stage-0 mechanism the PDF describes.
- **Per-stage time tracking** is supplied by the `eg_task_stage_duration` addon: 33,837 `task.stage.time` rows back the `current_stage_duration`, `duration_days`, `delay_days` fields visible on every task.
- **Log Note** is the standard Odoo chatter: 78,154 `mail.message` rows on `project.task` plus 6,341 `ir.attachment` — heavily used.
- **People model is flat:** 110 internal `res.users`, 0 real `hr.department` data (the single "Administration" row is a stub), and the actual ops grouping is two custom groups: `manager-group` (28 members) and `member-group` (39 members). `hr.employee` is unused (only 2 records). The PDF's 5-tier org **does not exist as data** — it lives only in users' heads.
- **WhatsApp** integration is **not installed** (no `tus_meta_*` modules). Only 1 `discuss.channel` of type `group` exists (irrelevant). PDF §10 is aspirational for Odoo today.
- **Accounting / sales / POS** modules are installed (Saudi e-invoice, payroll, POS Restaurant…) but **unused**: 0 `account.move`, 3 `sale.order`, 14 `crm.lead`. The decision to skip ZATCA/accounting in our clone is correct — no live data to migrate.

### The 5–10 things we MUST clone faithfully
1. **8-stage kanban with role-bound exit** (already done in `STAGE_EXIT_ROLE`).
2. **`project.category` taxonomy** as a first-class "Service" entity, with the exact 13 active categories above (color emoji prefix = the visible badge on Project tiles).
3. **`project.category.task` template engine**: a service has an ordered list of seed-tasks each with a default `duration_days`. When a project is created with N services, we generate `Σ templates` tasks and set `planned_date = project.start + duration_days`.
4. **`eg_task_stage_duration` semantics**: per-task, per-stage time tracking, exposed as `current_stage_duration`, `duration_days`, `delay_days`. **This is the entire "Duration vs Deadline" mechanic from PDF §5.**
5. **Multi-specialist project header**: project has 4 separate role slots — `account_manager_id` (also `partner_account_manager_id`), `social_specialist_id`, `media_specialist_id`, `seo_specialist_id`, plus `user_id` (Project Manager). PDF §6 Project Box maps to these.
6. **Task Log Note** = chatter with attachments + @mentions + a `Stage Changed` system subtype that auto-posts on transition (PDF §8.4).
7. **Project code** (`project_code = "PRJ-01815"`) — short human ID printed everywhere.
8. **`store_name`** field on project (already used: "ARTDECO", "LUMÉA Line"…) — distinct from project name, often the client's brand.
9. **`target` selection** on project (`on_target / off_target / out / sales_deposit / renewed`) — Skylight uses this as a coarse health flag; current data is 100% `off_target` so the workflow may not be enforced but the field is wired.
10. **Renewal categories** (Renewal of Acc Manager / Renewal Media Buying / Renewal SEO / Renewal Social Media) — explicit second-phase service tracks distinct from initial onboarding.

### Top enhancement opportunities for the modern clone
- **Real org tree** (5 tiers per PDF §9): replace `manager-group`/`member-group` with departments, sections, and roles — none of this is in Odoo today.
- **Quality Control** as a watcher role outside the daily flow (PDF §9): missing in Odoo entirely.
- **Forbid stage change during Client Changes** (PDF §3 Stage 8 hard rule): Odoo doesn't enforce this; the dashboard can.
- **Deadline-vs-Duration dashboards**: Odoo exposes the fields but no view aggregates them. A "late-by-stage" heatmap is a clear product win.
- **WhatsApp auto-grouping** (PDF §10): not built anywhere; we can implement Client Group / Internal Group naming + ownership when an AM is assigned.
- **Upload-deadline derivation** (PDF §11): Odoo just stores `date_deadline`. The "upload date = deadline − N days" logic is mental — we can compute & enforce it (already partially seeded in our migration `0013`).
- **Project HOLD** state with a reason field — Odoo only has the `target` selection and `last_update_status` (`on_hold` is one of its values, used = 0 in current data). Worth surfacing as a dedicated overlay.
- **Audit/timeline view** in the UI: `task.stage.time` already has 33k rows; today they're invisible. Render them as a Stage History tab (PDF §8.3) — high ROI, zero new schema.

---

## 2. Installed modules (165 total, `state=installed`)

### A. Core Odoo (used heavily in domain)
| Module | Purpose |
|---|---|
| `project`, `project_account`, `project_customization`, `project_todo`, `project_mrp`, `project_purchase`, `project_sms`, `sale_project`, `project_timesheet_holidays` | The Project app and its many extensions. Project + Tasks + chatter is the entire Skylight workflow. |
| `mail`, `bus`, `mail_bot` | Chatter / Log Note (78,154 messages on tasks). |
| `hr`, `hr_holidays`, `hr_org_chart`, `hr_skills`, `hr_timesheet`, `hr_hourly_cost`, `hr_maintenance` | Installed but **2 employees** total — HR module is dead. |
| `contacts` (`res.partner`) | 376 partners, 199 customers. |
| `web`, `web_editor`, `web_hierarchy`, `web_tour` | Standard. |
| `auth_*`, `mail`, `bus`, `digest`, `calendar`, `calendar_sms` | Standard. |

### B. Used heavily — custom & third-party
| Module | Why it matters |
|---|---|
| **`eg_task_stage_duration`** (INKERP) | The Duration mechanic. Adds `task.stage.time` (33,837 rows), `current_stage_duration`, `duration_days`, `delay_days`, `actual_done_date`, `working_days_open/close` on `project.task`. **Critical for our clone — already partly mirrored in our schema.** |
| **`aptuem_project_default_task`** | Owner of `project.category.task` (279 rows) — the template engine. Adds `temp_task_ids` on project and `category_ids` m2m. |
| **`rwasem_project_category_enhancements`** (Amr Ali) | Adds the 4 specialist m2o fields (`account_manager_id`, `social_specialist_id`, `media_specialist_id`, `seo_specialist_id`) on project + extends category UX. |
| **`rwasem_project_task_progress`** (Amr Ali) | Source of `progress_percentage`, `expected_progress`, `progress_slip`, `progress_display` on tasks. |
| **`ks_dashboard_ninja`**, `ks_gantt_view_base`, `ks_gantt_view_project` (Ksolves) | Source of all `ks_*` fields on tasks/projects (Gantt + dashboards). Heavy Gantt usage in Odoo UI; not directly relevant to our clone. |
| `sh_document_management` (Softhealer) | Adds `document.directory` model — **0 records**, unused in practice. |
| `simplify_access_management` (Terabits) | Adds `access.management`, hide-field/view rules — used to hide some fields from non-admin users. |
| `spiffy_theme_backend` | Adds dashboard/multi-tab UX in Odoo's UI; irrelevant to our clone. |

### C. Custom Rwasem-branded (15)
All are namespaced; the actively-relevant ones for the workflow are:
- `rwasem_project_category_enhancements` — service taxonomy + project specialist fields (above).
- `rwasem_project_task_progress` — progress percentages (above).
- `rwasem_task_bulk_update` — adds the "Task Bulk Update" `res.groups` (id 365, 3 users); a wizard whose `task.bulk.update.wizard` model exists but is access-restricted from our user.
- `rwasem_document_management_project` + `rwasem_document_management_project_extend` — extends `ir.attachment` on project; in practice attachments live as plain `ir.attachment` rows (6,341 on tasks, 328 on projects).
- `rwasem_project_notification`, `rwasem_notifications_link`, `stage_update_by_email` — wire stage-change emails (Skylight's "Rwasem Project Stage Update Notify via Email").
- `rwasem_customer_report`, `rwasem_error_report` — internal reporting toggles.
- `crm_activity_extended` — small CRM tweak; CRM is unused (14 leads).
- `workflow_core_rr` (`workflow.user`/`workflow.group` models) — **0 records**, dead.
- `rwasem_*` modules for unrelated industries (`rwasem_alfarouk`, `rwasem_beauty_website`, `rwasem_construction`, `rwasem_fitness`, `rwasem_rahba`, `rwasem_maintenance*`, `rwasem_pos`, `rwasem_zatca`, `rwasem_simple_payroll`, `rwasem_spiffy_theme_enhancements`, `rwasem_menu_*`) — all are old multi-tenant artifacts from the Rwasem product line, **not used by Skylight**.

### D. Dead weight (installed but Skylight has 0 records)
- All accounting (`account*`, `om_account_*`, `accounting_pdf_reports`, `oi_*`, `ksa_e_invoice`, `l10n_sa*`, `om_fiscal_year`, `om_recurring_payments`, `email_debranding`): `account.move=0`.
- All POS (`point_of_sale`, `pos_*`, `loyalty`, `pos_loyalty`, `pos_restaurant*`, `pos_self_order*`, `l10n_gcc_pos`, `fuap_*`, `mkasib_*`, `ivis_*`, `odoo17_branding`, `pos_sale*`).
- All inventory/MRP (`stock`, `stock_*`, `purchase`, `purchase_stock`, `mrp`, `mrp_account`, `barcodes*`, `data_cleaning`).
- Sales (`sale`, `sale_management`, `sale_crm`, `sale_margin`, `sale_pdf_quote_builder`, `sale_service`, `sale_timesheet*`): only 3 SO rows.
- HR extras (`hr_skills`, `hr_org_chart`, `hr_holidays`, `hr_timesheet`, `hr_maintenance`, `hr_hourly_cost`).
- `maintenance`, `tk_asset_maintenance` (not installed): N/A.
- Spreadsheets (`spreadsheet*`, `spreadsheet_dashboard*`).
- Misc (`creative_login_form`, `dashboard_ninja_customization`, `partner_autocomplete`, `phone_validation`, `privacy_lookup`, `iap*`, `snailmail*`, `sms`, `digest`, `rating`, `portal*`, `payment`, `auth_totp*`, `web_unsplash`, `custom_report_url`, `zt_default_terms_conditions`).

**Conclusion:** the Skylight Odoo deployment is functionally **just Project + Mail + Partners + the 5 Rwasem/INKERP/Aptuem add-ons** that wire the agency workflow. Everything else is module bloat from the Rwasem ERP origin.

---

## 3. Per-domain inventory

### 3.1 Roles & permissions

**Models:** `res.groups` (102 total), `res.users` (110 internal, plus portal/system), `ir.module.category`.

**Sky Light's actual role mapping (from `res.groups` membership):**

| Custom group | id | Members | What it likely means |
|---|---|---|---|
| `manager-group` | 328 | 28 | "Heads/Managers" tier (PDF §9 tier 4). Implies all major Officer/Administrator perms (Employees, Time Off, Project Admin, Sales, Inventory, Accounting). |
| `member-group` | 327 | 39 | "Agents/Specialists" tier (PDF §9 tiers 2 & 3). Implies basic User perms across Sales/Inventory/Time Off/Project User. |
| `Task Bulk Update` (`Extra Rights`) | 365 | 3 | Admin-style perm for bulk task moves (`gehad`, `mennaibrahim`, `nadjisabri`). |
| `Project: All Documents` | 142 | 48 | Built-in Project admin tier — Skylight gives almost half the users this. |
| `Project: Own Documents` | 141 | 5 | Built-in restricted-Project — 5 users only. |
| `Workflow / Manager`, `Workflow / Edit Only`, `Workflow / Create/Edit` | 332–334 | 1 each | From `workflow_core_rr` — 0 actual workflows defined; effectively dead. |

**PDF role → Odoo reality:**
| PDF §4 / §9 role | How Odoo encodes it | Status |
|---|---|---|
| Account Manager | `project.account_manager_id` (m2o on `res.users`). No dedicated `res.groups` — anyone in `member-group`/`manager-group` can be selected. | ⚠ ad-hoc |
| Specialist (Social/Media/SEO) | `project.social_specialist_id` / `media_specialist_id` / `seo_specialist_id` (m2o per type). No group enforces who is eligible. | ⚠ ad-hoc |
| Manager (Section Head) | `manager-group` (id 328). | ✅ data exists |
| Agent (Executor) | `member-group` (id 327) + `task.user_ids`. | ✅ data exists |
| Quality Control | **Not present.** | ❌ missing |

Sample of internal users (logins all `@skylightad.com` or `@rwasem.com`):
```
[2]   admin@rwasem.com                    Administrator (55 groups)
[309] aya.khafaji@skylightad.com          اية خفاجي     (37 groups, often the project_id.user_id = "Project Manager")
[763] selmi.tamer@skylightad.com (≈)      سلمي تامر     (Account Manager on multiple recent projects)
[766] dina.alhusayni@skylightad.com (≈)   دينا الحسيني  (Account Manager)
[767] basmla.mohamed@skylightad.com (≈)   بسملة محمد    (Account Manager)
[1171] mariam.magdy@skylightad.com (≈)    مريم مجدي     (Account Manager)
[339] israa.osama@skylightad.com          اسراء اسامه   (member-group)
[344] (single-assignee on website tasks)  محمد حجي      (Agent — Wordpress)
```

**Departments (`hr.department`):** **1 row** ("Administration", manager=null, 1 member). The PDF org structure is **not encoded as departments**. We must build it ourselves.

**Status in our dashboard:** ✅ have employees, departments, roles, sections — we are **ahead of Odoo here**. We can ignore Odoo's group taxonomy and import `manager-group`/`member-group` membership as a one-time hint when seeding employee roles.

---

### 3.2 Clients (`res.partner`)

| Bucket | Count |
|---|---|
| Total partners | 376 |
| `customer_rank > 0` | 199 |
| Companies (`is_company=true`) | 5 |
| Customer companies | 4 |
| `res.partner.category` (tags) | **0** |
| `res.partner.industry` | unused on samples |

**`fields_get` on `res.partner`:** 208 fields total — **no Rwasem-custom fields**. Standard Odoo only (`name`, `email`, `phone`, `mobile`, `website`, `street/city/country`, `customer_rank`, `is_company`, `comment`).

**Sample (latest 5 customers):**
```json
{"id":1917,"name":"مها","is_company":false,"customer_rank":1,"email":false,"phone":false}
{"id":1916,"name":"مؤسسة عبدالله التويرجي","is_company":false,"customer_rank":1}
{"id":1915,"name":"مركزالتميز بلس","is_company":false,"customer_rank":1}
{"id":1914,"name":"حياة","is_company":false,"customer_rank":1}
{"id":1913,"name":"حياة وبثينة","is_company":true,"customer_rank":1}
```

**Observations:**
- Almost all partners are **bare-name records** with no email/phone/website/category. Skylight uses `res.partner` as a name lookup, nothing more.
- Brand identity actually lives on `project.store_name` (e.g. "ARTDECO", "LUMÉA Line"), not on the partner.
- 0 categories means no segmentation — segmentation is via the project's `project.category` (the service).

**PDF cross-ref:** §6 Project Box "Client name" — Skylight just shows partner.name. No richer client model.

**Status in our dashboard:** ✅ `clients` table covers this and **already richer** (status, sector, notes, payment_terms…). The `clients` table should keep `external_id` to the Odoo partner; ignore everything else.

**Enhancement ideas:** in our clone, we can collapse partner+brand into one entity but keep `legal_name` vs `brand_name`. Add a contact-people sub-table since the partner currently has zero contact info.

---

### 3.3 Projects (`project.project`) — THE HEART

**Counts:** 74 active projects (1,918 tasks across them — avg 26/project; a few large ones like project 1813 have 33).

**Total fields on `project.project`:** **169** (Odoo bloat). The non-standard / Rwasem-relevant ones:

| Field | Type | Origin | Notes |
|---|---|---|---|
| `account_manager_id` | m2o `res.users` | `rwasem_project_category_enhancements` | The AM. PDF §6/§9. |
| `partner_account_manager_id` | m2o `res.users` | same | Always equal to `account_manager_id` in samples — appears redundant. |
| `social_specialist_id` | m2o `res.users` | same | PDF §9 tier 2. |
| `media_specialist_id` | m2o `res.users` | same | PDF §9 tier 2. |
| `seo_specialist_id` | m2o `res.users` | same | PDF §9 tier 2. |
| `user_id` | m2o `res.users` | core | "Project Manager". In samples this is always **اية خفاجي [309]** for the latest projects — i.e. one global PM. |
| `project_code` | char | core/extended | Auto-numbered (`PRJ-01815`). |
| `category_ids` | m2m `project.category` | aptuem | The list of services on this project. |
| `temp_task_ids` | o2m `project.temp.task` | aptuem | The wizard's draft tasks (currently 0 records). |
| `target` | selection | rwasem | `[on_target, off_target, out, sales_deposit, renewed]`. All 10 sampled projects = `off_target`. |
| `store_name` | char | rwasem | The brand name printed on the Project Box. |
| `partner_store_name` | char | rwasem | Mirror of above. |
| `site_address`, `site_address_display`, `site_latitude`, `site_longitude` | text/float | rwasem | Physical address + map. Unused in samples. |
| `task_count` / `open_task_count` / `closed_task_count` | integer | core | Computed. |
| `last_update_status` | selection | core | `[on_track, at_risk, off_track, on_hold, to_define, done]`. **All sampled = `to_define`**. The PDF "HOLD overlay" maps to `on_hold` here but is unused in data. |
| `tag_ids` | m2m `project.tags` | core | Few records use it. |
| `type_ids` | m2m `project.task.type` | core | The 8 stages. **Identical on every active project** = `[232, 2509, 2379, 3598, 2380, 2381, 2382, 2510]`. |
| `date_start`, `date` | date | core | **All sampled = `false`**. Skylight does not fill contract dates on the project (they live on tasks). |
| `description` | html | core | Generally empty. |
| `is_favorite`, `favorite_user_ids` | boolean / m2m | core | Used. |
| `ks_*` (~20 fields) | various | ks_gantt_view_project | Gantt chart UI prefs; not domain data. |

**Sample (latest 4 projects):**
```json
{"id":1815,"name":"ARTDECO -نوفا 3 شهور","project_code":"PRJ-01815","partner_id":[1917,"مها"],"user_id":[309,"اية خفاجي"],"account_manager_id":[767,"بسملة محمد"],"social_specialist_id":false,"media_specialist_id":false,"seo_specialist_id":false,"category_ids":[64],"target":"off_target","store_name":"ARTDECO","date_start":false,"date":false,"task_count":8,"last_update_status":"to_define"}
{"id":1813,"name":"مركزالتميز بلس - انشاء + نوفا شهر","project_code":"PRJ-01813","partner_id":[1915,"مركزالتميز بلس"],"user_id":[309,"اية خفاجي"],"account_manager_id":[763,"سلمي تامر"],"category_ids":[64,134,162,234],"target":"off_target","store_name":"مركزالتميز بلس","task_count":33,"last_update_status":"to_define"}
{"id":1812,"name":"LUMÉA Line - سيو و حملات شهر","project_code":"PRJ-01812","partner_id":[1914,"حياة وبثينة, حياة"],"user_id":[309,"اية خفاجي"],"account_manager_id":[766,"دينا الحسيني"],"media_specialist_id":[329,"هبة قباري"],"seo_specialist_id":[339,"اسراء اسامه"],"category_ids":[64,134,235],"target":"off_target","store_name":"LUMÉA Line","task_count":30}
{"id":1811,"name":"Cozy Baby باقه سوشيال ميديا شهر + تصوير منتجات","project_code":"PRJ-01811","partner_id":[1910,"Cozy Baby"],"account_manager_id":[1161,"محمد حسين"],"category_ids":[64,234],"task_count":21}
```

**`project.project.stage` model:** does not exist — there is no project-level kanban. Project status is via `last_update_status` (unused) and `target` (always `off_target`).

**PDF cross-ref:**
- §6 Project Box → `name`, `category_ids` (services), no `start/end` (empty), `task_count`, `account_manager_id`, `user_id` (PM), `target`/`last_update_status` (HOLD).
- §9 — the four role slots are present on the project header.

**Status in our dashboard:** ⚠ partial. Our `projects` table has `client_id`, `account_manager_employee_id`, `start_date`, `end_date`, `status`, `priority`. We **lack**: `media_specialist_id`, `seo_specialist_id`, `social_specialist_id` (per-project specialist slots), `services` (m2m to a service taxonomy), `store_name`/brand, `target` health flag, `project_code`.

**Enhancement ideas:** drop the duplicate `partner_account_manager_id`. Drop `project.tags` (unused) — services already cover taxonomy. Make `last_update_status` a real Status badge with `on_hold` → HOLD overlay (PDF §6).

---

### 3.4 Tasks (`project.task`) — THE HEART

**Total tasks:** 1,918 (`active=true` not enforced).

**Stage distribution (live):**
| Stage id | Name | Count |
|---|---|---|
| 232 | New | 581 |
| 2509 | In Progress | 74 |
| 2379 | Manager Review | 2 |
| 3598 | Specialist Review | 17 |
| 2380 | Ready to Send | 7 |
| 2381 | Sent to Client | 30 |
| 2382 | Client Changes | 52 |
| 2510 | Done | 1,137 |

The "New" backlog is huge (581) — Skylight creates tasks aggressively from templates and then completes them. ~59% of tasks are Done.

**Total fields on `project.task`:** 174. The custom/Rwasem-relevant ones:

| Field | Type | Origin | Notes |
|---|---|---|---|
| `category_id` | m2o `project.category` | aptuem | The service the task belongs to (PDF §7 card "Service / Category"). |
| `stage_id` | m2o `project.task.type` | core | Always one of the 8 stages. |
| `state` | selection | core | `[01_in_progress, 02_changes_requested, 03_approved, 1_done, 1_canceled, …]` — separate from stage. |
| `current_stage_duration` | char | eg_task_stage_duration | Human "5h 15m" — the **PDF §5 Duration**. |
| `duration_days` | integer | eg_task_stage_duration | Total task age in days. |
| `delay_days` | integer | eg_task_stage_duration | **PDF §8.1 "Delay (Days)"** — how many past-deadline. |
| `actual_done_date` | datetime | eg_task_stage_duration | Set when stage→Done. |
| `working_days_open` / `working_days_close` | float | eg_task_stage_duration | Refined business-day metrics. |
| `stage_time_ids` | o2m `task.stage.time` | eg_task_stage_duration | Per-stage timeline rows (33,837 total). **PDF §8.3 Task Stage History tab.** |
| `duration_tracking` | json | core | Cumulative seconds per stage. |
| `date_deadline` | datetime | core | **PDF §5 Deadline / Planned Date.** |
| `date_assign`, `date_end`, `date_start` | date(time) | core | Lifecycle dates. |
| `user_ids` | m2m `res.users` | core | The "Assignees" (PDF §8.1 "Specialist, Manager, Agent" — but flat, no role distinction). |
| `progress_percentage` | float | rwasem_project_task_progress | Manual or computed. |
| `expected_progress` | float | rwasem_project_task_progress | Time-based expectation. |
| `progress_slip` | float | rwasem_project_task_progress | Slip vs expected. |
| `progress_display` | html | rwasem_project_task_progress | Rendered bar. |
| `priority` | selection | core | `[0=Low, 1=High]`. All sampled = `0`. |
| `tag_ids` | m2m `project.tags` | core | Mostly empty. |
| `approval_status` / `approval_steps` / `approval_history_ids` / `next_approver_*` | selection / etc | project_customization | An approval-workflow plug. **All sampled = `not_required`.** Effectively unused. |
| `workflow_type` / `user_workflow_id` / `group_workflow_id` | various | workflow_core_rr | 0 records, dead. |
| `milestone_id` / `is_overdue` / `recurring_task` / `repeat_*` | core | core | Generally unused. |
| `parent_id`, `child_ids`, `subtask_*`, `depend_on_ids`, `dependent_ids`, `dependent_tasks_count` | m2o/m2m | core | Rare in current data; design supports it. |
| `display_in_project` | boolean | core | Used to hide subtasks. |
| `description` | html | core | Sometimes filled; the brief usually goes into chatter (Log Note). |
| `attachment_ids`, `displayed_image_id`, `document_count` | o2m / m2o / int | core | 6,341 attachments overall. |
| `email_cc`, `email_sent` | char/bool | core | Email integration. |
| `ks_*` (~20) | various | ks_gantt_view_project | Gantt UI. |
| `personal_stage_*` | core | Private personal stage — generic Odoo. |

**Sample tasks (project 1813, 33 tasks):**
```json
{"id":16505,"name":"البريف","stage_id":[2510,"Done"],"category_id":[64,"⚪Account Manager"],"date_deadline":"2026-04-30","date_assign":"2026-04-29","actual_done_date":"2026-04-30 08:41:24","delay_days":0,"duration_days":1,"current_stage_duration":"5h 18m","working_days_close":0.007,"user_ids":[309,323,763],"state":"1_done"}
{"id":16548,"name":"سوشيال ميديا بلان + أكشن بلان","stage_id":[232,"New"],"category_id":[234,"🔵Social Media"],"date_deadline":"2026-05-06","date_assign":"2026-04-30","delay_days":0,"duration_days":6,"current_stage_duration":"5h 15m","working_days_close":3.658,"user_ids":[1190,409,394],"state":"01_in_progress"}
{"id":16530,"name":"تحليل المتجر والحسابات الإعلانية + الميديا بلان","stage_id":[232,"New"],"category_id":[134,"🟢Media Buying"],"date_deadline":"2026-05-10","duration_days":10,"user_ids":[307,325,364]}
```

Observation: **`user_ids` typically has 3 entries** for non-AM tasks, e.g. `[1190, 409, 394]` — almost certainly Specialist + Manager + Agent **but not differentiated**. PDF §8.1 demands they be distinguishable. In Odoo today the only way to know "who is the Agent" is convention. **This is a major clone improvement**: split `user_ids` into typed slots `specialist_user_id`, `manager_user_id`, `agent_user_id`.

**Stage transitions (`task.stage.time`):** 33,837 records — `stage_in_date`, `stage_out_date`, `total_duration_seconds`, `stage_in_dates` (multi-line audit). **This is the source of truth for Stage History.**

**Mail messages on tasks:** 78,154 (avg 41/task). Comment vs notification mix in the latest:
```
[349191] 2026-04-30 20:29:32 type=comment        subtype=Note
[349190] 2026-04-30 20:29:26 type=notification   subtype=Stage Changed
[349188] 2026-04-30 20:29:11 type=comment        subtype=Note
[349187] 2026-04-30 20:29:00 type=notification   subtype=Stage Changed
```

**Attachments on tasks:** 6,341 `ir.attachment` rows. Confirms PDF §8.4 "files / Drive links in Log Note".

**PDF cross-ref:** §3 (8 stages), §5 (Duration vs Deadline), §7 (kanban card: name/duration/category), §8 (header: assignees/deadline/delay; tabs: Stage History; Log Note with @mentions/attachments).

**Status in our dashboard:** ⚠ partial.
- ✅ have: `stage`, `planned_date`, `progress_*`, `category`, comments, audit_log, STAGE_EXIT_ROLE.
- ❌ missing: separate `specialist_user_id`/`manager_user_id`/`agent_user_id` slots; `task.stage.time` equivalent (we have `audit_log` but no per-stage cumulative duration); a true `current_stage_duration` computed on read; `delay_days` computed; a Stage History tab; attachment storage on Log Note (PDF says yes, we have not wired).

**Enhancement ideas:** drop unused: `priority`, `milestone_id`, all `ks_*`, `approval_*`, `workflow_*`, `recurring_task`, `personal_stage_*`. Keep computed `delay_days`, `current_stage_duration`. Compute them via SQL view from `task_stage_history` rather than denormalize.

---

### 3.5 Task templates (auto-generation, PDF Stage 0)

**Mechanism:** `project.category` (the service) has `task_ids` → `project.category.task` rows. When AM creates a project and picks services, the `aptuem_project_default_task` addon spawns one task per template, copying `name`, `priority`, `description`, `user_ids`, `stage_id` (always `New` = 232), `task_duration` (in days, used to set `date_deadline = today + duration`), `sequence`, `tag_ids`, and the task-code/dependency/workflow fields.

**Counts:**
- 14 `project.category` total (13 active + 1 test).
- 279 `project.category.task` template rows.
- Templates per active category:
  - 64 ⚪ Account Manager: **8 templates**
  - 134 🟢 Media Buying: **7**
  - 234 🔵 Social Media: **13**
  - 235 🟠 SEO: **15**
  - 162 🟤 Wordpress Wibsite: **5**
  - 161 🟤 Salla / Zid Store: **6**
  - 265 🟤 Store Enhancement: **5**
  - 145 ⚫ Company Profile: **4**
  - 157 ⚫ Landing page: **4**
  - 71 🟠 Renewal SEO: **11**
  - 158 🔵 Renewal Social Media: **11**
  - 68 ⚪ Renewal of Acc Manager: **2**
  - 69 🟢 Renewal Media Buying: **2**

**`project.category.task` schema:**
```
name (char), priority (selection), description (text),
user_ids (m2m res.users), project_categ_id (m2o project.category),
stage_id (m2o project.task.type), task_duration (int, days),
sequence (int), tag_ids (m2m), task_code (char),
target_task_id (m2o), depends_on_code (char), dependency_type (selection),
lag_days (int), dependency_ids/dependent_task_ids (m2m),
workflow_id, workflow_type, group_workflow_id, user_workflow_id,
requires_approval (bool), first_approver_group_id (m2o res.groups)
```

**Sample (Account Manager service):** `إنشاء القروب + رسالة وفيديو الترحيب بالعميل` (duration 0), `البريف` (1), `تسجيل اجتماع البريف` (1), `رسالة (السايكل + اسماء الموظفين)` (1), `أخذ الأكسس من العميل` (2), `ملخص اجتماع العصف الذهني` (2), `اعتماد العميل لملف أنماط التصاميم` (2), `قبول العميل للتجديد + ارسال عقد التجديد` (27).

**Sample (Social Media):** `محتوي الاسبوع الاول للسوشيال` (8d), `تصاميم الاسبوع الاول للسوشيال` (11d), `محتوى الاسبوع التاني للسوشيال` (9d), `تصاميم الاسبوع التاني للسوشيال` (13d), `جدولة الاسبوع التاني للسوشيال` (13d), `محتوى الاسبوع الثالث للسوشيال` (10d), `تصاميم الاسبوع الثالث للسوشيال` (15d), …

These offsets **do not perfectly match PDF §11 upload-deadline rules** (PDF specifies "Deadline − N", but Odoo stores absolute "Deadline = start + N"). The math is inverse but consistent — start-relative.

**PDF cross-ref:** §3 Stage 0 ("All tasks are auto-generated according to selected services. Deadline auto-set per task."). §11 upload-deadline offsets — **partially encoded** here as task durations.

**Status in our dashboard:** ⚠ we have `task_templates` with offsets seeded by migration `0013` for upload-deadlines, but **the full per-service template list (279 rows) is not migrated**. This is the biggest "import once" payload of the audit.

**Enhancement ideas:**
- Mirror `project.category.task` 1:1 as `service_task_templates` with `service_id`, `name_ar`, `name_en`, `default_offset_days`, `default_stage`, `sequence`, `default_assignee_role` ('account_manager'|'specialist'|'manager'|'agent'), `dependencies` (jsonb array of template IDs).
- Drive both Stage-0 generation **and** the upload-deadline derivation from the same table.
- Add an admin UI to edit templates (Odoo's UX is buried; Skylight will love a clean editor).

---

### 3.6 Document management

**Models:** `document.directory` (sh_document_management) — **0 records**. `document.tags` — 0. `directory.tags` — 0. `dms.document` — does not exist.

**Reality:** All file storage is **plain `ir.attachment`** linked to `project.task` (6,341) or `project.project` (328). The `rwasem_document_management_project*` and `sh_document_management` modules add UI affordances but no data.

**PDF cross-ref:** §8.4 — Log Note attachments. Matches. Skylight has not adopted a separate document tree.

**Status in our dashboard:** ❌ missing. Comments lack file attachments. Add Supabase Storage bucket `task_attachments/` and a `comment_attachments` table linking `comments` → `storage_object_id`. Mirror Odoo's behavior: any file dropped in chatter is stored on the parent task.

---

### 3.7 WhatsApp / messaging

**Models touched:**
- `tus_meta_*` modules — **not installed**.
- `whatsapp_*` modules — not installed.
- `discuss.channel`: 1,967 rows — but **1,965 are `chat` type** (1:1 DMs between staff). Only 1 `group` channel ("متجر زيوت طبيعية", 4 partners) and 1 `channel` row total. **No "Client Group / Internal Group" pattern exists in Odoo data.**

**PDF cross-ref:** §10 — WhatsApp Client Group + Internal Group with naming conventions. **Not implemented in Odoo at all.**

**Status in our dashboard:** ❌ missing. PDF §10 is greenfield for both us and Odoo.

**Enhancement idea:** when an AM is assigned to a project, automatically (a) create a WhatsApp Client Group via Meta WhatsApp Business API with name `إدارة نشاط | {client_name}`, (b) create an Internal Group `📍 {client_name}`, (c) store both `wa_group_id`s on the project, (d) post a daily summary of overdue tasks into the Internal Group, (e) provide a one-click "send to client" action that reposts a task's Log Note into the Client Group when stage → `Sent to Client`.

---

### 3.8 Other live data

| Model | Count | Status |
|---|---|---|
| `crm.lead` | 14 | nominal — not the sales mechanism |
| `sale.order` | 3 | not used |
| `account.move` | 0 | accounting unused |
| `mail.template` | 41 | many unused; some wire stage-change emails |
| `discuss.channel` (chat) | ~1,965 | Odoo's internal DM is heavily used — this is the day-to-day staff messaging |
| `mail.message` (overall) | well > 78k | active |
| `task.stage.time` | 33,837 | core dataset for our Stage History clone |
| `ks.dashboard.ninja.board` | (existence unknown) | Ksolves dashboards — UI-only |

---

## 4. Schema mapping (Odoo concept → Supabase)

| Odoo | Our Supabase (existing or proposed) | Notes |
|---|---|---|
| `res.partner` (customer) | `clients` (✅ exists, has `external_id`) | Skylight uses bare names; rich client data is greenfield. |
| `res.users` (internal) | `employee_profiles` + `auth.users` (✅ exists) | Map login → email; map `manager-group`/`member-group` → `employee_profiles.role`. |
| `hr.department` | `departments` (✅ exists) | Odoo has 1 stub row → ignore; seed our own 5-tier structure from PDF §9. |
| `project.project` | `projects` (✅ partial) | Add `project_code`, `store_name`, `account_manager_employee_id` (already), `social_specialist_employee_id`, `media_specialist_employee_id`, `seo_specialist_employee_id`, `services` (m2m), `health_status` (replacing `target` + `last_update_status`), `hold_reason`. |
| `project.category` | **NEW**: `services` table (id, name_ar, name_en, color, emoji, is_renewal bool, active) | 13 active services. |
| `project.category.task` | **NEW**: `service_task_templates` (id, service_id, sequence, name_ar, name_en, default_role, default_offset_days, depends_on_template_id, lag_days) | 279 rows to import. |
| `project.task.type` | **constant** in code (8 stages) (✅ already) | The 8 stage IDs are global. |
| `project.task` | `tasks` (✅ partial) | Add `service_id` (m2o `services`), `specialist_employee_id`, `manager_employee_id`, `agent_employee_id`, `delay_days` computed, `current_stage_duration` computed. Drop `priority`/`milestone`/`approval_*`. |
| `task.stage.time` | **NEW**: `task_stage_history` (id, task_id, stage, entered_at, exited_at, duration_seconds) | 33,837 rows; foundation of Stage History tab + Duration field. Replace audit_log entries that duplicate this. |
| `mail.message` (chatter on task) | `comments` (✅ exists) | Mirror with `kind ∈ {comment, system_stage_change, system_assignment}`. |
| `ir.attachment` (on task) | **NEW**: `comment_attachments` + Supabase Storage | 6,341 rows; bring as part of Log Note port. |
| `mail.followers` | **NEW** or merge into `task_assignees` | Use `task_assignees` typed by role. |
| `project.tags`, `project.task.tags` | drop | Empty in practice. |
| `discuss.channel` (chat) | drop | Replaced by Slack/Teams or ignored. |
| Approval workflow (`project.task.approval.history`, `workflow.user`, `workflow.group`) | drop | Always 0 rows. |

---

## 5. Build plan v2

Phasing reflects **what Skylight uses today**, ordered by record-count weight and PDF criticality. Replaces `docs/ODOO_REPLACEMENT_PLAN.md`.

### Phase A — Service taxonomy & template engine (highest leverage, currently missing)
1. New tables: `services` (13 rows seeded from `project.category`) + `service_task_templates` (279 rows imported from `project.category.task`).
2. New importer step in `src/lib/odoo/importer.ts` ahead of `importProjects` — pull both, idempotent on `external_id`.
3. UI: services admin page (CRUD), service-tasks editor.
4. Justification: 13 services × 279 templates power **every** future Stage-0 project generation. Without this, "auto-generate tasks per selected services" is a stub.

### Phase B — Project schema completion + Stage 0 wizard
1. Add to `projects`: `project_code`, `store_name`, `services[]` (jsonb of service_ids), `social_specialist_employee_id`, `media_specialist_employee_id`, `seo_specialist_employee_id`, `health_status` (+ `hold_reason`).
2. Backfill from Odoo via importer.
3. New "New Project" wizard: pick client → pick services → pick specialists per service → pick dates → button "Generate Tasks" (runs templates → tasks with `planned_date = start_date + default_offset_days`).
4. Justification: 74 projects × ~26 tasks each ≈ 1,918 tasks Skylight has today were all generated this way.

### Phase C — Per-stage time tracking (currently a known gap)
1. New table `task_stage_history` mirroring `task.stage.time`. Trigger on `tasks.stage` UPDATE → close the open row, open a new one.
2. Importer pulls 33,837 historical rows once.
3. Computed columns / SQL view: `current_stage_duration_seconds`, `delay_days`.
4. UI: Stage History tab on task detail (PDF §8.3); replace any custom timer code on the task page.
5. Justification: PDF §5 calls Duration "the operational health metric". Odoo has 33k rows of history — we lose all of it without this.

### Phase D — Typed assignees + role enforcement
1. Add to `tasks`: `specialist_employee_id`, `manager_employee_id`, `agent_employee_id` (in addition to the existing m2m `task_assignees`).
2. Backfill heuristic from Odoo: for each task, look at `user_ids` and infer roles from project header (project.account_manager_id → AM, project.social_specialist_id → specialist for category 234, etc).
3. Confirm `STAGE_EXIT_ROLE` blocks Agent stage moves during `client_changes` (PDF §3 Stage 8 hard rule).
4. Justification: Odoo conflates them in `user_ids` — the PDF demands they be separable.

### Phase E — Log Note attachments
1. Supabase Storage bucket `task-attachments`.
2. New table `comment_attachments` (id, comment_id, storage_path, filename, mime, size).
3. UI: drag-drop on the comment composer; render thumbnails; preview Drive links inline.
4. Importer pulls 6,341 `ir.attachment` rows linked to tasks.
5. Justification: PDF §8.4 says Log Note IS the system of record for files.

### Phase F — Quality Control role + dashboards
1. Role: add `quality_control` to `employee_profiles.role`.
2. Cross-cutting QC dashboard: % on-time per service, average `delay_days`, oldest-in-stage tasks.
3. RLS: QC reads everything but doesn't appear in stage exit guards.
4. Justification: PDF §9 explicitly carves QC out — currently zero presence.

### Phase G — WhatsApp Client/Internal Groups
1. Integrate Meta WhatsApp Business API (already partially scaffolded per `MEMORY.md` references).
2. On AM assignment to project: create both groups, persist `wa_client_group_id`, `wa_internal_group_id`.
3. Auto-name with PDF §10 conventions.
4. Wire stage transitions: `Sent to Client` → repost the latest Log Note text + attachments to the client group.
5. Justification: PDF §10–§12 frames WhatsApp as the third leg of the stool. Greenfield in Odoo.

### Phase H — Cleanup & polish
1. Drop `priority`, `milestone_id`, `approval_*`, `workflow_*`, `personal_stage_*`, `ks_*`-equivalents from our task model.
2. HOLD overlay UI on project tile (PDF §6).
3. Project Code (`PRJ-NNNNN`) printed everywhere.
4. Brand badge from `store_name` on tile.

---

## 6. Open questions for the client (Skylight)

1. **`target`/`last_update_status`** — every project has `target=off_target` and `last_update_status=to_define`. Are these fields actually used or have they been abandoned? If the latter, do you want a real Project Health flag in the new system?
2. **`partner_account_manager_id` vs `account_manager_id`** — both fields exist on every project and always hold the same user. Is one the "billing" and the other the "execution" AM, or is one obsolete?
3. **`hr.department`** is a stub (1 row). Should the modern dashboard introduce real departments (Account Management / Social Media / Media Buying / SEO / Design / Content Writing / Video Editing / Programming / QC) per PDF §9, and if so do you have an internal org chart we can seed from?
4. **`project.user_id` (Project Manager)** is **اية خفاجي [309]** on every recent project. Is she the global ops PM, or is it OK to drop the field and rely only on the AM?
5. **`res.partner` is bare** — almost no client carries email/phone/website/industry. Do you have a richer client list elsewhere (CRM in Excel, WhatsApp contacts) that we should import to populate the new Clients table?
6. **Brand `store_name`** vs partner name — confirm the rule "partner = legal entity, store_name = brand" so we can surface both correctly.
7. **Renewal categories** (Renewal of Acc Manager, Renewal SEO, Renewal Social Media, Renewal Media Buying) — when in the lifecycle do you switch a project from initial categories to renewal categories? Should the dashboard auto-create a "renewal project" at end-of-contract with these services pre-selected?
8. **Templates with `project_categ_id=false`** — many `project.category.task` rows have no category. Are these orphans, or templates shared across multiple categories? (Example: most Social Media templates we sampled had `project_categ_id=false`.)
9. **Approval workflow** (`approval_status`, `approval_steps`, `project.task.approval.history`) — installed but unused. Is approval something you wanted to enforce and never rolled out, or fully scrapped?
10. **Quality Control** — who currently plays this role outside the daily flow? Should QC users have read-only access to everything, or comment-only?
11. **WhatsApp** — confirm the Meta Business account that should own auto-generated groups, and which sender phone number to use.
12. **`ir.attachment` on tasks** (6,341 files) — do you want them migrated to Supabase Storage, or kept in Odoo for archival while the new dashboard starts fresh?

---

## 7. Appendix — raw probe outputs

<details><summary>Module install state (165 modules)</summary>

See section 2 above for the grouped table; full unfiltered list is reproducible with:
```ts
await odoo.searchRead("ir.module.module", [["state","=","installed"]],
  ["name","author","shortdesc"], { limit: 500, order: "name" });
```
</details>

<details><summary>Stage IDs across projects</summary>

```
Stage New(232), In Progress(2509), Manager Review(2379), Specialist Review(3598),
Ready to Send(2380), Sent to Client(2381), Client Changes(2382), Done(2510)
each on 73/73 active projects (project.project.type_ids).
```
</details>

<details><summary>Service/category list</summary>

```
[235] 🟠SEO          tasks=15 templates=15
[234] 🔵Social Media tasks=13 templates=13
[71]  🟠Renewal SEO  tasks=11 templates=11
[158] 🔵Renewal Social Media tasks=11 templates=11
[64]  ⚪Account Manager tasks=8 templates=8
[134] 🟢Media Buying tasks=7 templates=7
[161] 🟤Salla / Zid Store tasks=6 templates=6
[162] 🟤Wordpress Wibsite tasks=5 templates=5
[265] 🟤Store Enhancement tasks=5 templates=5
[145] ⚫Company Profile tasks=4 templates=4
[157] ⚫Landing page tasks=4 templates=4
[68]  ⚪Renewal of Acc Manager tasks=2 templates=2
[69]  🟢Renewal Media Buying tasks=2 templates=2
[303] تيست خدمة (test, 0 tasks)
```
</details>

<details><summary>Custom Rwasem-relevant fields on project/task</summary>

Project (`project.project`):
`account_manager_id, partner_account_manager_id, social_specialist_id, media_specialist_id, seo_specialist_id, project_code, store_name, partner_store_name, site_address(/_display/_latitude/_longitude), target, category_ids, temp_task_ids, last_update_status`

Task (`project.task`):
`category_id, current_stage_duration, duration_days, delay_days, actual_done_date, working_days_open, working_days_close, stage_time_ids, duration_tracking, progress_percentage, expected_progress, progress_slip, progress_display, approval_status, approval_steps, approval_history_ids, next_approver_id, next_approver_group_id, workflow_type, user_workflow_id, group_workflow_id`
</details>

<details><summary>Recent activity sample</summary>

```
LATEST_TASK_WRITE = 2026-05-01 12:29:24
LATEST_MAIL_MESSAGE_DATE = 2026-04-30 20:29:32
```
</details>
