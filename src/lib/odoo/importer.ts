// One-shot Odoo → Supabase importer.
//
// Order matters: employees → clients (partners) → projects → tasks.
// Every upsert is keyed on (organization_id, external_source='odoo', external_id),
// so re-running is safe.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { OdooClient } from "./client";
import { fetchOdooUsersWithAvatars, odooAvatarDataUrl } from "./avatars";
import { syncStageHistory } from "./syncs/stage-history";
import {
  OdooMany2one,
  OdooPartner,
  OdooProject,
  OdooProjectCategory,
  OdooProjectTag,
  OdooTask,
  OdooTaskStage,
  mapStageName,
} from "./types";

const SOURCE = "odoo";
// Fallback client used when an Odoo project has no partner_id set.
// projects.client_id is NOT NULL, so we need a placeholder to keep
// projects-without-partner from being silently dropped.
const UNASSIGNED_CLIENT_NAME = "عميل غير محدد";
const UNASSIGNED_CLIENT_EXTERNAL_ID = -1;

// "full"        — re-pull everything + run delete-reconciliation (Odoo is the
//                 source of truth). Used by the manual `sync:odoo` script and
//                 the nightly cron, which is the only place stale/deleted rows
//                 get reaped.
// "incremental" — pull only rows changed since the stored watermark, skip the
//                 reconciliation deletes (an incremental fetch never returns
//                 the unchanged rows, so reconciliation would wipe them).
export type SyncMode = "full" | "incremental";

// Floor used the first time an incremental phase runs and no watermark exists
// yet — pulls the full history once to bootstrap.
const WATERMARK_FLOOR = "2000-01-01 00:00:00";
// Re-query window subtracted from the stored write_date watermark. Covers rows
// that were written during the previous run (after we read them) and clock
// skew. Safe because every write is an idempotent upsert.
const WATERMARK_OVERLAP_MINUTES = 10;

// Subtract `minutes` and return Odoo's UTC-naive format ("YYYY-MM-DD HH:MM:SS")
// for use in a domain filter. Accepts both Odoo-naive input (treated as UTC)
// and Postgres timestamptz ISO ("...T...+00:00") — the watermark column round-
// trips as the latter, the WATERMARK_FLOOR constant as the former.
function odooDateMinus(input: string, minutes: number): string {
  const trimmed = input.trim();
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(trimmed);
  const iso = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const d = new Date(hasTz ? iso : `${iso}Z`);
  d.setUTCMinutes(d.getUTCMinutes() - minutes);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function getWatermark(
  ctx: ImportContext,
  entityType: string,
): Promise<{ lastWriteDate: string | null; lastMessageId: number | null }> {
  const { data } = await supabaseAdmin
    .from("sync_watermarks")
    .select("last_write_date, last_message_id")
    .eq("organization_id", ctx.organizationId)
    .eq("entity_type", entityType)
    .maybeSingle();
  return {
    lastWriteDate: (data?.last_write_date as string | null) ?? null,
    lastMessageId:
      data?.last_message_id != null ? Number(data.last_message_id) : null,
  };
}

async function saveWatermark(
  ctx: ImportContext,
  entityType: string,
  patch: { lastWriteDate?: string | null; lastMessageId?: number | null },
): Promise<void> {
  const row: Record<string, unknown> = {
    organization_id: ctx.organizationId,
    entity_type: entityType,
    updated_at: new Date().toISOString(),
  };
  if (patch.lastWriteDate !== undefined) row.last_write_date = patch.lastWriteDate;
  if (patch.lastMessageId !== undefined) row.last_message_id = patch.lastMessageId;
  const { error } = await supabaseAdmin
    .from("sync_watermarks")
    .upsert(row, { onConflict: "organization_id,entity_type" });
  if (error) console.warn(`[odoo-import] save watermark ${entityType}: ${error.message}`);
}

export interface ImportContext {
  organizationId: string;
  odoo: OdooClient;
  /** "full" re-pulls everything + reconciles deletes; "incremental" pulls deltas only. */
  mode: SyncMode;
  /** Cache of Odoo id → Supabase uuid, populated as we go. */
  employeeIdMap: Map<number, string>;
  clientIdMap: Map<number, string>;
  projectIdMap: Map<number, string>;
  serviceIdMap: Map<number, string>;
  tagIdMap: Map<number, string>;
  /** Maps Odoo hr.department.id → Supabase departments.id. */
  departmentIdMap: Map<number, string>;
  stageNameById: Map<number, string>;
  unassignedClientId: string | null;
  /** Maps Odoo res.users.id → Supabase employee_profiles.id via hr.employee.user_id. */
  odooUserToEmployee: Map<number, string>;
  /** Counter for inserted task_assignee rows (default-slot 'agent'). */
  assigneeCount: number;
}

export interface ImportSummary {
  employees: number;
  clients: number;
  projects: number;
  tasks: number;
  taskAssignees: number;
  services: number;
  tags: number;
  tagAssignments: number;
  taskComments: number;
  projectComments: number;
  departments: number;
  /** Number of employee_profiles rows whose dept/position/manager was filled in from hr.employee. */
  employeesHydrated: number;
  errors: string[];
}

async function resolveOrganizationId(slug: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();
  if (error || !data) throw new Error(`organization "${slug}" not found`);
  return data.id;
}

function nullable<T>(v: T | false | undefined): T | null {
  return v === false || v === undefined ? null : v;
}

function normalizeEmployeeName(name: string | null | undefined): string | null {
  const value = name?.trim().replace(/\s+/g, " ");
  return value ? value : null;
}

async function importEmployees(ctx: ImportContext): Promise<number> {
  // Sky Light's Odoo has very few hr.employee rows but 112 res.users.
  // Tasks reference users by res.users.id in their user_ids M2M, so we MUST
  // import from res.users (not hr.employee) to resolve task assignees.
  // share=false excludes portal/customer accounts.
  const users = await fetchOdooUsersWithAvatars(ctx.odoo);

  // Pull partner phone/mobile in one batch so we can hydrate emp.phone.
  // OdooMany2one is `[id, name] | false`, so guard before indexing.
  const partnerIds = users
    .map((u) => (Array.isArray(u.partner_id) ? u.partner_id[0] : null))
    .filter((x): x is number => typeof x === "number");
  type OdooUserPartner = { id: number; phone: string | false; mobile: string | false; function: string | false };
  const partners = partnerIds.length
    ? await ctx.odoo.searchRead<OdooUserPartner>(
        "res.partner",
        [["id", "in", partnerIds]],
        ["id", "phone", "mobile", "function"],
        { limit: 1000 },
      )
    : [];
  const partnerMap = new Map(partners.map((p) => [p.id, p]));

  // Build avatar URL from the Odoo instance host. The /web/image/ route is
  // public for users (no auth needed) so the dashboard can <img> it directly.
  const odooBase = process.env.ODOO_URL?.replace(/\/+$/, "") ?? "";
  // Dashboard is the source of truth for employee data (name, email, phone,
  // job_title, org-chart). Odoo seeds NEW hires but must never overwrite an
  // existing row's editable fields — Skylight edits in the dashboard and a
  // blind upsert would wipe their changes on every sync. We still refresh
  // avatar_url since nobody edits that in the dashboard.
  for (const u of users) {
    const partner = u.partner_id ? partnerMap.get(u.partner_id[0]) : undefined;
    const avatarUrl =
      odooAvatarDataUrl(u) ??
      (odooBase ? `${odooBase}/web/image/res.users/${u.id}/avatar_1` : null);

    const { data: existing } = await supabaseAdmin
      .from("employee_profiles")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("external_source", SOURCE)
      .eq("external_id", u.id)
      .maybeSingle();

    let profileId: string;
    if (existing) {
      // Existing row: refresh only fields the dashboard doesn't own.
      profileId = existing.id as string;
      if (avatarUrl) {
        await supabaseAdmin
          .from("employee_profiles")
          .update({ avatar_url: avatarUrl })
          .eq("id", profileId);
      }
    } else {
      // New hire: seed the row from Odoo.
      const row = {
        organization_id: ctx.organizationId,
        external_source: SOURCE,
        external_id: u.id,
        full_name: u.name,
        email: nullable(u.login),
        phone: nullable(partner?.phone) ?? nullable(partner?.mobile),
        job_title: nullable(partner?.function),
        avatar_url: avatarUrl,
        employment_status: "active",
      };
      const { data, error } = await supabaseAdmin
        .from("employee_profiles")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(`user ${u.id} (${u.name}): ${error.message}`);
      profileId = data.id as string;
    }

    ctx.employeeIdMap.set(u.id, profileId);
    // res.users.id is the same id used in task.user_ids — direct mapping.
    ctx.odooUserToEmployee.set(u.id, profileId);
  }

  return users.length;
}

// Pull hr.department → public.departments. Keyed on (org, source, ext_id) so
// re-runs upsert in place. parent_department_id is wired in a second pass once
// every row has its uuid.
async function importDepartments(ctx: ImportContext): Promise<number> {
  type OdooDepartment = {
    id: number;
    name: string;
    parent_id: OdooMany2one;
    manager_id: OdooMany2one;
    active: boolean;
  };
  console.log("[odoo-import] fetching hr.department…");
  const rows = await ctx.odoo.searchRead<OdooDepartment>(
    "hr.department",
    [["active", "=", true]],
    ["id", "name", "parent_id", "manager_id", "active"],
    { limit: 500 },
  );
  console.log(`[odoo-import] hr.department → ${rows.length} rows`);

  // Pass 1: upsert each department; kind defaults to 'other' since Odoo's
  // hr.department has no equivalent semantic kind we can map 1:1.
  for (const d of rows) {
    const slug = `odoo-dept-${d.id}`;
    const { data, error } = await supabaseAdmin
      .from("departments")
      .upsert(
        {
          organization_id: ctx.organizationId,
          external_source: SOURCE,
          external_id: String(d.id),
          name: d.name,
          slug,
          kind: "other",
        },
        { onConflict: "organization_id,external_source,external_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(`department ${d.id} (${d.name}): ${error.message}`);
    ctx.departmentIdMap.set(d.id, data.id);
  }

  // Pass 2: wire parent_department_id once every row's uuid is known.
  // Seed-only: dashboard's /organization/chart owns the dept hierarchy, so we
  // only set the parent on rows where it hasn't already been chosen locally.
  for (const d of rows) {
    const parentOdooId = d.parent_id ? d.parent_id[0] : null;
    if (!parentOdooId) continue;
    const childId = ctx.departmentIdMap.get(d.id);
    const parentId = ctx.departmentIdMap.get(parentOdooId);
    if (!childId || !parentId) continue;
    await supabaseAdmin
      .from("departments")
      .update({ parent_department_id: parentId })
      .eq("id", childId)
      .is("parent_department_id", null);
  }

  // Pass 3: head_employee_id, resolved via hr.employee.user_id → employee_profiles.
  // Skipped here — we set it inside importEmployeeHR once odooUserToEmployee
  // covers the manager_id user.
  return rows.length;
}

// Walk hr.employee → backfill department_id + position (from hr.job) +
// manager_employee_id on existing employee_profiles. The earlier importer
// keys employee_profiles by res.users.id, so we join hr.employee.user_id
// onto that map. Employees without a user_id (rare in Sky Light's Odoo)
// are skipped — there's no record on our side to update.
async function importEmployeeHR(ctx: ImportContext): Promise<number> {
  type OdooHrEmployee = {
    id: number;
    name: string;
    user_id: OdooMany2one;
    department_id: OdooMany2one;
    job_id: OdooMany2one;
    parent_id: OdooMany2one; // direct manager (hr.employee)
    work_phone: string | false;
    work_email: string | false;
    active: boolean;
  };
  console.log("[odoo-import] fetching hr.employee…");
  const employees = await ctx.odoo.searchRead<OdooHrEmployee>(
    "hr.employee",
    [["active", "=", true]],
    [
      "id", "name", "user_id", "department_id", "job_id", "parent_id",
      "work_phone", "work_email", "active",
    ],
    { limit: 1000 },
  );
  console.log(`[odoo-import] hr.employee → ${employees.length} rows`);

  // Pull hr.job for canonical position names. job_id many2one only carries
  // [id, name], but Odoo sometimes appends "(Department)" to the name —
  // hr.job.name is the clean string we want for `position`.
  const jobIds = employees
    .map((e) => (Array.isArray(e.job_id) ? e.job_id[0] : null))
    .filter((x): x is number => typeof x === "number");
  type OdooJob = { id: number; name: string };
  const jobs = jobIds.length
    ? await ctx.odoo.searchRead<OdooJob>(
        "hr.job",
        [["id", "in", Array.from(new Set(jobIds))]],
        ["id", "name"],
        { limit: 500 },
      )
    : [];
  const jobNameById = new Map(jobs.map((j) => [j.id, j.name]));

  const { data: existingProfiles } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name")
    .eq("organization_id", ctx.organizationId)
    .eq("external_source", SOURCE);
  const profileIdsByName = new Map<string, string[]>();
  for (const profile of existingProfiles ?? []) {
    const normalized = normalizeEmployeeName(profile.full_name as string | null);
    if (!normalized) continue;
    const arr = profileIdsByName.get(normalized) ?? [];
    arr.push(profile.id as string);
    profileIdsByName.set(normalized, arr);
  }

  // First pass: backfill department_id + position on each employee_profile
  // matched via res.users.id. Build a map of Odoo hr.employee.id → Supabase
  // employee_profiles.id so we can stitch manager_employee_id in pass 2.
  const hrIdToEmpProfile = new Map<number, string>();
  let updated = 0;
  for (const e of employees) {
    const userOdooId = e.user_id ? e.user_id[0] : null;
    let empProfileId = userOdooId ? (ctx.odooUserToEmployee.get(userOdooId) ?? null) : null;
    if (!empProfileId) {
      const normalizedName = normalizeEmployeeName(e.name);
      if (normalizedName) {
        const matches = profileIdsByName.get(normalizedName) ?? [];
        if (matches.length === 1) {
          empProfileId = matches[0];
        }
      }
    }
    if (!empProfileId) continue;

    hrIdToEmpProfile.set(e.id, empProfileId);

    const deptOdooId = e.department_id ? e.department_id[0] : null;
    const deptId = deptOdooId ? (ctx.departmentIdMap.get(deptOdooId) ?? null) : null;
    const jobId = e.job_id ? e.job_id[0] : null;
    const jobName = jobId
      ? (jobNameById.get(jobId) ?? (e.job_id ? e.job_id[1] : null))
      : null;

    // `employee_profiles.position` is an enum-style text column gated by a
    // CHECK constraint ('head'|'team_lead'|'specialist'|'agent'|'admin') — it
    // tracks the role tier the dashboard uses for stage-owner gating. The
    // free-text job title from hr.job lands in `job_title`; mapping a string
    // like "Social Media Specialist" into the tier enum would need rules the
    // team hasn't defined yet, so leave `position` alone.
    //
    // Dashboard is the source of truth for all editable employee fields
    // (phone, job_title, department, manager, etc.). Odoo seeds these only
    // when the local row is still null — once a value exists in the dashboard,
    // Odoo never overwrites it. Skylight edits in the dashboard; a blind
    // refresh here would wipe their work on every sync.
    if (e.work_phone) {
      await supabaseAdmin
        .from("employee_profiles")
        .update({ phone: e.work_phone })
        .eq("id", empProfileId)
        .is("phone", null);
    }
    if (jobName && jobName.length > 0) {
      await supabaseAdmin
        .from("employee_profiles")
        .update({ job_title: jobName })
        .eq("id", empProfileId)
        .is("job_title", null);
    }

    // Seed department_id only if dashboard hasn't set one.
    if (deptId) {
      await supabaseAdmin
        .from("employee_profiles")
        .update({ department_id: deptId })
        .eq("id", empProfileId)
        .is("department_id", null);
    }

    updated += 1;
  }

  // Pass 2: stitch manager_employee_id once every hr.employee → emp_profile
  // mapping is in hand. Seed-only: dashboard's /organization/employees is the
  // source of truth, so Odoo never overwrites an already-set manager.
  for (const e of employees) {
    const empProfileId = hrIdToEmpProfile.get(e.id);
    if (!empProfileId) continue;
    const managerOdooId = e.parent_id ? e.parent_id[0] : null;
    if (!managerOdooId) continue;
    const managerProfileId = hrIdToEmpProfile.get(managerOdooId);
    if (!managerProfileId) continue;
    await supabaseAdmin
      .from("employee_profiles")
      .update({ manager_employee_id: managerProfileId })
      .eq("id", empProfileId)
      .is("manager_employee_id", null);
  }

  // Pass 3: department heads — once we know every hr.employee → emp_profile,
  // backfill departments.head_employee_id from hr.department.manager_id.
  type OdooDepartmentManager = { id: number; manager_id: OdooMany2one };
  const depRows = await ctx.odoo.searchRead<OdooDepartmentManager>(
    "hr.department",
    [["active", "=", true]],
    ["id", "manager_id"],
    { limit: 500 },
  );
  for (const d of depRows) {
    if (!d.manager_id) continue;
    const deptId = ctx.departmentIdMap.get(d.id);
    if (!deptId) continue;
    // manager_id on hr.department points at an hr.employee — resolve via the
    // local hr.employee.id → empProfile map built in pass 1.
    const headProfileId = hrIdToEmpProfile.get(d.manager_id[0]);
    if (!headProfileId) continue;
    // Seed-only: dashboard's /organization/departments is the source of truth
    // for who heads a department; Odoo never overwrites an already-set head.
    await supabaseAdmin
      .from("departments")
      .update({ head_employee_id: headProfileId })
      .eq("id", deptId)
      .is("head_employee_id", null);
  }

  return updated;
}

async function ensureUnassignedClient(ctx: ImportContext): Promise<string> {
  if (ctx.unassignedClientId) return ctx.unassignedClientId;
  const { data, error } = await supabaseAdmin
    .from("clients")
    .upsert({
      organization_id: ctx.organizationId,
      external_source: SOURCE,
      external_id: UNASSIGNED_CLIENT_EXTERNAL_ID,
      name: UNASSIGNED_CLIENT_NAME,
      status: "active",
    }, { onConflict: "organization_id,external_source,external_id" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`unassigned client: ${error?.message}`);
  ctx.unassignedClientId = data.id;
  return data.id;
}

async function importServices(ctx: ImportContext): Promise<number> {
  // Sky Light's "service categories" live in Odoo's project.category model
  // (added by aptuem_project_default_task). Mirror them into services so
  // each task can carry a service_id colored chip on the kanban card.
  const cats = await ctx.odoo.searchRead<OdooProjectCategory>(
    "project.category",
    [["active", "=", true]],
    ["id", "name", "active", "color"],
    { limit: 200 },
  );

  for (const c of cats) {
    // Slug from name: strip emoji + non-alphanumerics, lowercase, dashes.
    // Always append -{odooId} so we never collide with an existing slug
    // (the seed already created social-media-management, seo, media-buying;
    // Odoo's 14 service categories include "🟢Media Buying" which would
    // map to the same slug). The id suffix guarantees uniqueness without
    // depending on a deduping pass.
    // Odoo returns `false` for empty strings, so coerce defensively before
    // calling string methods.
    const nameStr = typeof c.name === "string" ? c.name : "";
    const stripped = nameStr
      .replace(/[\p{Emoji}\p{Extended_Pictographic}]/gu, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const slug = `${stripped || "cat"}-${c.id}`;

    const row = {
      organization_id: ctx.organizationId,
      external_source: SOURCE,
      external_id: c.id,
      name: nameStr || `Category ${c.id}`,
      slug,
      is_active: true,
    };
    const { data, error } = await supabaseAdmin
      .from("services")
      .upsert(row, { onConflict: "organization_id,external_source,external_id" })
      .select("id")
      .single();
    if (error) throw new Error(`service ${c.id} (${c.name}): ${error.message}`);
    ctx.serviceIdMap.set(c.id, data.id);
  }

  return cats.length;
}

async function importClients(ctx: ImportContext): Promise<number> {
  // Two-step: only import partners that are actually referenced by a
  // project. Pulling all `customer_rank > 0` partners is too slow on the
  // Rwasem instance (>5k rows including individual contacts) and most
  // aren't customers we care about.
  console.log("[odoo-import] resolving project partners…");
  const projectStubs = await ctx.odoo.searchRead<{ id: number; partner_id: OdooMany2one }>(
    "project.project",
    [["active", "=", true]],
    ["id", "partner_id"],
    { limit: 1000 },
  );
  const partnerIds = Array.from(
    new Set(
      projectStubs
        .map((p) => (p.partner_id ? p.partner_id[0] : null))
        .filter((x): x is number => Boolean(x)),
    ),
  );
  console.log(
    `[odoo-import] ${projectStubs.length} projects → ${partnerIds.length} unique partners`,
  );
  if (partnerIds.length === 0) return 0;

  // Batch the partner read so a single RPC doesn't time out.
  const BATCH = 200;
  const partners: OdooPartner[] = [];
  for (let i = 0; i < partnerIds.length; i += BATCH) {
    const slice = partnerIds.slice(i, i + BATCH);
    const rows = await ctx.odoo.searchRead<OdooPartner>(
      "res.partner",
      [["id", "in", slice]],
      [
        "id", "name", "email", "phone", "mobile", "website", "comment",
        "street", "street2", "city",
      ],
      { limit: BATCH },
    );
    partners.push(...rows);
    console.log(
      `[odoo-import] partners batch ${Math.min(i + BATCH, partnerIds.length)}/${partnerIds.length}`,
    );
  }

  for (const p of partners) {
    const addressParts = [p.street, p.street2, p.city]
      .map((s) => (s === false || s === undefined ? null : s))
      .filter((s): s is string => Boolean(s));
    const row = {
      organization_id: ctx.organizationId,
      external_source: SOURCE,
      external_id: p.id,
      name: p.name,
      email: nullable(p.email),
      phone: nullable(p.phone) ?? nullable(p.mobile),
      company_website: nullable(p.website),
      notes: nullable(p.comment),
      address: addressParts.length > 0 ? addressParts.join(", ") : null,
      status: "active",
    };
    const { data, error } = await supabaseAdmin
      .from("clients")
      .upsert(row, {
        onConflict: "organization_id,external_source,external_id",
      })
      .select("id")
      .single();
    if (error) throw new Error(`partner ${p.id}: ${error.message}`);
    ctx.clientIdMap.set(p.id, data.id);
  }

  return partners.length;
}

const ALLOWED_TARGETS = new Set([
  "on_target",
  "off_target",
  "out",
  "sales_deposit",
  "renewed",
]);

// Odoo project.project fields pulled for both the bulk import and the
// single-project on-demand pull. One source of truth so they never diverge.
const PROJECT_FIELDS = [
  "id",
  "name",
  "active",
  "write_date",
  "sequence",
  "partner_id",
  "user_id",
  "date_start",
  "date",
  "description",
  "store_name",
  "account_manager_id",
  "social_specialist_id",
  "media_specialist_id",
  "seo_specialist_id",
  "target",
  "color",
  "is_favorite",
  "tag_ids",
  "category_ids",
  "favorite_user_ids",
  "last_update_status",
  "last_update_color",
  "site_address",
  "site_address_display",
  "site_latitude",
  "site_longitude",
  "financial_info",
  "total_progress",
  "document_count",
  "has_active_category",
  "ks_project_start",
  "ks_project_end",
  "task_count",
  "open_task_count",
  "closed_task_count",
  "privacy_visibility",
];

// Odoo project.task fields pulled for both the bulk import and the single-task
// on-demand pull. One source of truth so they never diverge.
const TASK_FIELDS = [
  "id",
  "name",
  "active",
  "write_date",
  "sequence",
  "project_id",
  "stage_id",
  "state",
  "user_ids",
  "date_deadline",
  "create_date",
  "date_end",
  "description",
  "priority",
  "progress_percentage",
  "expected_progress",
  "progress_slip",
  "category_id",
  "date_assign",
  "date_start",
  "duration_days",
  "current_stage_duration",
  "working_days_open",
  "working_days_close",
  "duration_tracking",
  "actual_done_date",
  "delay_days",
  "is_overdue",
  "design_count",
  "document_count",
  "email_cc",
  "tag_ids",
  "ks_mark_important",
];

// Map an Odoo project.project → Supabase `projects` row. Shared by the bulk
// importProjects loop and the single-project on-demand pull (syncOneProject)
// so the field mapping (status, dates, specialists, counters) never drifts.
// `clientUuid` is resolved by the caller (real partner or unassigned fallback).
function buildProjectRow(
  ctx: ImportContext,
  p: OdooProject,
  clientUuid: string,
): Record<string, unknown> {
  const projectManagerUuid =
    p.user_id && ctx.employeeIdMap.get(p.user_id[0])
      ? ctx.employeeIdMap.get(p.user_id[0])!
      : null;
  const accountManagerUuid =
    p.account_manager_id && ctx.employeeIdMap.get(p.account_manager_id[0])
      ? ctx.employeeIdMap.get(p.account_manager_id[0])!
      : null;
  const socialSpecialistUuid =
    p.social_specialist_id && ctx.employeeIdMap.get(p.social_specialist_id[0])
      ? ctx.employeeIdMap.get(p.social_specialist_id[0])!
      : null;
  const mediaSpecialistUuid =
    p.media_specialist_id && ctx.employeeIdMap.get(p.media_specialist_id[0])
      ? ctx.employeeIdMap.get(p.media_specialist_id[0])!
      : null;
  const seoSpecialistUuid =
    p.seo_specialist_id && ctx.employeeIdMap.get(p.seo_specialist_id[0])
      ? ctx.employeeIdMap.get(p.seo_specialist_id[0])!
      : null;
  const targetRaw = typeof p.target === "string" ? p.target : null;
  const target = targetRaw && ALLOWED_TARGETS.has(targetRaw) ? targetRaw : null;
  return {
    organization_id: ctx.organizationId,
    external_source: SOURCE,
    external_id: p.id,
    name: p.name,
    sequence: typeof p.sequence === "number" ? p.sequence : 10,
    client_id: clientUuid,
    project_manager_employee_id: projectManagerUuid,
    account_manager_employee_id: accountManagerUuid,
    social_specialist_id: socialSpecialistUuid,
    media_specialist_id: mediaSpecialistUuid,
    seo_specialist_id: seoSpecialistUuid,
    // Sky Light uses ks_project_start/end (Ksolves Gantt) as primary contract
    // dates; date_start/date are filled on only a few projects. Prefer ks_*.
    start_date:
      (typeof p.ks_project_start === "string" && p.ks_project_start
        ? p.ks_project_start.slice(0, 10)
        : null) ?? nullable(p.date_start),
    end_date:
      (typeof p.ks_project_end === "string" && p.ks_project_end
        ? p.ks_project_end.slice(0, 10)
        : null) ?? nullable(p.date),
    description: nullable(p.description),
    // Only Odoo's `active` flag drives archive status.
    status: p.active === false ? "archived" : "active",
    priority: "medium",
    store_name: nullable(p.store_name),
    target,
    color: typeof p.color === "number" ? p.color : 0,
    is_favorite: Boolean(p.is_favorite),
    last_update_status: nullable(p.last_update_status),
    last_update_color: typeof p.last_update_color === "number" ? p.last_update_color : null,
    site_address: nullable(p.site_address),
    site_address_display: nullable(p.site_address_display),
    site_latitude: typeof p.site_latitude === "number" ? p.site_latitude : null,
    site_longitude: typeof p.site_longitude === "number" ? p.site_longitude : null,
    financial_info: nullable(p.financial_info),
    total_progress: typeof p.total_progress === "number" ? p.total_progress : 0,
    document_count: typeof p.document_count === "number" ? p.document_count : 0,
    has_active_category: Boolean(p.has_active_category),
    // Mirror Odoo's "PRJ-" + lpad(odoo_id, 5, '0') code format.
    project_code: `PRJ-${String(p.id).padStart(5, "0")}`,
    odoo_task_count: typeof p.task_count === "number" ? p.task_count : null,
    odoo_open_task_count: typeof p.open_task_count === "number" ? p.open_task_count : null,
    odoo_closed_task_count: typeof p.closed_task_count === "number" ? p.closed_task_count : null,
  };
}

async function importProjects(ctx: ImportContext): Promise<number> {
  // Pull both active and archived projects so the chatter on completed
  // engagements remains accessible in the dashboard. Archived rows get
  // status='archived' on insert (see below); the existing reconciliation
  // pass at the bottom of this function still flips status for projects
  // that were active when last synced and have since been deactivated.
  // The default Odoo ORM context applies `active_test=true` which would
  // otherwise drop archived rows even when the domain includes them.
  // Incremental: pull only projects whose Odoo write_date advanced past the
  // stored watermark (minus an overlap window). First incremental run with no
  // watermark falls back to the floor, i.e. a full pull to bootstrap.
  const projWm = ctx.mode === "incremental" ? await getWatermark(ctx, "projects") : null;
  const projDomain: unknown[] = [["active", "in", [true, false]]];
  if (ctx.mode === "incremental") {
    const since = odooDateMinus(
      projWm?.lastWriteDate ?? WATERMARK_FLOOR,
      WATERMARK_OVERLAP_MINUTES,
    );
    projDomain.push(["write_date", ">", since]);
  }
  const projects = await ctx.odoo.searchRead<OdooProject>(
    "project.project",
    projDomain,
    PROJECT_FIELDS,
    // active_test=false bypasses the implicit `active=true` filter Odoo
    // applies to every model with an `active` column.
    { limit: 5000, context: { active_test: false } },
  );

  let imported = 0;
  for (const p of projects) {
    // Resolve client: real partner if linked, else fall back to a placeholder
    // "Unassigned Client" so the project still imports.
    let clientUuid: string | undefined;
    if (p.partner_id) {
      clientUuid = ctx.clientIdMap.get(p.partner_id[0]);
    }
    if (!clientUuid) {
      clientUuid = await ensureUnassignedClient(ctx);
    }

    const row = buildProjectRow(ctx, p, clientUuid);
    const { data, error } = await supabaseAdmin
      .from("projects")
      .upsert(row, {
        onConflict: "organization_id,external_source,external_id",
      })
      .select("id")
      .single();
    if (error) throw new Error(`project ${p.id}: ${error.message}`);
    ctx.projectIdMap.set(p.id, data.id);

    // Tag assignments — replace the project's tag set in one shot.
    const tagIds = Array.isArray(p.tag_ids) ? p.tag_ids : [];
    await syncProjectTagAssignments(ctx, data.id, tagIds);

    // Category (service) assignments — these render as chips on the card.
    const categoryIds = Array.isArray(p.category_ids) ? p.category_ids : [];
    await syncProjectServiceLinks(ctx, data.id, categoryIds);

    // Members (favorite_user_ids) — render as overlapping avatars in card footer.
    const memberUserIds = Array.isArray(p.favorite_user_ids) ? p.favorite_user_ids : [];
    await syncProjectMembers(ctx, data.id, memberUserIds);

    imported++;
  }

  // Advance the incremental watermark to the newest write_date we saw. If this
  // run returned nothing new, keep the existing mark (don't regress).
  if (ctx.mode === "incremental") {
    const maxWriteDate = projects.reduce<string | null>((acc, p) => {
      const wd = (p as { write_date?: string | false }).write_date;
      return typeof wd === "string" && (!acc || wd > acc) ? wd : acc;
    }, projWm?.lastWriteDate ?? null);
    if (maxWriteDate) await saveWatermark(ctx, "projects", { lastWriteDate: maxWriteDate });
    console.log(`[odoo-import] projects incremental: ${imported} changed`);
    return imported;
  }

  // ── Reconciliation (full mode only) — Odoo is the source of truth ─────────
  // Archive any previously-imported project whose Odoo source has been
  // hard-deleted since the last sync. The `active=false` (archived) case is
  // now handled directly in the insert above; this only catches genuine
  // deletions, which are rare but possible.
  const liveActiveIds = new Set(projects.map((p) => String(p.id)));
  const { data: priorRows } = await supabaseAdmin
    .from("projects")
    .select("id, external_id, status")
    .eq("organization_id", ctx.organizationId)
    .eq("external_source", SOURCE);
  const stale = (priorRows ?? []).filter(
    (r) =>
      r.external_id != null &&
      !liveActiveIds.has(String(r.external_id)) &&
      r.status !== "archived",
  );
  if (stale.length > 0) {
    const { error: archErr } = await supabaseAdmin
      .from("projects")
      .update({ status: "archived" })
      .in(
        "id",
        stale.map((r) => r.id as string),
      );
    if (archErr) console.warn(`archive stale projects: ${archErr.message}`);
    else console.log(`[odoo-import] archived ${stale.length} stale projects`);
  }

  // Hard-delete any project that wasn't sourced from Odoo. Odoo is the
  // source of truth — dashboard-created projects (external_source is null)
  // are removed on every sync so the list view only ever shows Odoo data.
  // Child rows (tasks, members, services, tags, comments, ...) cascade.
  const { data: nativeRows, error: nativeSelErr } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .is("external_source", null);
  if (nativeSelErr) {
    console.warn(`select native projects: ${nativeSelErr.message}`);
  } else if (nativeRows && nativeRows.length > 0) {
    const ids = nativeRows.map((r) => r.id as string);
    const { error: delErr } = await supabaseAdmin
      .from("projects")
      .delete()
      .in("id", ids);
    if (delErr) console.warn(`delete native projects: ${delErr.message}`);
    else console.log(`[odoo-import] deleted ${ids.length} non-Odoo projects`);
  }

  return imported;
}

async function syncProjectMembers(
  ctx: ImportContext,
  projectUuid: string,
  odooUserIds: number[],
): Promise<number> {
  // Replace the project's member set in one shot.
  await supabaseAdmin
    .from("project_members")
    .delete()
    .eq("project_id", projectUuid);

  const employeeUuids = odooUserIds
    .map((uid) => ctx.odooUserToEmployee.get(uid) ?? ctx.employeeIdMap.get(uid))
    .filter((x): x is string => Boolean(x));
  if (employeeUuids.length === 0) return 0;

  // Dedup in case Odoo returns the same user twice (defensive).
  const unique = Array.from(new Set(employeeUuids));
  const rows = unique.map((eid) => ({
    organization_id: ctx.organizationId,
    project_id: projectUuid,
    employee_id: eid,
    role_label: "member",
  }));
  const { error } = await supabaseAdmin.from("project_members").insert(rows);
  if (error) {
    console.warn(`project ${projectUuid} members: ${error.message}`);
    return 0;
  }
  return rows.length;
}

async function syncProjectServiceLinks(
  ctx: ImportContext,
  projectUuid: string,
  odooCategoryIds: number[],
): Promise<number> {
  // Replace the project's service set in one shot.
  await supabaseAdmin
    .from("project_services")
    .delete()
    .eq("project_id", projectUuid);

  const serviceUuids = odooCategoryIds
    .map((cid) => ctx.serviceIdMap.get(cid))
    .filter((x): x is string => Boolean(x));
  if (serviceUuids.length === 0) return 0;

  const rows = serviceUuids.map((sid) => ({
    organization_id: ctx.organizationId,
    project_id: projectUuid,
    service_id: sid,
    status: "active",
  }));
  const { error } = await supabaseAdmin.from("project_services").insert(rows);
  if (error) {
    console.warn(`project ${projectUuid} services: ${error.message}`);
    return 0;
  }
  return rows.length;
}

async function importProjectTags(ctx: ImportContext): Promise<number> {
  const tags = await ctx.odoo.searchRead<OdooProjectTag>(
    "project.tags",
    [],
    ["id", "name", "color"],
    { limit: 500 },
  );
  for (const t of tags) {
    const row = {
      organization_id: ctx.organizationId,
      external_source: SOURCE,
      external_id: String(t.id),
      name: t.name,
      color: typeof t.color === "number" ? t.color : 0,
    };
    const { data, error } = await supabaseAdmin
      .from("project_tags")
      .upsert(row, { onConflict: "organization_id,external_source,external_id" })
      .select("id")
      .single();
    if (error) throw new Error(`tag ${t.id} (${t.name}): ${error.message}`);
    ctx.tagIdMap.set(t.id, data.id);
  }
  return tags.length;
}

async function syncProjectTagAssignments(
  ctx: ImportContext,
  projectUuid: string,
  odooTagIds: number[],
): Promise<number> {
  // Wipe existing assignments for this project, then insert the current set.
  // Cheaper to diff than to reconcile when the set is small (~5 tags max).
  await supabaseAdmin
    .from("project_tag_assignments")
    .delete()
    .eq("project_id", projectUuid);

  const tagUuids = odooTagIds
    .map((tid) => ctx.tagIdMap.get(tid))
    .filter((x): x is string => Boolean(x));
  if (tagUuids.length === 0) return 0;

  const rows = tagUuids.map((tid) => ({
    organization_id: ctx.organizationId,
    project_id: projectUuid,
    tag_id: tid,
  }));
  const { error } = await supabaseAdmin
    .from("project_tag_assignments")
    .insert(rows);
  if (error) {
    console.warn(`project ${projectUuid} tag assignments: ${error.message}`);
    return 0;
  }
  return rows.length;
}

async function loadStages(ctx: ImportContext): Promise<void> {
  const stages = await ctx.odoo.searchRead<OdooTaskStage>(
    "project.task.type",
    [],
    ["id", "name"],
    { limit: 200 },
  );
  for (const s of stages) ctx.stageNameById.set(s.id, s.name);
}

// Map an Odoo project.task → Supabase `tasks` row. Shared by the bulk
// importTasks staging loop and the single-task on-demand pull (syncOneTask) so
// the 30+ field mapping never drifts between the two paths. Does NOT set
// task_code — the caller owns sequencing.
function buildTaskRow(
  ctx: ImportContext,
  t: OdooTask,
  projectUuid: string,
): Record<string, unknown> {
  const stageName = t.stage_id ? ctx.stageNameById.get(t.stage_id[0]) : "New";
  // Odoo's `state` field is the source of truth for done-ness — independent of
  // the kanban stage_id, so a task can be done while parked in any column.
  const stage = t.state === "1_done" ? "done" : mapStageName(stageName);
  const serviceUuid =
    t.category_id ? ctx.serviceIdMap.get(t.category_id[0]) ?? null : null;
  return {
    organization_id: ctx.organizationId,
    external_source: SOURCE,
    external_id: t.id,
    project_id: projectUuid,
    service_id: serviceUuid,
    title: t.name,
    sequence: typeof t.sequence === "number" ? t.sequence : 10,
    description: nullable(t.description),
    stage,
    planned_date: nullable(t.date_deadline),
    progress_percent: t.progress_percentage ?? 0,
    expected_progress_percent: t.expected_progress ?? 0,
    progress_slip_percent: t.progress_slip ?? 0,
    status: stage === "done" ? "done" : "in_progress",
    priority: t.priority === "1" ? "high" : "medium",
    completed_at: stage === "done" ? nullable(t.date_end) : null,
    date_assign: nullable(t.date_assign),
    start_date: nullable(t.date_start),
    duration_days: typeof t.duration_days === "number" ? t.duration_days : null,
    current_stage_duration:
      typeof t.current_stage_duration === "string" ? t.current_stage_duration : null,
    working_days_open:
      typeof t.working_days_open === "number" ? t.working_days_open : null,
    working_days_close:
      typeof t.working_days_close === "number" ? t.working_days_close : null,
    duration_tracking:
      t.duration_tracking && typeof t.duration_tracking === "object"
        ? t.duration_tracking
        : null,
    actual_done_date:
      typeof t.actual_done_date === "string" ? t.actual_done_date.slice(0, 10) : null,
    delay_days: typeof t.delay_days === "number" ? t.delay_days : null,
    is_overdue: typeof t.is_overdue === "boolean" ? t.is_overdue : null,
    design_count: typeof t.design_count === "number" ? t.design_count : 0,
    document_count: typeof t.document_count === "number" ? t.document_count : 0,
    email_cc: nullable(t.email_cc),
    is_important: t.ks_mark_important === true,
    archived_at: t.active === false ? new Date().toISOString() : null,
  };
}

async function importTasks(ctx: ImportContext): Promise<number> {
  await loadStages(ctx);

  // Pull tasks for projects we successfully imported.
  const projectOdooIds = Array.from(ctx.projectIdMap.keys());
  if (projectOdooIds.length === 0) return 0;

  // Project UUID → AM employee UUID map. Used to auto-assign each task's
  // account_manager slot from the project's AM (matches Sky Light's owner
  // system MD: tasks inherit the project's AM unless overridden).
  const { data: projectRoles } = await supabaseAdmin
    .from("projects")
    .select(
      "id, account_manager_employee_id, project_manager_employee_id, social_specialist_id, media_specialist_id, seo_specialist_id, social_manager_id, media_manager_id, seo_manager_id",
    )
    .eq("organization_id", ctx.organizationId);
  const projectRoleById = new Map<string, {
    accountManagerId: string | null;
    projectManagerId: string | null;
    socialSpecialistId: string | null;
    mediaSpecialistId: string | null;
    seoSpecialistId: string | null;
    socialManagerId: string | null;
    mediaManagerId: string | null;
    seoManagerId: string | null;
  }>();
  for (const p of projectRoles ?? []) {
    projectRoleById.set(p.id as string, {
      accountManagerId: (p.account_manager_employee_id as string | null) ?? null,
      projectManagerId: (p.project_manager_employee_id as string | null) ?? null,
      socialSpecialistId: (p.social_specialist_id as string | null) ?? null,
      mediaSpecialistId: (p.media_specialist_id as string | null) ?? null,
      seoSpecialistId: (p.seo_specialist_id as string | null) ?? null,
      socialManagerId: (p.social_manager_id as string | null) ?? null,
      mediaManagerId: (p.media_manager_id as string | null) ?? null,
      seoManagerId: (p.seo_manager_id as string | null) ?? null,
    });
  }

  // Employee UUID → that employee's own team leader (قائد الفريق). Source of
  // truth is /organization/employees: team_leader_employee_id ONLY. There is NO
  // fallback to المدير (manager_employee_id) — المدير is the manager of the
  // department heads, a higher level, not the person's team leader. The task
  // card and accountability attribution both read
  // task_assignees.team_manager_employee_id, so it must mirror قائد الفريق —
  // NOT the project's specialist slot and NOT the manager.
  const { data: leaderRows } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, team_leader_employee_id")
    .eq("organization_id", ctx.organizationId);
  const employeeLeaderById = new Map<string, string | null>();
  for (const r of leaderRows ?? []) {
    employeeLeaderById.set(
      r.id as string,
      (r.team_leader_employee_id as string | null) ?? null,
    );
  }

  // Batch the project filter to keep each RPC well under Odoo's read timeout.
  // A single `project_id IN (76 ids)` request was returning >2 MB and timing
  // out on the Rwasem instance.
  // Incremental: restrict every batch to tasks changed since the watermark.
  const taskWm = ctx.mode === "incremental" ? await getWatermark(ctx, "tasks") : null;
  const taskSince =
    ctx.mode === "incremental"
      ? odooDateMinus(taskWm?.lastWriteDate ?? WATERMARK_FLOOR, WATERMARK_OVERLAP_MINUTES)
      : null;

  const PROJECTS_PER_BATCH = 10;
  const tasks: OdooTask[] = [];
  // Odoo project ids whose task fetch succeeded — only these are eligible
  // for the delete-reconciliation pass below. A skipped (timed-out) batch
  // must never let reconciliation nuke that project's live tasks.
  const coveredProjectOdooIds = new Set<number>();
  for (let i = 0; i < projectOdooIds.length; i += PROJECTS_PER_BATCH) {
    const slice = projectOdooIds.slice(i, i + PROJECTS_PER_BATCH);
    try {
      const taskDomain: unknown[] = [["project_id", "in", slice]];
      if (taskSince) taskDomain.push(["write_date", ">", taskSince]);
      const rows = await ctx.odoo.searchRead<OdooTask>(
        "project.task",
        taskDomain,
        TASK_FIELDS,
        // active_test=false bypasses Odoo's implicit `active=true` filter so
        // archived tasks under archived projects flow through too.
        { limit: 5000, context: { active_test: false } },
      );
      tasks.push(...rows);
      for (const pid of slice) coveredProjectOdooIds.add(pid);
      console.log(
        `[odoo-import] tasks batch ${Math.min(i + PROJECTS_PER_BATCH, projectOdooIds.length)}/${projectOdooIds.length} → ${rows.length} rows`,
      );
    } catch (err) {
      // Don't abort the whole sync on a single timed-out batch — log and skip.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[odoo-import] tasks batch ${i}-${i + PROJECTS_PER_BATCH} skipped: ${msg}`,
      );
    }
  }

  // ── Bulk path ────────────────────────────────────────────────────────
  // The previous version did 1 upsert + 1-2 delete/insert + 1 select-then-
  // insert PER task. With ~11k tasks that's >35k round-trips and ~30 min
  // wall-clock. Below: chunked upsert of tasks (200/req), then chunked
  // bulk operations on task_assignees keyed by Odoo task_id.
  type TaskRowInput = {
    odoo_id: number;
    projectUuid: string;
    row: Record<string, unknown>;
    agentEmployeeIds: string[];
    amEmployeeId: string | null;
    tagOdooIds: number[];
  };

  const stagedRows: TaskRowInput[] = [];
  for (const t of tasks) {
    if (!t.project_id) continue;
    const projectUuid = ctx.projectIdMap.get(t.project_id[0]);
    if (!projectUuid) continue;

    stagedRows.push({
      odoo_id: t.id,
      projectUuid,
      row: buildTaskRow(ctx, t, projectUuid),
      agentEmployeeIds: (Array.isArray(t.user_ids) ? t.user_ids : [])
        .map((uid) => ctx.odooUserToEmployee.get(uid))
        .filter((x): x is string => Boolean(x)),
      amEmployeeId: projectRoleById.get(projectUuid)?.accountManagerId ?? null,
      tagOdooIds: Array.isArray(t.tag_ids) ? t.tag_ids : [],
    });
  }

  if (stagedRows.length === 0) return 0;

  // ── Assign task_code up-front (bypass the per-row DB trigger) ──────────
  // `tg_set_task_code` derives codes from a per-project counter. Under a
  // bulk INSERT...ON CONFLICT that counter can hand two rows the same code
  // and abort the whole chunk (`tasks_project_task_code_unique`). We instead
  // compute every code here, where assignment is strictly sequential:
  //   - existing tasks keep their current task_code/code_seq
  //   - new tasks get `<project_code>-<n>`, continuing past the highest
  //     number already used on that project (across ANY code prefix).
  // Setting task_code on the row makes `tg_set_task_code` a no-op.
  {
    const projectCodeByUuid = new Map<string, string>();
    {
      const { data } = await supabaseAdmin
        .from("projects")
        .select("id, project_code")
        .eq("organization_id", ctx.organizationId);
      for (const r of data ?? []) {
        projectCodeByUuid.set(r.id as string, (r.project_code as string) ?? "PRJ-?");
      }
    }
    // Existing Odoo tasks: external_id → current code; per-project highest
    // number seen (max of code_seq and the numeric suffix of task_code, so
    // legacy prefix drift like PRJ-003-/PRJ-01631- can never collide).
    const existingCodeByExt = new Map<
      number,
      { task_code: string | null; code_seq: number | null }
    >();
    const maxNumByProject = new Map<string, number>();
    {
      const PREFETCH_PAGE = 1000;
      for (let from = 0; ; from += PREFETCH_PAGE) {
        const { data, error } = await supabaseAdmin
          .from("tasks")
          .select("external_id, project_id, task_code, code_seq")
          .eq("organization_id", ctx.organizationId)
          .eq("external_source", SOURCE)
          .range(from, from + PREFETCH_PAGE - 1);
        if (error) {
          console.warn(`[odoo-import] task_code prefetch: ${error.message}`);
          break;
        }
        if (!data || data.length === 0) break;
        for (const r of data) {
          const ext = r.external_id == null ? NaN : Number(r.external_id);
          if (Number.isFinite(ext)) {
            existingCodeByExt.set(ext, {
              task_code: (r.task_code as string) ?? null,
              code_seq: (r.code_seq as number) ?? null,
            });
          }
          const pid = r.project_id as string;
          const suffix = (r.task_code as string | null)?.match(/-(\d+)$/);
          const num = Math.max(
            typeof r.code_seq === "number" ? r.code_seq : 0,
            suffix ? Number(suffix[1]) : 0,
          );
          if (num > (maxNumByProject.get(pid) ?? 0)) maxNumByProject.set(pid, num);
        }
        if (data.length < PREFETCH_PAGE) break;
      }
    }
    const nextNumByProject = new Map<string, number>();
    for (const s of stagedRows) {
      const existing = existingCodeByExt.get(s.odoo_id);
      if (existing && existing.task_code) {
        s.row.task_code = existing.task_code;
        s.row.code_seq = existing.code_seq;
      } else {
        const num =
          nextNumByProject.get(s.projectUuid) ??
          (maxNumByProject.get(s.projectUuid) ?? 0) + 1;
        nextNumByProject.set(s.projectUuid, num + 1);
        const pcode = projectCodeByUuid.get(s.projectUuid) ?? "PRJ-?";
        s.row.task_code = `${pcode}-${String(num).padStart(3, "0")}`;
        s.row.code_seq = num;
      }
    }
  }

  // 1) Bulk-upsert tasks in chunks of 200.
  const TASK_CHUNK = 200;
  const odooToTaskUuid = new Map<number, string>();
  for (let i = 0; i < stagedRows.length; i += TASK_CHUNK) {
    const chunk = stagedRows.slice(i, i + TASK_CHUNK);
    // Retry transient network/timeout failures — a single stalled request to
    // Supabase must not abort the whole 11k-row task import.
    let rows: { id: string; external_id: string }[] = [];
    for (let attempt = 1; ; attempt++) {
      const { data, error } = await supabaseAdmin
        .from("tasks")
        .upsert(
          chunk.map((s) => s.row),
          { onConflict: "organization_id,external_source,external_id" },
        )
        .select("id, external_id");
      if (!error) {
        rows = (data ?? []) as { id: string; external_id: string }[];
        break;
      }
      const detail =
        `${error.message}` +
        (error.details ? ` | details: ${error.details}` : "") +
        (error.hint ? ` | hint: ${error.hint}` : "");
      const transient = /timeout|timed out|fetch failed|network|ECONNRESET|socket|EAI_AGAIN/i.test(
        error.message,
      );
      if (!transient || attempt >= 4) {
        throw new Error(`tasks bulk upsert: ${detail}`);
      }
      console.warn(
        `[odoo-import] tasks chunk @${i} attempt ${attempt} failed (${error.message}); retrying…`,
      );
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    for (const r of rows) {
      const ext = Number(r.external_id);
      if (Number.isFinite(ext)) odooToTaskUuid.set(ext, r.id as string);
    }
    console.log(
      `[odoo-import] tasks upserted ${Math.min(i + TASK_CHUNK, stagedRows.length)}/${stagedRows.length}`,
    );
  }

  // 2) Re-key staged rows by Supabase task UUID for the assignee phase.
  const stagedByTaskUuid = new Map<string, TaskRowInput>();
  for (const s of stagedRows) {
    const uuid = odooToTaskUuid.get(s.odoo_id);
    if (uuid) stagedByTaskUuid.set(uuid, s);
  }

  // 3) Bulk-wipe existing `agent` assignees for these tasks (re-import path).
  const allTaskUuids = [...stagedByTaskUuid.keys()];
  const DEL_CHUNK = 500;
  for (let i = 0; i < allTaskUuids.length; i += DEL_CHUNK) {
    const slice = allTaskUuids.slice(i, i + DEL_CHUNK);
    const { error } = await supabaseAdmin
      .from("task_assignees")
      .delete()
      .in("task_id", slice)
      .eq("role_type", "agent");
    if (error) console.warn(`task_assignees delete batch: ${error.message}`);
  }

  // 4) Snapshot existing `account_manager` rows so we don't overwrite
  //    dashboard-assigned AMs that already exist.
  const existingAMSet = new Set<string>();
  for (let i = 0; i < allTaskUuids.length; i += DEL_CHUNK) {
    const slice = allTaskUuids.slice(i, i + DEL_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("task_assignees")
      .select("task_id")
      .in("task_id", slice)
      .eq("role_type", "account_manager");
    if (error) {
      console.warn(`task_assignees AM scan: ${error.message}`);
      continue;
    }
    for (const r of data ?? []) existingAMSet.add(r.task_id as string);
  }

  // 5) Build the bulk-insert payload for both `agent` and `account_manager`.
  const assigneeInserts: {
    organization_id: string;
    task_id: string;
    employee_id: string;
    role_type: "agent" | "account_manager";
    team_manager_employee_id: string | null;
  }[] = [];
  // Each assignee's team leader comes from their OWN org-chart record, never
  // the project's specialist/PM slot (which mislabelled 90% of links).
  const leaderFor = (eid: string): string | null => {
    const leader = employeeLeaderById.get(eid) ?? null;
    return leader && leader !== eid ? leader : null;
  };
  for (const [taskUuid, s] of stagedByTaskUuid) {
    for (const eid of s.agentEmployeeIds) {
      if (s.amEmployeeId && eid === s.amEmployeeId) continue;
      assigneeInserts.push({
        organization_id: ctx.organizationId,
        task_id: taskUuid,
        employee_id: eid,
        role_type: "agent",
        team_manager_employee_id: leaderFor(eid),
      });
    }
    if (s.amEmployeeId && !existingAMSet.has(taskUuid)) {
      assigneeInserts.push({
        organization_id: ctx.organizationId,
        task_id: taskUuid,
        employee_id: s.amEmployeeId,
        role_type: "account_manager",
        team_manager_employee_id: leaderFor(s.amEmployeeId),
      });
    }
  }

  // 6) Bulk-insert assignees in chunks of 500.
  const INS_CHUNK = 500;
  let assigneesInserted = 0;
  for (let i = 0; i < assigneeInserts.length; i += INS_CHUNK) {
    const slice = assigneeInserts.slice(i, i + INS_CHUNK);
    const { error } = await supabaseAdmin.from("task_assignees").insert(slice);
    if (error) {
      console.warn(`task_assignees bulk insert: ${error.message}`);
    } else {
      assigneesInserted += slice.length;
    }
  }
  ctx.assigneeCount += assigneesInserted;
  console.log(
    `[odoo-import] task_assignees inserted: ${assigneesInserted}`,
  );

  // 7) Sync task tag assignments (Odoo project.task.tag_ids → project_tags).
  //    Wipe-and-reinsert per re-import, mirroring the assignee phase.
  for (let i = 0; i < allTaskUuids.length; i += DEL_CHUNK) {
    const slice = allTaskUuids.slice(i, i + DEL_CHUNK);
    const { error } = await supabaseAdmin
      .from("task_tag_assignments")
      .delete()
      .in("task_id", slice);
    if (error) console.warn(`task_tag_assignments delete batch: ${error.message}`);
  }
  const tagInserts: {
    organization_id: string;
    task_id: string;
    tag_id: string;
  }[] = [];
  for (const [taskUuid, s] of stagedByTaskUuid) {
    for (const odooTagId of s.tagOdooIds) {
      const tagUuid = ctx.tagIdMap.get(odooTagId);
      if (tagUuid) {
        tagInserts.push({
          organization_id: ctx.organizationId,
          task_id: taskUuid,
          tag_id: tagUuid,
        });
      }
    }
  }
  let tagsInserted = 0;
  for (let i = 0; i < tagInserts.length; i += INS_CHUNK) {
    const slice = tagInserts.slice(i, i + INS_CHUNK);
    const { error } = await supabaseAdmin
      .from("task_tag_assignments")
      .insert(slice);
    if (error) console.warn(`task_tag_assignments bulk insert: ${error.message}`);
    else tagsInserted += slice.length;
  }
  console.log(`[odoo-import] task_tag_assignments inserted: ${tagsInserted}`);

  // Advance the incremental watermark and skip delete-reconciliation: an
  // incremental fetch only returns CHANGED tasks, so the "delete anything not
  // in the result set" pass below would wipe every unchanged task. Deletions
  // are reaped by the nightly full run instead.
  if (ctx.mode === "incremental") {
    const maxWriteDate = tasks.reduce<string | null>((acc, t) => {
      const wd = (t as { write_date?: string | false }).write_date;
      return typeof wd === "string" && (!acc || wd > acc) ? wd : acc;
    }, taskWm?.lastWriteDate ?? null);
    if (maxWriteDate) await saveWatermark(ctx, "tasks", { lastWriteDate: maxWriteDate });
    console.log(`[odoo-import] tasks incremental: ${stagedRows.length} changed`);
    return stagedRows.length;
  }

  // ── Reconciliation (full mode only) — Odoo is the source of truth ──────
  // Hard-delete dashboard task rows that should no longer exist:
  //   (a) Odoo-sourced tasks whose Odoo id was NOT returned this run — they
  //       were deleted/unlinked in Odoo. Scoped to projects whose task
  //       fetch succeeded so a skipped batch never deletes live data.
  //   (b) tasks created in the dashboard (external_source is null) — Odoo
  //       is authoritative for this phase, mirroring importProjects().
  // Every task child row (assignees, comments, timesheets, activities,
  // stage history, …) is FK `on delete cascade`, so a plain delete is clean.
  const liveOdooTaskIds = new Set(tasks.map((t) => t.id));
  const coveredProjectUuids = new Set<string>();
  for (const odooId of coveredProjectOdooIds) {
    const uuid = ctx.projectIdMap.get(odooId);
    if (uuid) coveredProjectUuids.add(uuid);
  }

  const ghostTaskIds: string[] = [];
  const RECON_PAGE = 1000;
  for (let from = 0; ; from += RECON_PAGE) {
    const { data: rows, error } = await supabaseAdmin
      .from("tasks")
      .select("id, external_id, project_id")
      .eq("organization_id", ctx.organizationId)
      .eq("external_source", SOURCE)
      .range(from, from + RECON_PAGE - 1);
    if (error) {
      console.warn(`[odoo-import] reconcile select: ${error.message}`);
      break;
    }
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      if (!coveredProjectUuids.has(r.project_id as string)) continue;
      const ext = r.external_id == null ? NaN : Number(r.external_id);
      if (!Number.isFinite(ext) || !liveOdooTaskIds.has(ext)) {
        ghostTaskIds.push(r.id as string);
      }
    }
    if (rows.length < RECON_PAGE) break;
  }
  for (let i = 0; i < ghostTaskIds.length; i += DEL_CHUNK) {
    const { error } = await supabaseAdmin
      .from("tasks")
      .delete()
      .in("id", ghostTaskIds.slice(i, i + DEL_CHUNK));
    if (error) console.warn(`[odoo-import] reconcile delete ghosts: ${error.message}`);
  }
  if (ghostTaskIds.length > 0) {
    console.log(
      `[odoo-import] reconcile: deleted ${ghostTaskIds.length} tasks no longer in Odoo`,
    );
  }

  const { data: nativeTaskRows, error: nativeErr } = await supabaseAdmin
    .from("tasks")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .is("external_source", null);
  if (nativeErr) {
    console.warn(`[odoo-import] reconcile native select: ${nativeErr.message}`);
  } else if (nativeTaskRows && nativeTaskRows.length > 0) {
    const ids = nativeTaskRows.map((r) => r.id as string);
    for (let i = 0; i < ids.length; i += DEL_CHUNK) {
      const { error } = await supabaseAdmin
        .from("tasks")
        .delete()
        .in("id", ids.slice(i, i + DEL_CHUNK));
      if (error) console.warn(`[odoo-import] reconcile delete native: ${error.message}`);
    }
    console.log(`[odoo-import] reconcile: deleted ${ids.length} non-Odoo tasks`);
  }

  return stagedRows.length;
}

// Mirror Odoo task chatter (mail.message) into task_comments so notes are
// searchable and cached locally. Idempotent on (org, external_source, external_id).
async function importTaskComments(
  ctx: ImportContext,
  opts: { onlyOdooTaskIds?: number[] } = {},
): Promise<number> {
  // Build Odoo task id → Supabase task uuid map by hydrating from the DB.
  // Page through the task map: PostgREST caps a single select at ~1000 rows,
  // and there are far more synced tasks than that. Without paging, messages
  // for every task past the cap silently drop (their res_id never resolves).
  // When opts.onlyOdooTaskIds is set (single-task on-demand pull) we scope to
  // just those tasks instead of paging the whole table.
  const taskUuidByOdooId = new Map<number, string>();
  if (opts.onlyOdooTaskIds && opts.onlyOdooTaskIds.length > 0) {
    const { data: taskRows } = await supabaseAdmin
      .from("tasks")
      .select("id, external_id")
      .eq("organization_id", ctx.organizationId)
      .eq("external_source", SOURCE)
      .in("external_id", opts.onlyOdooTaskIds.map(String));
    for (const r of taskRows ?? []) {
      if (r.external_id != null) {
        const n = Number(r.external_id);
        if (Number.isFinite(n)) taskUuidByOdooId.set(n, r.id as string);
      }
    }
  } else {
    const TASK_PAGE = 1000;
    for (let from = 0; ; from += TASK_PAGE) {
      const { data: taskRows } = await supabaseAdmin
        .from("tasks")
        .select("id, external_id")
        .eq("organization_id", ctx.organizationId)
        .eq("external_source", SOURCE)
        .range(from, from + TASK_PAGE - 1);
      if (!taskRows || taskRows.length === 0) break;
      for (const r of taskRows) {
        if (r.external_id != null) {
          const n = Number(r.external_id);
          if (Number.isFinite(n)) taskUuidByOdooId.set(n, r.id as string);
        }
      }
      if (taskRows.length < TASK_PAGE) break;
    }
  }
  if (taskUuidByOdooId.size === 0) return 0;

  const odooTaskIds = Array.from(taskUuidByOdooId.keys());
  const odooBase = process.env.ODOO_URL?.replace(/\/+$/, "") ?? "";

  // Batch-fetch in chunks (Odoo IN-clause is fine up to a few thousand).
  const CHUNK = 500;
  let imported = 0;
  type OdooMessage = {
    id: number;
    res_id: number;
    body: string | false;
    author_id: OdooMany2one;
    date: string | false;
    message_type: string;
    subtype_id: OdooMany2one;
    tracking_value_ids: number[] | false;
    attachment_ids: number[] | false;
  };
  type OdooTrackingValue = {
    id: number;
    mail_message_id: OdooMany2one;
    field_id: OdooMany2one;
    old_value_char: string | false;
    new_value_char: string | false;
    old_value_text: string | false;
    new_value_text: string | false;
    old_value_integer: number | false;
    new_value_integer: number | false;
    old_value_float: number | false;
    new_value_float: number | false;
  };
  const trackVal = (
    c: string | false, t: string | false, i: number | false, f: number | false,
  ): string => {
    if (typeof c === "string" && c) return c;
    if (typeof t === "string" && t) return t;
    if (typeof i === "number") return String(i);
    if (typeof f === "number") return String(f);
    return "—";
  };
  // Page through mail.message instead of a single capped read. A 500-task
  // chunk can hold tens of thousands of messages; a fixed `limit` would
  // silently drop everything past the cap (e.g. with `order: date asc` the
  // newest notes vanish). Keyset-paginate on `id` (`id > lastId`) rather than
  // `offset` — deep offsets force Odoo/Postgres to scan and discard every
  // preceding row, which blows past the JSON-RPC timeout on a busy chunk.
  // Incremental: mail.message is append-only with monotonically increasing
  // ids, so a single global id watermark lets every chunk skip already-synced
  // messages (`id > watermark`). Track the max id seen to advance it.
  const tcWm = ctx.mode === "incremental" ? await getWatermark(ctx, "task_comments") : null;
  const startId = tcWm?.lastMessageId ?? 0;
  let maxSeenMsgId = startId;

  const MSG_PAGE = 2000;
  for (let i = 0; i < odooTaskIds.length; i += CHUNK) {
    const slice = odooTaskIds.slice(i, i + CHUNK);
    const messages: OdooMessage[] = [];
    let lastId = startId;
    for (;;) {
      const page = await ctx.odoo.searchRead<OdooMessage>(
        "mail.message",
        [
          ["model", "=", "project.task"],
          ["res_id", "in", slice],
          // Pull comments/emails AND notifications (which carry stage/priority/
          // assignee tracking changes via tracking_value_ids).
          ["message_type", "in", ["comment", "email", "notification"]],
          ["id", ">", lastId],
        ],
        [
          "id", "res_id", "body", "author_id", "date", "message_type",
          "subtype_id", "tracking_value_ids", "attachment_ids",
        ],
        { limit: MSG_PAGE, order: "id asc" },
      );
      messages.push(...page);
      if (page.length > 0) {
        const pageMax = page[page.length - 1].id;
        if (pageMax > maxSeenMsgId) maxSeenMsgId = pageMax;
      }
      if (page.length < MSG_PAGE) break;
      lastId = page[page.length - 1].id;
    }

    if (messages.length === 0) continue;

    // Resolve subtypes once: 'mail.mt_note' = is_internal=true (log note),
    // others = customer-facing comment.
    const subtypeIds = Array.from(
      new Set(
        messages
          .map((m) => (Array.isArray(m.subtype_id) ? (m.subtype_id[0] as number) : null))
          .filter((x): x is number => Boolean(x)),
      ),
    );
    const internalSubtypeIds = new Set<number>();
    if (subtypeIds.length > 0) {
      const subs = await ctx.odoo.searchRead<{ id: number; internal: boolean }>(
        "mail.message.subtype",
        [["id", "in", subtypeIds]],
        ["id", "internal"],
      );
      for (const s of subs) if (s.internal) internalSubtypeIds.add(s.id);
    }

    // Tracking values + field labels (for notifications).
    const trackingValueIds = Array.from(
      new Set(
        messages.flatMap((m) =>
          Array.isArray(m.tracking_value_ids) ? m.tracking_value_ids : [],
        ),
      ),
    );
    const tvByMessage = new Map<number, OdooTrackingValue[]>();
    const fieldLabelById = new Map<number, string>();
    if (trackingValueIds.length > 0) {
      const tvs = await ctx.odoo.searchRead<OdooTrackingValue>(
        "mail.tracking.value",
        [["id", "in", trackingValueIds]],
        [
          "id", "mail_message_id", "field_id",
          "old_value_char", "new_value_char",
          "old_value_text", "new_value_text",
          "old_value_integer", "new_value_integer",
          "old_value_float", "new_value_float",
        ],
      );
      for (const tv of tvs) {
        const mid = Array.isArray(tv.mail_message_id) ? (tv.mail_message_id[0] as number) : null;
        if (!mid) continue;
        const arr = tvByMessage.get(mid) ?? [];
        arr.push(tv);
        tvByMessage.set(mid, arr);
      }
      const fieldIds = Array.from(
        new Set(
          tvs
            .map((t) => (Array.isArray(t.field_id) ? (t.field_id[0] as number) : null))
            .filter((x): x is number => Boolean(x)),
        ),
      );
      if (fieldIds.length > 0) {
        const fields = await ctx.odoo.searchRead<{ id: number; field_description: string }>(
          "ir.model.fields",
          [["id", "in", fieldIds]],
          ["id", "field_description"],
        );
        for (const f of fields) fieldLabelById.set(f.id, f.field_description);
      }
    }

    const rows = messages
      .map((m) => {
        const taskUuid = taskUuidByOdooId.get(m.res_id);
        if (!taskUuid) return null;
        const author = Array.isArray(m.author_id) ? m.author_id : null;
        const subtypeId = Array.isArray(m.subtype_id) ? (m.subtype_id[0] as number) : null;
        const baseRow = {
          organization_id: ctx.organizationId,
          task_id: taskUuid,
          external_source: SOURCE,
          external_id: String(m.id),
          author_user_id: null,
          external_author_name: author ? String(author[1]) : null,
          external_author_avatar_url: author && odooBase
            ? `${odooBase}/web/image/res.partner/${author[0]}/avatar_1`
            : null,
          is_internal: subtypeId ? internalSubtypeIds.has(subtypeId) : true,
          kind: "note" as const,
          created_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
          updated_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
        };

        if (m.message_type === "notification") {
          const tvs = tvByMessage.get(m.id) ?? [];
          if (tvs.length === 0) {
            // Lifecycle notifications (e.g. "Task Created") carry no tracking
            // values — keep them anyway, using the subtype label as the body
            // so the timeline matches Odoo's chatter. Drop only when even the
            // subtype name is missing (pure noise).
            const subtypeLabel =
              Array.isArray(m.subtype_id) && typeof m.subtype_id[1] === "string"
                ? (m.subtype_id[1] as string)
                : null;
            if (!subtypeLabel) return null;
            return { ...baseRow, body: `<p><strong>${subtypeLabel}</strong></p>` };
          }
          const lines = tvs.map((tv) => {
            const fid = Array.isArray(tv.field_id) ? (tv.field_id[0] as number) : null;
            const label = (fid && fieldLabelById.get(fid)) || "Field";
            const oldV = trackVal(
              tv.old_value_char, tv.old_value_text, tv.old_value_integer, tv.old_value_float,
            );
            const newV = trackVal(
              tv.new_value_char, tv.new_value_text, tv.new_value_integer, tv.new_value_float,
            );
            return `<p><strong>${label}:</strong> <span class="text-muted-foreground">${oldV}</span> → <span class="text-cyan font-medium">${newV}</span></p>`;
          });
          return { ...baseRow, body: lines.join("") };
        }

        const body = typeof m.body === "string" ? m.body.trim() : "";
        const hasAttachments =
          Array.isArray(m.attachment_ids) && m.attachment_ids.length > 0;
        // Keep the note if it has either text OR an attachment. Odoo lets
        // users post a chatter entry with only a file (no body); if we drop
        // those here, the attachment also vanishes from the dashboard
        // because task_attachments rows are linked through this comment.
        if (!body && !hasAttachments) return null;
        return { ...baseRow, body: body || "(مرفقات)" };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (rows.length === 0) continue;

    // Upsert in sub-batches: a keyset-paged chunk can hold tens of thousands
    // of rows, too large for a single PostgREST request.
    let error: { message: string } | null = null;
    for (let r = 0; r < rows.length; r += 1000) {
      const { error: batchError } = await supabaseAdmin
        .from("task_comments")
        .upsert(rows.slice(r, r + 1000), {
          onConflict: "organization_id,external_source,external_id",
        });
      if (batchError) {
        error = batchError;
        break;
      }
    }
    if (error) {
      console.warn(`task_comments chunk @${i}: ${error.message}`);
    } else {
      imported += rows.length;
    }

    // Mirror Odoo `ir.attachment` rows linked to these messages into
    // `task_attachments`. We persist metadata + a fallback `source_url`
    // pointing at Odoo `/web/content/{id}` (the original Odoo attachment
    // controller serves binaries to authenticated users). Storage backfill
    // can run later as a separate job. Idempotent on
    // (organization_id, external_source, external_id).
    const attachmentIds = Array.from(
      new Set(
        messages.flatMap((m) =>
          Array.isArray(m.attachment_ids) ? (m.attachment_ids as number[]) : [],
        ),
      ),
    );
    if (attachmentIds.length === 0) continue;

    // Map Odoo message id → Supabase comment uuid for this chunk. The lookup
    // is paged: a chunk can hold far more than PostgREST's ~1000-row cap, and
    // an un-paged read would leave later attachments unlinked.
    const odooMsgIdsInChunk = messages.map((m) => String(m.id));
    const commentByOdooMsgId = new Map<number, { id: string; task_id: string }>();
    for (let j = 0; j < odooMsgIdsInChunk.length; j += 1000) {
      const idSlice = odooMsgIdsInChunk.slice(j, j + 1000);
      const { data: commentRows } = await supabaseAdmin
        .from("task_comments")
        .select("id, task_id, external_id")
        .eq("organization_id", ctx.organizationId)
        .eq("external_source", SOURCE)
        .in("external_id", idSlice)
        .range(0, idSlice.length - 1);
      for (const c of commentRows ?? []) {
        const n = Number(c.external_id);
        if (Number.isFinite(n)) commentByOdooMsgId.set(n, { id: c.id, task_id: c.task_id });
      }
    }

    type OdooAttachment = {
      id: number;
      name: string | false;
      mimetype: string | false;
      file_size: number | false;
      url: string | false;
      res_model: string | false;
      res_id: number | false;
    };
    const attachmentRows = await ctx.odoo.searchRead<OdooAttachment>(
      "ir.attachment",
      [["id", "in", attachmentIds]],
      ["id", "name", "mimetype", "file_size", "url", "res_model", "res_id"],
    );

    // Walk messages: for each attached file, decide which comment it belongs
    // to (via the message link). Mail attachments are linked through
    // `mail.message.attachment_ids`, so we scan the messages we already pulled.
    const attRowsToInsert: {
      organization_id: string;
      task_id: string;
      task_comment_id: string;
      filename: string;
      mimetype: string | null;
      size_bytes: number | null;
      storage_path: null;
      source_url: string;
      external_source: typeof SOURCE;
      external_id: string;
    }[] = [];
    const attMetaById = new Map<number, OdooAttachment>();
    for (const a of attachmentRows) attMetaById.set(a.id, a);

    for (const m of messages) {
      const ids = Array.isArray(m.attachment_ids) ? (m.attachment_ids as number[]) : [];
      if (ids.length === 0) continue;
      const link = commentByOdooMsgId.get(m.id);
      if (!link) continue;
      for (const aid of ids) {
        const meta = attMetaById.get(aid);
        if (!meta) continue;
        const filename = typeof meta.name === "string" && meta.name ? meta.name : `attachment-${aid}`;
        const mimetype = typeof meta.mimetype === "string" ? meta.mimetype : null;
        const size = typeof meta.file_size === "number" ? meta.file_size : null;
        const explicitUrl = typeof meta.url === "string" && meta.url ? meta.url : null;
        const sourceUrl = explicitUrl
          ? explicitUrl
          : odooBase
            ? `${odooBase}/web/content/${aid}?download=true`
            : "";
        if (!sourceUrl) continue;
        attRowsToInsert.push({
          organization_id: ctx.organizationId,
          task_id: link.task_id,
          task_comment_id: link.id,
          filename,
          mimetype,
          size_bytes: size,
          storage_path: null,
          source_url: sourceUrl,
          external_source: SOURCE,
          external_id: String(aid),
        });
      }
    }

    if (attRowsToInsert.length > 0) {
      const { error: attErr } = await supabaseAdmin
        .from("task_attachments")
        .upsert(attRowsToInsert, {
          onConflict: "organization_id,external_source,external_id",
        });
      if (attErr) {
        console.warn(`task_attachments chunk @${i}: ${attErr.message}`);
      }
    }
  }

  if (ctx.mode === "incremental" && maxSeenMsgId > startId) {
    await saveWatermark(ctx, "task_comments", { lastMessageId: maxSeenMsgId });
    console.log(`[odoo-import] task_comments incremental: ${imported} new, watermark→${maxSeenMsgId}`);
  }

  return imported;
}

// Mirror Odoo project chatter (mail.message on project.project) into
// project_comments + project_attachments, parallel to importTaskComments.
// Same idempotency contract: (organization_id, external_source, external_id).
async function importProjectComments(ctx: ImportContext): Promise<number> {
  // Page the project map past PostgREST's ~1000-row select cap.
  const projectUuidByOdooId = new Map<number, string>();
  const PROJECT_PAGE = 1000;
  for (let from = 0; ; from += PROJECT_PAGE) {
    const { data: projectRows } = await supabaseAdmin
      .from("projects")
      .select("id, external_id")
      .eq("organization_id", ctx.organizationId)
      .eq("external_source", SOURCE)
      .range(from, from + PROJECT_PAGE - 1);
    if (!projectRows || projectRows.length === 0) break;
    for (const r of projectRows) {
      if (r.external_id != null) {
        const n = Number(r.external_id);
        if (Number.isFinite(n)) projectUuidByOdooId.set(n, r.id as string);
      }
    }
    if (projectRows.length < PROJECT_PAGE) break;
  }
  if (projectUuidByOdooId.size === 0) return 0;

  const odooProjectIds = Array.from(projectUuidByOdooId.keys());
  const odooBase = process.env.ODOO_URL?.replace(/\/+$/, "") ?? "";

  const CHUNK = 500;
  let imported = 0;
  type OdooMessage = {
    id: number;
    res_id: number;
    body: string | false;
    author_id: OdooMany2one;
    date: string | false;
    message_type: string;
    subtype_id: OdooMany2one;
    attachment_ids: number[] | false;
  };

  // Incremental: single global id watermark (append-only), same as task comments.
  const pcWm = ctx.mode === "incremental" ? await getWatermark(ctx, "project_comments") : null;
  const startId = pcWm?.lastMessageId ?? 0;
  let maxSeenMsgId = startId;

  // Keyset-paginate messages so a busy chunk is neither truncated by a fixed
  // cap nor slowed by deep offsets.
  const MSG_PAGE = 2000;
  for (let i = 0; i < odooProjectIds.length; i += CHUNK) {
    const slice = odooProjectIds.slice(i, i + CHUNK);
    const messages: OdooMessage[] = [];
    let lastId = startId;
    for (;;) {
      const page = await ctx.odoo.searchRead<OdooMessage>(
        "mail.message",
        [
          ["model", "=", "project.project"],
          ["res_id", "in", slice],
          // Project chatter is normally human comments/emails; notification
          // tracking on projects is rare so we focus on real notes here.
          ["message_type", "in", ["comment", "email"]],
          ["id", ">", lastId],
        ],
        [
          "id", "res_id", "body", "author_id", "date", "message_type",
          "subtype_id", "attachment_ids",
        ],
        { limit: MSG_PAGE, order: "id asc" },
      );
      messages.push(...page);
      if (page.length > 0) {
        const pageMax = page[page.length - 1].id;
        if (pageMax > maxSeenMsgId) maxSeenMsgId = pageMax;
      }
      if (page.length < MSG_PAGE) break;
      lastId = page[page.length - 1].id;
    }

    if (messages.length === 0) continue;

    const subtypeIds = Array.from(
      new Set(
        messages
          .map((m) => (Array.isArray(m.subtype_id) ? (m.subtype_id[0] as number) : null))
          .filter((x): x is number => Boolean(x)),
      ),
    );
    const internalSubtypeIds = new Set<number>();
    if (subtypeIds.length > 0) {
      const subs = await ctx.odoo.searchRead<{ id: number; internal: boolean }>(
        "mail.message.subtype",
        [["id", "in", subtypeIds]],
        ["id", "internal"],
      );
      for (const s of subs) if (s.internal) internalSubtypeIds.add(s.id);
    }

    const rows = messages
      .map((m) => {
        const projectUuid = projectUuidByOdooId.get(m.res_id);
        if (!projectUuid) return null;
        const author = Array.isArray(m.author_id) ? m.author_id : null;
        const subtypeId = Array.isArray(m.subtype_id) ? (m.subtype_id[0] as number) : null;
        const body = typeof m.body === "string" ? m.body.trim() : "";
        const hasAttachments = Array.isArray(m.attachment_ids) && m.attachment_ids.length > 0;
        // Skip empty messages with no attachments — nothing to mirror.
        if (!body && !hasAttachments) return null;
        return {
          organization_id: ctx.organizationId,
          project_id: projectUuid,
          external_source: SOURCE,
          external_id: String(m.id),
          author_user_id: null,
          external_author_name: author ? String(author[1]) : null,
          external_author_avatar_url: author && odooBase
            ? `${odooBase}/web/image/res.partner/${author[0]}/avatar_1`
            : null,
          is_internal: subtypeId ? internalSubtypeIds.has(subtypeId) : true,
          kind: "note",
          body: body || "(مرفقات)",
          created_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
          updated_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (rows.length === 0) continue;

    // Upsert in sub-batches — a keyset-paged chunk can exceed a single request.
    let error: { message: string } | null = null;
    for (let r = 0; r < rows.length; r += 1000) {
      const { error: batchError } = await supabaseAdmin
        .from("project_comments")
        .upsert(rows.slice(r, r + 1000), {
          onConflict: "organization_id,external_source,external_id",
        });
      if (batchError) {
        error = batchError;
        break;
      }
    }
    if (error) {
      console.warn(`project_comments chunk @${i}: ${error.message}`);
      continue;
    }
    imported += rows.length;

    // Backfill ir.attachment rows linked to these messages.
    const attachmentIds = Array.from(
      new Set(
        messages.flatMap((m) =>
          Array.isArray(m.attachment_ids) ? (m.attachment_ids as number[]) : [],
        ),
      ),
    );
    if (attachmentIds.length === 0) continue;

    // Paged lookup — a chunk can exceed PostgREST's ~1000-row cap.
    const odooMsgIdsInChunk = messages.map((m) => String(m.id));
    const commentByOdooMsgId = new Map<number, { id: string; project_id: string }>();
    for (let j = 0; j < odooMsgIdsInChunk.length; j += 1000) {
      const idSlice = odooMsgIdsInChunk.slice(j, j + 1000);
      const { data: commentRows } = await supabaseAdmin
        .from("project_comments")
        .select("id, project_id, external_id")
        .eq("organization_id", ctx.organizationId)
        .eq("external_source", SOURCE)
        .in("external_id", idSlice)
        .range(0, idSlice.length - 1);
      for (const c of commentRows ?? []) {
        const n = Number(c.external_id);
        if (Number.isFinite(n)) commentByOdooMsgId.set(n, { id: c.id, project_id: c.project_id });
      }
    }

    type OdooAttachment = {
      id: number;
      name: string | false;
      mimetype: string | false;
      file_size: number | false;
      url: string | false;
    };
    const attachmentRows = await ctx.odoo.searchRead<OdooAttachment>(
      "ir.attachment",
      [["id", "in", attachmentIds]],
      ["id", "name", "mimetype", "file_size", "url"],
    );
    const attMetaById = new Map<number, OdooAttachment>();
    for (const a of attachmentRows) attMetaById.set(a.id, a);

    const attRowsToInsert: {
      organization_id: string;
      project_id: string;
      project_comment_id: string;
      filename: string;
      mimetype: string | null;
      size_bytes: number | null;
      storage_path: null;
      source_url: string;
      external_source: typeof SOURCE;
      external_id: string;
    }[] = [];
    for (const m of messages) {
      const ids = Array.isArray(m.attachment_ids) ? (m.attachment_ids as number[]) : [];
      if (ids.length === 0) continue;
      const link = commentByOdooMsgId.get(m.id);
      if (!link) continue;
      for (const aid of ids) {
        const meta = attMetaById.get(aid);
        if (!meta) continue;
        const filename = typeof meta.name === "string" && meta.name ? meta.name : `attachment-${aid}`;
        const mimetype = typeof meta.mimetype === "string" ? meta.mimetype : null;
        const size = typeof meta.file_size === "number" ? meta.file_size : null;
        const explicitUrl = typeof meta.url === "string" && meta.url ? meta.url : null;
        const sourceUrl = explicitUrl
          ? explicitUrl
          : odooBase
            ? `${odooBase}/web/content/${aid}?download=true`
            : "";
        if (!sourceUrl) continue;
        attRowsToInsert.push({
          organization_id: ctx.organizationId,
          project_id: link.project_id,
          project_comment_id: link.id,
          filename,
          mimetype,
          size_bytes: size,
          storage_path: null,
          source_url: sourceUrl,
          external_source: SOURCE,
          external_id: String(aid),
        });
      }
    }

    if (attRowsToInsert.length > 0) {
      const { error: attErr } = await supabaseAdmin
        .from("project_attachments")
        .upsert(attRowsToInsert, {
          onConflict: "organization_id,external_source,external_id",
        });
      if (attErr) {
        console.warn(`project_attachments chunk @${i}: ${attErr.message}`);
      }
    }
  }

  if (ctx.mode === "incremental" && maxSeenMsgId > startId) {
    await saveWatermark(ctx, "project_comments", { lastMessageId: maxSeenMsgId });
    console.log(`[odoo-import] project_comments incremental: ${imported} new, watermark→${maxSeenMsgId}`);
  }

  return imported;
}

// The core import is split into phases so a single Vercel function (300s)
// never has to do all of it. Each phase rebuilds the ID maps it needs from
// already-synced rows via hydrateExistingMaps(), so they stitch together
// across separate cron invocations.
//   base     — employees, departments, HR, clients, services, tags
//   projects — projects (+ project tag assignments)
//   tasks    — tasks (+ task assignees + task tag assignments)
//   comments — task & project comments (chatter / notes)
export type ImportPhase = "base" | "projects" | "tasks" | "comments";
const ALL_IMPORT_PHASES: ImportPhase[] = ["base", "projects", "tasks", "comments"];

export async function runImport(
  odoo: OdooClient,
  organizationSlug: string,
  phases: ImportPhase[] = ALL_IMPORT_PHASES,
  mode: SyncMode = "full",
): Promise<ImportSummary> {
  const organizationId = await resolveOrganizationId(organizationSlug);
  const ctx: ImportContext = {
    organizationId,
    odoo,
    mode,
    employeeIdMap: new Map(),
    clientIdMap: new Map(),
    projectIdMap: new Map(),
    serviceIdMap: new Map(),
    tagIdMap: new Map(),
    departmentIdMap: new Map(),
    stageNameById: new Map(),
    unassignedClientId: null,
    odooUserToEmployee: new Map(),
    assigneeCount: 0,
  };

  const summary: ImportSummary = {
    employees: 0,
    clients: 0,
    projects: 0,
    tasks: 0,
    taskAssignees: 0,
    services: 0,
    tags: 0,
    tagAssignments: 0,
    taskComments: 0,
    projectComments: 0,
    departments: 0,
    employeesHydrated: 0,
    errors: [],
  };

  // Hydrate already-synced rows so partial / phased imports stitch together.
  await hydrateExistingMaps(ctx);
  const run = new Set(phases);

  if (run.has("base")) {
    try {
      summary.employees = await importEmployees(ctx);
    } catch (e) {
      summary.errors.push(`employees: ${(e as Error).message}`);
    }
    // Departments + HR records: order is departments → employee-HR backfill so
    // emp_profile.department_id can resolve a uuid. Both before clients/projects
    // since neither downstream entity depends on hr data, but having dept and
    // position populated keeps the rest of the import logging more useful.
    try {
      summary.departments = await importDepartments(ctx);
    } catch (e) {
      summary.errors.push(`departments: ${(e as Error).message}`);
    }
    try {
      summary.employeesHydrated = await importEmployeeHR(ctx);
    } catch (e) {
      summary.errors.push(`employee_hr: ${(e as Error).message}`);
    }
    try {
      summary.clients = await importClients(ctx);
    } catch (e) {
      summary.errors.push(`clients: ${(e as Error).message}`);
    }
    try {
      summary.services = await importServices(ctx);
    } catch (e) {
      summary.errors.push(`services: ${(e as Error).message}`);
    }
    // Tags must load before projects so syncProjectTagAssignments can resolve them.
    try {
      summary.tags = await importProjectTags(ctx);
    } catch (e) {
      summary.errors.push(`tags: ${(e as Error).message}`);
    }
  }

  if (run.has("projects")) {
    try {
      summary.projects = await importProjects(ctx);
    } catch (e) {
      summary.errors.push(`projects: ${(e as Error).message}`);
    }
  }

  if (run.has("tasks")) {
    try {
      summary.tasks = await importTasks(ctx);
      summary.taskAssignees = ctx.assigneeCount;
    } catch (e) {
      summary.errors.push(`tasks: ${(e as Error).message}`);
    }
  }

  if (run.has("comments")) {
    try {
      summary.taskComments = await importTaskComments(ctx);
    } catch (e) {
      summary.errors.push(`task_comments: ${(e as Error).message}`);
    }
    try {
      summary.projectComments = await importProjectComments(ctx);
    } catch (e) {
      summary.errors.push(`project_comments: ${(e as Error).message}`);
    }
  }

  return summary;
}

function newImportContext(organizationId: string, odoo: OdooClient): ImportContext {
  return {
    organizationId,
    odoo,
    mode: "full",
    employeeIdMap: new Map(),
    clientIdMap: new Map(),
    projectIdMap: new Map(),
    serviceIdMap: new Map(),
    tagIdMap: new Map(),
    departmentIdMap: new Map(),
    stageNameById: new Map(),
    unassignedClientId: null,
    odooUserToEmployee: new Map(),
    assigneeCount: 0,
  };
}

// On-demand single-project pull (the "Pull from Rwasem" button on a project).
// Refreshes that one project's row — status, dates, specialists, counters,
// tags, services, members — without touching anything else.
export async function syncOneProject(
  odoo: OdooClient,
  organizationSlug: string,
  odooProjectId: number,
): Promise<{ ok: boolean; error?: string; projectId?: string }> {
  const organizationId = await resolveOrganizationId(organizationSlug);
  const ctx = newImportContext(organizationId, odoo);
  await hydrateExistingMaps(ctx);
  // Tag + service maps drive the project's chip links.
  try {
    await importProjectTags(ctx);
  } catch (e) {
    console.warn(`syncOneProject tags: ${(e as Error).message}`);
  }
  try {
    await importServices(ctx);
  } catch (e) {
    console.warn(`syncOneProject services: ${(e as Error).message}`);
  }

  const rows = await odoo.searchRead<OdooProject>(
    "project.project",
    [["id", "=", odooProjectId]],
    PROJECT_FIELDS,
    { context: { active_test: false } },
  );
  if (rows.length === 0) {
    return { ok: false, error: `لم يُعثر على المشروع ${odooProjectId} في Rwasem` };
  }
  const p = rows[0];

  let clientUuid: string | undefined;
  if (p.partner_id) clientUuid = ctx.clientIdMap.get(p.partner_id[0]);
  if (!clientUuid) clientUuid = await ensureUnassignedClient(ctx);

  const { data, error } = await supabaseAdmin
    .from("projects")
    .upsert(buildProjectRow(ctx, p, clientUuid), {
      onConflict: "organization_id,external_source,external_id",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "upsert failed" };
  ctx.projectIdMap.set(p.id, data.id);

  await syncProjectTagAssignments(ctx, data.id, Array.isArray(p.tag_ids) ? p.tag_ids : []);
  await syncProjectServiceLinks(ctx, data.id, Array.isArray(p.category_ids) ? p.category_ids : []);
  await syncProjectMembers(ctx, data.id, Array.isArray(p.favorite_user_ids) ? p.favorite_user_ids : []);

  console.log(`[odoo-pull] project ${odooProjectId} → ${data.id}`);
  return { ok: true, projectId: data.id };
}

// On-demand single-task pull (the "Pull from Rwasem" button on a task).
// Refreshes the task record (stage/fields), its assignees, tags, comments and
// stage-transition history — the things that actually change on a task.
export async function syncOneTask(
  odoo: OdooClient,
  organizationSlug: string,
  odooTaskId: number,
): Promise<{ ok: boolean; error?: string; taskId?: string; comments?: number }> {
  const organizationId = await resolveOrganizationId(organizationSlug);
  const ctx = newImportContext(organizationId, odoo);
  await hydrateExistingMaps(ctx);
  await loadStages(ctx);
  try {
    await importProjectTags(ctx);
  } catch (e) {
    console.warn(`syncOneTask tags: ${(e as Error).message}`);
  }

  const rows = await odoo.searchRead<OdooTask>(
    "project.task",
    [["id", "=", odooTaskId]],
    TASK_FIELDS,
    { context: { active_test: false } },
  );
  if (rows.length === 0) {
    return { ok: false, error: `لم يُعثر على المهمة ${odooTaskId} في Rwasem` };
  }
  const t = rows[0];
  if (!t.project_id) return { ok: false, error: "المهمة بدون مشروع" };

  // Parent project must be synced first so the task's project_id resolves.
  let projectUuid = ctx.projectIdMap.get(t.project_id[0]);
  if (!projectUuid) {
    const pr = await syncOneProject(odoo, organizationSlug, t.project_id[0]);
    if (!pr.ok || !pr.projectId) {
      return { ok: false, error: `تعذّر مزامنة المشروع الأب: ${pr.error}` };
    }
    projectUuid = pr.projectId;
    ctx.projectIdMap.set(t.project_id[0], projectUuid);
  }

  // Build the row; preserve existing task_code or assign the next per-project
  // number (mirrors the sequencing in importTasks).
  const row = buildTaskRow(ctx, t, projectUuid);
  const { data: existing } = await supabaseAdmin
    .from("tasks")
    .select("task_code, code_seq")
    .eq("organization_id", organizationId)
    .eq("external_source", SOURCE)
    .eq("external_id", String(odooTaskId))
    .maybeSingle();
  if (existing?.task_code) {
    row.task_code = existing.task_code;
    row.code_seq = existing.code_seq;
  } else {
    let maxNum = 0;
    const { data: sib } = await supabaseAdmin
      .from("tasks")
      .select("task_code, code_seq")
      .eq("organization_id", organizationId)
      .eq("project_id", projectUuid);
    for (const r of sib ?? []) {
      const suffix = (r.task_code as string | null)?.match(/-(\d+)$/);
      const num = Math.max(
        typeof r.code_seq === "number" ? r.code_seq : 0,
        suffix ? Number(suffix[1]) : 0,
      );
      if (num > maxNum) maxNum = num;
    }
    const { data: proj } = await supabaseAdmin
      .from("projects")
      .select("project_code")
      .eq("id", projectUuid)
      .maybeSingle();
    const pcode = (proj?.project_code as string) ?? "PRJ-?";
    row.task_code = `${pcode}-${String(maxNum + 1).padStart(3, "0")}`;
    row.code_seq = maxNum + 1;
  }

  const { data, error } = await supabaseAdmin
    .from("tasks")
    .upsert(row, { onConflict: "organization_id,external_source,external_id" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "upsert failed" };
  const taskUuid = data.id as string;

  // Assignees — wipe agents, re-insert from user_ids; AM from the project.
  // team_manager_employee_id mirrors each employee's own قائد الفريق.
  await supabaseAdmin
    .from("task_assignees")
    .delete()
    .eq("task_id", taskUuid)
    .eq("role_type", "agent");
  const agentIds = (Array.isArray(t.user_ids) ? t.user_ids : [])
    .map((uid) => ctx.odooUserToEmployee.get(uid))
    .filter((x): x is string => Boolean(x));
  const leaderByEmp = new Map<string, string | null>();
  const { data: projRole } = await supabaseAdmin
    .from("projects")
    .select("account_manager_employee_id")
    .eq("id", projectUuid)
    .maybeSingle();
  const amId = (projRole?.account_manager_employee_id as string | null) ?? null;
  const leaderLookupIds = [...new Set([...agentIds, ...(amId ? [amId] : [])])];
  if (leaderLookupIds.length > 0) {
    const { data: lr } = await supabaseAdmin
      .from("employee_profiles")
      .select("id, team_leader_employee_id")
      .in("id", leaderLookupIds);
    for (const r of lr ?? []) {
      leaderByEmp.set(r.id as string, (r.team_leader_employee_id as string | null) ?? null);
    }
  }
  const leaderFor = (eid: string): string | null => {
    const l = leaderByEmp.get(eid) ?? null;
    return l && l !== eid ? l : null;
  };
  const assigneeInserts: {
    organization_id: string;
    task_id: string;
    employee_id: string;
    role_type: "agent" | "account_manager";
    team_manager_employee_id: string | null;
  }[] = [];
  for (const eid of agentIds) {
    if (amId && eid === amId) continue;
    assigneeInserts.push({
      organization_id: organizationId,
      task_id: taskUuid,
      employee_id: eid,
      role_type: "agent",
      team_manager_employee_id: leaderFor(eid),
    });
  }
  if (amId) {
    const { data: hasAm } = await supabaseAdmin
      .from("task_assignees")
      .select("id")
      .eq("task_id", taskUuid)
      .eq("role_type", "account_manager")
      .maybeSingle();
    if (!hasAm) {
      assigneeInserts.push({
        organization_id: organizationId,
        task_id: taskUuid,
        employee_id: amId,
        role_type: "account_manager",
        team_manager_employee_id: leaderFor(amId),
      });
    }
  }
  if (assigneeInserts.length > 0) {
    const { error: aerr } = await supabaseAdmin.from("task_assignees").insert(assigneeInserts);
    if (aerr) console.warn(`syncOneTask assignees: ${aerr.message}`);
  }

  // Tags — wipe + re-insert.
  await supabaseAdmin.from("task_tag_assignments").delete().eq("task_id", taskUuid);
  const tagInserts = (Array.isArray(t.tag_ids) ? t.tag_ids : [])
    .map((tid) => ctx.tagIdMap.get(tid))
    .filter((x): x is string => Boolean(x))
    .map((tagUuid) => ({
      organization_id: organizationId,
      task_id: taskUuid,
      tag_id: tagUuid,
    }));
  if (tagInserts.length > 0) {
    const { error: terr } = await supabaseAdmin.from("task_tag_assignments").insert(tagInserts);
    if (terr) console.warn(`syncOneTask tags: ${terr.message}`);
  }

  // Comments + stage-transition history for this single task.
  let comments = 0;
  try {
    comments = await importTaskComments(ctx, { onlyOdooTaskIds: [odooTaskId] });
  } catch (e) {
    console.warn(`syncOneTask comments: ${(e as Error).message}`);
  }
  try {
    await syncStageHistory(odoo, organizationSlug, { onlyOdooTaskIds: [odooTaskId] });
  } catch (e) {
    console.warn(`syncOneTask stage-history: ${(e as Error).message}`);
  }

  console.log(`[odoo-pull] task ${odooTaskId} → ${taskUuid} (${comments} comments)`);
  return { ok: true, taskId: taskUuid, comments };
}

// Lightweight delete-reconciliation, decoupled from the slow full re-import.
//
// The every-2h incremental runs upsert only CHANGED rows and never delete, so
// rows hard-deleted in Odoo would linger forever. Running the old "full" import
// nightly to catch them is not viable — re-upserting all 200 projects alone
// takes ~20min (4 RPCs/project) and would time out on Vercel exactly like
// before. Instead this fetches only Odoo's current id SETS (one cheap id-only
// read per model) and removes orphans, which finishes in seconds.
//
//   • projects not in Odoo  → archived (chatter on deleted engagements is kept,
//                             matching the full-mode behaviour).
//   • tasks not in Odoo     → hard-deleted (child rows cascade).
//   • native rows (external_source is null) → deleted; Odoo is authoritative.
//
// Guarded: if an Odoo id fetch fails, that model's deletes are skipped so a
// transient read error can never wipe live data.
export async function reconcileOdooDeletions(
  odoo: OdooClient,
  organizationSlug: string,
): Promise<{
  projectsArchived: number;
  projectsDeleted: number;
  tasksDeleted: number;
  errors: string[];
}> {
  const organizationId = await resolveOrganizationId(organizationSlug);
  const errors: string[] = [];
  let projectsArchived = 0;
  let projectsDeleted = 0;
  let tasksDeleted = 0;
  const DEL = 500;
  const PAGE = 1000;

  // ── Projects ───────────────────────────────────────────────────────────
  try {
    const odooProjects = await odoo.searchRead<{ id: number }>(
      "project.project",
      [["active", "in", [true, false]]],
      ["id"],
      { limit: 100000, context: { active_test: false } },
    );
    const liveIds = new Set(odooProjects.map((p) => p.id));
    const staleIds: string[] = [];
    const nativeIds: string[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await supabaseAdmin
        .from("projects")
        .select("id, external_id, external_source, status")
        .eq("organization_id", organizationId)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        if (r.external_source == null) {
          nativeIds.push(r.id as string);
        } else if (r.external_source === SOURCE) {
          const ext = r.external_id == null ? NaN : Number(r.external_id);
          if ((!Number.isFinite(ext) || !liveIds.has(ext)) && r.status !== "archived") {
            staleIds.push(r.id as string);
          }
        }
      }
      if (rows.length < PAGE) break;
    }
    for (let i = 0; i < staleIds.length; i += DEL) {
      const { error } = await supabaseAdmin
        .from("projects")
        .update({ status: "archived" })
        .in("id", staleIds.slice(i, i + DEL));
      if (error) errors.push(`archive projects: ${error.message}`);
      else projectsArchived += Math.min(DEL, staleIds.length - i);
    }
    for (let i = 0; i < nativeIds.length; i += DEL) {
      const { error } = await supabaseAdmin
        .from("projects")
        .delete()
        .in("id", nativeIds.slice(i, i + DEL));
      if (error) errors.push(`delete native projects: ${error.message}`);
      else projectsDeleted += Math.min(DEL, nativeIds.length - i);
    }
  } catch (e) {
    errors.push(`projects reconcile skipped: ${(e as Error).message}`);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────
  try {
    const odooTasks = await odoo.searchRead<{ id: number }>(
      "project.task",
      [],
      ["id"],
      { limit: 1000000, context: { active_test: false } },
    );
    const liveIds = new Set(odooTasks.map((t) => t.id));
    const ghostIds: string[] = [];
    const nativeIds: string[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await supabaseAdmin
        .from("tasks")
        .select("id, external_id, external_source")
        .eq("organization_id", organizationId)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        if (r.external_source == null) {
          nativeIds.push(r.id as string);
        } else if (r.external_source === SOURCE) {
          const ext = r.external_id == null ? NaN : Number(r.external_id);
          if (!Number.isFinite(ext) || !liveIds.has(ext)) ghostIds.push(r.id as string);
        }
      }
      if (rows.length < PAGE) break;
    }
    for (const ids of [ghostIds, nativeIds]) {
      for (let i = 0; i < ids.length; i += DEL) {
        const { error } = await supabaseAdmin
          .from("tasks")
          .delete()
          .in("id", ids.slice(i, i + DEL));
        if (error) errors.push(`delete tasks: ${error.message}`);
        else tasksDeleted += Math.min(DEL, ids.length - i);
      }
    }
  } catch (e) {
    errors.push(`tasks reconcile skipped: ${(e as Error).message}`);
  }

  console.log(
    `[odoo-reconcile] projects archived=${projectsArchived} deleted=${projectsDeleted}; tasks deleted=${tasksDeleted}`,
  );
  return { projectsArchived, projectsDeleted, tasksDeleted, errors };
}

// Lightweight wrapper for the /service-categories "Sync from Odoo" button.
// Runs project.category → services AND mirrors each row into
// service_categories so the page UI (which reads service_categories) reflects
// the sync. Idempotent on both tables.
export async function runServicesImport(
  odoo: OdooClient,
  organizationSlug: string,
): Promise<{ services: number; categories: number; errors: string[] }> {
  const organizationId = await resolveOrganizationId(organizationSlug);
  const ctx: ImportContext = {
    organizationId,
    odoo,
    mode: "full",
    employeeIdMap: new Map(),
    clientIdMap: new Map(),
    projectIdMap: new Map(),
    serviceIdMap: new Map(),
    tagIdMap: new Map(),
    departmentIdMap: new Map(),
    stageNameById: new Map(),
    unassignedClientId: null,
    odooUserToEmployee: new Map(),
    assigneeCount: 0,
  };
  const errors: string[] = [];
  let serviceCount = 0;
  let categoryCount = 0;
  try {
    serviceCount = await importServices(ctx);
  } catch (e) {
    errors.push(`services: ${(e as Error).message}`);
    return { services: 0, categories: 0, errors };
  }
  try {
    categoryCount = await mirrorServicesToCategories(ctx);
  } catch (e) {
    errors.push(`categories: ${(e as Error).message}`);
  }
  return { services: serviceCount, categories: categoryCount, errors };
}

// For each Odoo-sourced row in `services`, ensure there's a matching row in
// `service_categories` so the /service-categories page surfaces it. Uses the
// service's slug as the unique `key` and copies name + color. Existing rows
// keyed on (organization_id, key) are updated in place; new rows are inserted.
async function mirrorServicesToCategories(
  ctx: ImportContext,
): Promise<number> {
  const { data: services, error } = await supabaseAdmin
    .from("services")
    .select("id, name, slug, external_id")
    .eq("organization_id", ctx.organizationId)
    .eq("external_source", SOURCE);
  if (error) throw new Error(error.message);

  const rows = (services ?? []).map((s) => ({
    organization_id: ctx.organizationId,
    service_id: s.id,
    key: s.slug as string,
    name_ar: s.name as string,
    is_active: true,
    external_source: SOURCE,
    external_id: s.external_id ?? null,
  }));
  if (rows.length === 0) return 0;

  const { error: upErr } = await supabaseAdmin
    .from("service_categories")
    .upsert(rows, { onConflict: "organization_id,key" });
  if (upErr) throw new Error(upErr.message);
  return rows.length;
}

async function hydrateExistingMaps(ctx: ImportContext): Promise<void> {
  const tables = [
    { name: "employee_profiles", map: ctx.employeeIdMap },
    { name: "clients", map: ctx.clientIdMap },
    { name: "projects", map: ctx.projectIdMap },
    { name: "services", map: ctx.serviceIdMap },
    { name: "project_tags", map: ctx.tagIdMap },
    { name: "departments", map: ctx.departmentIdMap },
  ] as const;
  for (const { name, map } of tables) {
    const { data } = await supabaseAdmin
      .from(name)
      .select("id, external_id")
      .eq("organization_id", ctx.organizationId)
      .eq("external_source", SOURCE);
    for (const row of data ?? []) {
      if (row.external_id != null) map.set(Number(row.external_id), row.id);
    }
  }
  // employee_profiles.external_id IS the Odoo res.users id (see importEmployees),
  // and task.user_ids / project members reference users by that same id. So the
  // employee map doubles as odooUserToEmployee — copy it across so the projects
  // and tasks phases resolve assignees even when run without the base phase.
  for (const [odooUserId, profileId] of ctx.employeeIdMap) {
    ctx.odooUserToEmployee.set(odooUserId, profileId);
  }

  // Hydrate the unassigned-client placeholder if it already exists.
  const { data: unassigned } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("external_source", SOURCE)
    .eq("external_id", UNASSIGNED_CLIENT_EXTERNAL_ID)
    .maybeSingle();
  if (unassigned) ctx.unassignedClientId = unassigned.id;
}
