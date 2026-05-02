# Odoo Replacement Roadmap — Skylight Operating System

> Goal: turn `mr-dashboard` from an MVP "operator + AI layer on top of Odoo" into the **single dashboard** Skylight runs the company on. Odoo stays only as a temporary data source until each domain is ported, then is decommissioned.

This plan is **feature-scoped, not data-scoped** — migration/sync of historical Odoo data is deferred (tracked separately under "Cutover").

---

## 1. Guiding principles

1. **One dashboard, one mental model.** Every Odoo screen Skylight uses today must have a more focused replacement here, not a 1:1 port.
2. **Arabic-first, RTL, mobile-responsive.** Inherit the existing design system — no module ships without skeleton/empty/error states.
3. **Permissions everywhere.** Reuse `roles + permissions + user_roles`; every new module ships with permission keys + sidebar gating.
4. **Audit + AI events on every mutation.** Same contract as the current MVP (`audit_log`, `ai_event`).
5. **Saudi compliance is a first-class requirement.** ZATCA Phase 2 e-invoicing, Hijri/Gregorian dual dates, GOSI, Iqama tracking, WPS payroll exports.
6. **Don't re-invent Odoo's worst parts.** Skip XML views, server actions, ir.rule cruft. Build modern flows.

---

## 2. What Skylight actually uses in Odoo today

Reduced from the 200+ addons in `skylight_addons-master/addons/17.0` to the customized + active surface (`rwasem_*`, `bi_hr_*`, `*_rr`, `ks_*`, `ksa_e_invoice`, `tus_meta_wa_*`, attendance, POS).

| Domain | Odoo modules in use | Status in mr-dashboard |
|---|---|---|
| **A. Projects & Tasks** | `rwasem_project_*`, `aptuem_project_default_task`, `eg_task_stage_duration`, `ks_gantt_view_project`, `rwasem_task_bulk_update`, `rwasem_document_management_project*` | Partial — clients/projects/tasks/templates exist; missing Gantt, bulk ops, stage-duration analytics, project documents |
| **B. CRM & Sales pipeline** | `crm_activity_extended`, `savy_quotation_template`, `sale_automatic_workflow` | Missing — only "handover" exists; no pipeline, quotes, opportunities |
| **C. Accounting & Invoicing** | `om_account_*`, `account_dynamic_reports`, `accounting_pdf_reports`, `ksa_e_invoice`, `rwasem_zatca`, `rwasem_accounting_enhancements`, `msl_payment_print` | Missing — `/finance` is a placeholder |
| **D. HR core** | `hr_contract_ost`, `iqama_management_rr`, `emp_onboarding_ost`, `employee_termination`, `employee_probation_period`, `hr_clearance`, `emp_custody`, `hr_notice_board`, `emp_performance` | Partial — `/hr` placeholder; `/organization` covers departments/employees only |
| **E. Attendance** | `hr_attendance_extend`, `attendance_ss`, `attn_miss`, `wk_zkteco_attendance_management`, `hr_zk_attendance`, `overtime_auto_rr` | Missing |
| **F. Leaves** | `hr_leave_rr`, `hr_leave_ss`, `leave_settle_rr` | Missing |
| **G. Payroll** | `bi_hr_payroll`, `bi_hr_payroll_account`, `bi_hr_payroll_salary_attachments`, `hr_payroll_rr`, `rwasem_simple_payroll`, `payroll_self_rr`, `employee_loan_management` | Missing |
| **H. Maintenance & Assets** | `rwasem_maintenance*`, `tk_asset_maintenance` | Missing |
| **I. Documents & Approvals** | `sh_document_management`, `rwasem_document_*`, `oi_action_file`, `request_management_ost` | Missing |
| **J. Dashboards & Reports** | `ks_dashboard_ninja`, `dashboard_ninja_customization`, `rwasem_customer_report`, `rwasem_error_report` | Partial — main dashboard + AI insights only |
| **K. WhatsApp / Comms** | `tus_meta_wa_*`, `odoo_whatsapp_chatbot`, `ai_whatsapp_chatbot`, `rwasem_livechat`, `rwasem_notifications_link` | Missing |
| **L. POS / Retail** *(only if Skylight runs a shop)* | `ivis_pos_*`, `rwasem_pos`, `pos_*` | TBD — confirm whether POS is in scope |

**Confirm with Skylight:** is L (POS) actually in scope, or only used by a sister business? If out, we delete a third of the work.

---

## 3. Phased roadmap

Each phase ends in a demo-able vertical. Phases run roughly in parallel where teams allow, but the **dependency order** is: A → C → D → E,F → G → I → J → K.

### Phase 10 — Project depth (extends current MVP) · 1 sprint
- Gantt view (timeline + dependencies) — replaces `ks_gantt_view_project`
- Task stage duration analytics — replaces `eg_task_stage_duration`
- Bulk task update (multi-select toolbar) — replaces `rwasem_task_bulk_update`
- Project documents tab w/ Supabase Storage — replaces `rwasem_document_management_project*`
- Default task templates per project category (already partly there)

### Phase 11 — CRM + Quotations · 1 sprint
- `/crm` pipeline (kanban by stage, lead → opportunity → handover)
- Activities (call/meeting/follow-up) on any record — replaces `crm_activity_extended`
- Quotation builder + PDF + e-sign link — replaces `savy_quotation_template`
- Sale order auto-workflow (confirmed → project + tasks) — replaces `sale_automatic_workflow`
- Hook: existing handover engine consumes a "won" opportunity instead of empty form

### Phase 12 — HR foundation · 1 sprint
- Employees: contracts, Iqama (expiry alerts), passport, GOSI #, onboarding checklist, probation, termination, clearance
- `/hr/contracts`, `/hr/iqama` (RTL date pickers w/ Hijri toggle)
- Notice board + announcements
- Custody (assets assigned to employee)
- Performance review templates (light KPI tracking)

### Phase 13 — Attendance · 1 sprint
- Web check-in/out (geofenced + selfie optional)
- ZKTeco device sync — port `wk_zkteco_attendance_management` as a small Bun ingester (UDP/HTTP) writing to `attendances` table
- Missing-attendance flagging + auto-overtime — replaces `attn_miss`, `overtime_auto_rr`
- Manager approval queue

### Phase 14 — Leaves · half sprint
- Leave types, balances, accrual rules
- Request → approval chain → calendar visibility
- Leave settlement on termination — replaces `leave_settle_rr`

### Phase 15 — Payroll · 2 sprints (heaviest)
- Salary structures (basic/housing/transport/other allowances per Saudi norms)
- Loans + salary attachments — replaces `employee_loan_management`, `bi_hr_payroll_salary_attachments`
- Monthly payslip generation, batch run, accounting journal entries
- **WPS bank file export** (mudad / SARIE format) — Saudi-mandatory
- Self-service portal: employee sees payslip — replaces `payroll_self_rr`

### Phase 16 — Accounting + ZATCA · 2 sprints
- Chart of accounts, journals, journal entries, reconciliation
- AR (invoices) / AP (vendor bills) / cash & bank
- Financial reports: P&L, balance sheet, trial balance, aged receivables — replaces `account_dynamic_reports`, `accounting_pdf_reports`
- **ZATCA Phase 2 e-invoicing** (XML + QR + signed integration with Fatoora) — port the cryptography from `ksa_e_invoice` / `rwasem_zatca`. **This is the highest technical risk in the whole plan** — needs a spike before committing scope.
- Budgets + analytic accounts (link to projects)

### Phase 17 — Maintenance & Assets · half sprint
- Asset register, depreciation schedules
- Maintenance requests, scheduled vs corrective, technician assignment
- Replaces `rwasem_maintenance*`, `tk_asset_maintenance`, `om_account_asset`

### Phase 18 — Documents & Approval workflows · 1 sprint
- Generic document store (folders, ACL, versioning) on Supabase Storage — replaces `sh_document_management`
- Approval engine: any record → multi-step approval chain w/ delegation
- Request management (employee requests: certificate, salary letter, equipment) — replaces `request_management_ost`

### Phase 19 — Reports & Custom dashboards · 1 sprint
- Report builder (pivot/chart/table over any allowed table) — replaces `ks_dashboard_ninja`
- Saved dashboards per role
- Scheduled email/WhatsApp delivery
- Customer report (statement of account) — replaces `rwasem_customer_report`

### Phase 20 — WhatsApp & Comms · 1 sprint
- WhatsApp Cloud API integration — replaces `tus_meta_wa_*` family
- Templated messages: invoice sent, payment received, task assigned, leave approved
- Inbound: customer replies routed to assigned account manager
- AI-assisted reply suggestions (already have Gemini wired)
- Optional: Livechat widget for marketing site

### Phase 21 — POS *(only if confirmed in scope)* · 2 sprints
- Sessions, cashiers, products/variants, payments, receipts
- Kitchen printer routing, restaurant notes
- ZATCA-compliant POS receipts
- Inventory link

### Phase 22 — Cutover & Odoo decommission
- Per-module cutover plan: import historical data → run parallel for 1 cycle → switch primary → archive Odoo module
- Build a bidirectional sync **only where parallel running is required** — otherwise one-shot import via the existing `src/lib/odoo/` pipeline
- Decommission Odoo module-by-module, not all at once

---

## 4. Cross-cutting workstreams (run continuously)

- **Saudi compliance pack**: Hijri calendar, Arabic numerals toggle, GOSI/Mudad/ZATCA validators, RTL PDF rendering (jsPDF + Tajawal subset)
- **Performance**: every list ≥1k rows uses cursor pagination + virtualization
- **Observability**: Supabase logs + Sentry; one weekly Supabase advisor sweep
- **Testing**: Playwright smoke per phase; permission/RLS attack suite grows each phase
- **Design system**: each new module contributes ≥1 reusable primitive back to `/dev/design-system`

---

## 5. Risks & open questions

1. **ZATCA Phase 2 cryptography** is non-trivial — schedule a 3-day spike before Phase 16.
2. **Payroll correctness** has legal exposure — needs accountant sign-off on every formula.
3. **ZKTeco device protocol** — confirm device models on-site; some need an on-prem agent we can't run from Vercel.
4. **POS scope** — confirm in/out before estimating Phase 21.
5. **Data migration depth** — agree per module: full history vs last-fiscal-year vs balances-only.
6. **Concurrent Odoo writes during cutover** — decide sync direction per module to avoid split-brain.
7. **Team capacity** — this is roughly **6–9 months of focused work for a 2–3 engineer team**. Phasing assumes that. Adjust if smaller.

---

## 6. Immediate next steps (this week)

1. Walk this plan with Skylight ops lead — confirm/cut scope (esp. POS, payroll depth, WhatsApp).
2. Spike ZATCA Phase 2 signing locally — go/no-go before promising Phase 16 dates.
3. Pick **Phase 10 (Project depth)** as the next concrete sprint — lowest risk, extends what users already touch, proves the pattern.
4. Stand up `mr_dashboard_sync` Odoo addon scaffold so writeback exists when Phase 11 needs it.
