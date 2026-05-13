// One-shot Odoo → Supabase importer.
//
// Order matters: employees → clients (partners) → projects → tasks.
// Every upsert is keyed on (organization_id, external_source='odoo', external_id),
// so re-running is safe.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { OdooClient } from "./client";
import {
  OdooEmployee,
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

export interface ImportContext {
  organizationId: string;
  odoo: OdooClient;
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
  type OdooUser = {
    id: number;
    name: string;
    login: string | false;
    active: boolean;
    share: boolean;
    partner_id: OdooMany2one;
  };
  const users = await ctx.odoo.searchRead<OdooUser>(
    "res.users",
    [["active", "=", true], ["share", "=", false]],
    ["id", "name", "login", "active", "share", "partner_id"],
    { limit: 500 },
  );

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
  for (const u of users) {
    const partner = u.partner_id ? partnerMap.get(u.partner_id[0]) : undefined;
    const row = {
      organization_id: ctx.organizationId,
      external_source: SOURCE,
      external_id: u.id,
      full_name: u.name,
      email: nullable(u.login),
      phone: nullable(partner?.phone) ?? nullable(partner?.mobile),
      job_title: nullable(partner?.function),
      avatar_url: odooBase ? `${odooBase}/web/image/res.users/${u.id}/avatar_1` : null,
      employment_status: "active",
    };
    const { data, error } = await supabaseAdmin
      .from("employee_profiles")
      .upsert(row, {
        onConflict: "organization_id,external_source,external_id",
      })
      .select("id")
      .single();
    if (error) throw new Error(`user ${u.id} (${u.name}): ${error.message}`);
    ctx.employeeIdMap.set(u.id, data.id);
    // res.users.id is the same id used in task.user_ids — direct mapping.
    ctx.odooUserToEmployee.set(u.id, data.id);
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
    // Org-chart fields (department_id, manager_employee_id, head_employee_id)
    // are owned by the dashboard's /organization pages — Odoo's HR data is
    // sparser than the operations PDF, so we only seed these when the local
    // row is still null. Once set in the dashboard, Odoo will never overwrite.
    // Phone / job_title remain always-refreshed; Odoo's hr.employee is the
    // authoritative source for those.
    const refreshable: Record<string, unknown> = {};
    if (e.work_phone) refreshable.phone = e.work_phone;
    if (jobName && jobName.length > 0) refreshable.job_title = jobName;

    if (Object.keys(refreshable).length > 0) {
      const { error } = await supabaseAdmin
        .from("employee_profiles")
        .update(refreshable)
        .eq("id", empProfileId);
      if (error) {
        console.warn(`[odoo-import] employee_hr ${e.id} (${e.name}): ${error.message}`);
        continue;
      }
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
    const stripped = c.name
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
      name: c.name,
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

async function importProjects(ctx: ImportContext): Promise<number> {
  // Pull both active and archived projects so the chatter on completed
  // engagements remains accessible in the dashboard. Archived rows get
  // status='archived' on insert (see below); the existing reconciliation
  // pass at the bottom of this function still flips status for projects
  // that were active when last synced and have since been deactivated.
  // The default Odoo ORM context applies `active_test=true` which would
  // otherwise drop archived rows even when the domain includes them.
  const projects = await ctx.odoo.searchRead<OdooProject>(
    "project.project",
    [["active", "in", [true, false]]],
    [
      "id",
      "name",
      "active",
      "partner_id",
      "user_id",
      "date_start",
      "date",
      "description",
      // Rwasem custom fields used by the projects list UI
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
      // gap-fill from migration 0070
      "site_address",
      "site_address_display",
      "site_latitude",
      "site_longitude",
      "financial_info",
      "total_progress",
      "document_count",
      "has_active_category",
      // Sky Light fills these in on every project; date_start/date are mostly blank.
      "ks_project_start",
      "ks_project_end",
    ],
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

    // Odoo user_id is the project manager; account_manager_id is the
    // separate Rwasem custom field. They were previously conflated.
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

    const row = {
      organization_id: ctx.organizationId,
      external_source: SOURCE,
      external_id: p.id,
      name: p.name,
      client_id: clientUuid,
      project_manager_employee_id: projectManagerUuid,
      account_manager_employee_id: accountManagerUuid,
      social_specialist_id: socialSpecialistUuid,
      media_specialist_id: mediaSpecialistUuid,
      seo_specialist_id: seoSpecialistUuid,
      // Date fields: Sky Light uses ks_project_start/end (Ksolves Gantt
      // addon) as their primary contract dates. date_start/date are
      // filled on only 8/75 active projects. Prefer the ks_* values when
      // present, fall back to the standard fields. ks_* are datetimes —
      // slice to YYYY-MM-DD for our `date` column.
      start_date:
        (typeof p.ks_project_start === "string" && p.ks_project_start
          ? p.ks_project_start.slice(0, 10)
          : null) ?? nullable(p.date_start),
      end_date:
        (typeof p.ks_project_end === "string" && p.ks_project_end
          ? p.ks_project_end.slice(0, 10)
          : null) ?? nullable(p.date),
      description: nullable(p.description),
      // Mirror Odoo's archive flag: an `active=false` project becomes
      // `status='archived'` here so the dashboard UI can hide it from
      // active-only views while still keeping its tasks + chatter reachable.
      status: p.active === false ? "archived" : "active",
      priority: "medium",
      store_name: nullable(p.store_name),
      target,
      color: typeof p.color === "number" ? p.color : 0,
      is_favorite: Boolean(p.is_favorite),
      last_update_status: nullable(p.last_update_status),
      last_update_color: typeof p.last_update_color === "number" ? p.last_update_color : null,
      // 0070 fields
      site_address: nullable(p.site_address),
      site_address_display: nullable(p.site_address_display),
      site_latitude: typeof p.site_latitude === "number" ? p.site_latitude : null,
      site_longitude: typeof p.site_longitude === "number" ? p.site_longitude : null,
      financial_info: nullable(p.financial_info),
      total_progress: typeof p.total_progress === "number" ? p.total_progress : 0,
      document_count: typeof p.document_count === "number" ? p.document_count : 0,
      has_active_category: Boolean(p.has_active_category),
      // Sky Light's Odoo prints project_code as "PRJ-" + lpad(odoo_id, 5, '0').
      // We mirror the same format so screenshots line up between systems.
      project_code: `PRJ-${String(p.id).padStart(5, "0")}`,
    };
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

  const { data: services } = await supabaseAdmin
    .from("services")
    .select("id, external_id, name, slug")
    .eq("organization_id", ctx.organizationId);
  const serviceKindById = new Map<string, "social" | "media" | "seo" | null>();
  for (const s of services ?? []) {
    const ext = s.external_id ? Number(s.external_id) : null;
    let kind: "social" | "media" | "seo" | null = null;
    if (ext === 234 || ext === 158) kind = "social";
    else if (ext === 134 || ext === 69) kind = "media";
    else if (ext === 235 || ext === 71) kind = "seo";
    else {
      const haystack = `${s.name ?? ""} ${s.slug ?? ""}`.toLowerCase();
      if (haystack.includes("social") || haystack.includes("سوشيال") || haystack.includes("التواصل")) {
        kind = "social";
      } else if (
        haystack.includes("media") ||
        haystack.includes("ممولة") ||
        haystack.includes("إعلانات") ||
        haystack.includes("ads")
      ) {
        kind = "media";
      } else if (haystack.includes("seo") || haystack.includes("سيو") || haystack.includes("تحسين")) {
        kind = "seo";
      }
    }
    serviceKindById.set(s.id as string, kind);
  }

  // Batch the project filter to keep each RPC well under Odoo's read timeout.
  // A single `project_id IN (76 ids)` request was returning >2 MB and timing
  // out on the Rwasem instance.
  const TASK_FIELDS = [
    "id",
    "name",
    "active",
    "project_id",
    "stage_id",
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
    // 0069 gap-fill
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
  ];
  const PROJECTS_PER_BATCH = 10;
  const tasks: OdooTask[] = [];
  for (let i = 0; i < projectOdooIds.length; i += PROJECTS_PER_BATCH) {
    const slice = projectOdooIds.slice(i, i + PROJECTS_PER_BATCH);
    try {
      const rows = await ctx.odoo.searchRead<OdooTask>(
        "project.task",
        [["project_id", "in", slice]],
        TASK_FIELDS,
        // active_test=false bypasses Odoo's implicit `active=true` filter so
        // archived tasks under archived projects flow through too.
        { limit: 5000, context: { active_test: false } },
      );
      tasks.push(...rows);
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
  };

  const stagedRows: TaskRowInput[] = [];
  for (const t of tasks) {
    if (!t.project_id) continue;
    const projectUuid = ctx.projectIdMap.get(t.project_id[0]);
    if (!projectUuid) continue;

    const stageName = t.stage_id ? ctx.stageNameById.get(t.stage_id[0]) : "New";
    const stage = mapStageName(stageName);
    const serviceUuid =
      t.category_id ? ctx.serviceIdMap.get(t.category_id[0]) ?? null : null;

    stagedRows.push({
      odoo_id: t.id,
      projectUuid,
      row: {
        organization_id: ctx.organizationId,
        external_source: SOURCE,
        external_id: t.id,
        project_id: projectUuid,
        service_id: serviceUuid,
        title: t.name,
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
        working_days_open:
          typeof t.working_days_open === "number" ? t.working_days_open : null,
        working_days_close:
          typeof t.working_days_close === "number" ? t.working_days_close : null,
        duration_tracking:
          t.duration_tracking && typeof t.duration_tracking === "object"
            ? t.duration_tracking
            : null,
        actual_done_date:
          typeof t.actual_done_date === "string"
            ? t.actual_done_date.slice(0, 10)
            : null,
        delay_days: typeof t.delay_days === "number" ? t.delay_days : null,
        is_overdue: typeof t.is_overdue === "boolean" ? t.is_overdue : null,
        design_count: typeof t.design_count === "number" ? t.design_count : 0,
        document_count: typeof t.document_count === "number" ? t.document_count : 0,
        email_cc: nullable(t.email_cc),
        archived_at: t.active === false ? new Date().toISOString() : null,
      },
      agentEmployeeIds: (Array.isArray(t.user_ids) ? t.user_ids : [])
        .map((uid) => ctx.odooUserToEmployee.get(uid))
        .filter((x): x is string => Boolean(x)),
      amEmployeeId: projectRoleById.get(projectUuid)?.accountManagerId ?? null,
    });
  }

  if (stagedRows.length === 0) return 0;

  // 1) Bulk-upsert tasks in chunks of 200.
  const TASK_CHUNK = 200;
  const odooToTaskUuid = new Map<number, string>();
  for (let i = 0; i < stagedRows.length; i += TASK_CHUNK) {
    const chunk = stagedRows.slice(i, i + TASK_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .upsert(
        chunk.map((s) => s.row),
        { onConflict: "organization_id,external_source,external_id" },
      )
      .select("id, external_id");
    if (error) throw new Error(`tasks bulk upsert: ${error.message}`);
    for (const r of data ?? []) {
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
  for (const [taskUuid, s] of stagedByTaskUuid) {
    const projectRole = projectRoleById.get(s.projectUuid) ?? null;
    const serviceId = (s.row.service_id as string | null) ?? null;
    const serviceKind = serviceId ? (serviceKindById.get(serviceId) ?? null) : null;
    for (const eid of s.agentEmployeeIds) {
      if (s.amEmployeeId && eid === s.amEmployeeId) continue;
      const chooseManager = (candidate: string | null): string | null => {
        if (candidate && candidate !== eid) return candidate;
        if (projectRole?.projectManagerId && projectRole.projectManagerId !== eid) {
          return projectRole.projectManagerId;
        }
        return null;
      };
      const teamManagerEmployeeId =
        serviceKind === "social"
          ? chooseManager(projectRole?.socialManagerId ?? null)
          : serviceKind === "media"
            ? chooseManager(projectRole?.mediaManagerId ?? null)
            : serviceKind === "seo"
              ? chooseManager(projectRole?.seoManagerId ?? null)
              : chooseManager(projectRole?.projectManagerId ?? null);
      assigneeInserts.push({
        organization_id: ctx.organizationId,
        task_id: taskUuid,
        employee_id: eid,
        role_type: "agent",
        team_manager_employee_id:
          teamManagerEmployeeId && teamManagerEmployeeId !== eid
            ? teamManagerEmployeeId
            : null,
      });
    }
    if (s.amEmployeeId && !existingAMSet.has(taskUuid)) {
      assigneeInserts.push({
        organization_id: ctx.organizationId,
        task_id: taskUuid,
        employee_id: s.amEmployeeId,
        role_type: "account_manager",
        team_manager_employee_id:
          projectRole?.projectManagerId && projectRole.projectManagerId !== s.amEmployeeId
            ? projectRole.projectManagerId
            : null,
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

  return stagedRows.length;
}

// Mirror Odoo task chatter (mail.message) into task_comments so notes are
// searchable and cached locally. Idempotent on (org, external_source, external_id).
async function importTaskComments(ctx: ImportContext): Promise<number> {
  // Build Odoo task id → Supabase task uuid map by hydrating from the DB.
  const { data: taskRows } = await supabaseAdmin
    .from("tasks")
    .select("id, external_id")
    .eq("organization_id", ctx.organizationId)
    .eq("external_source", SOURCE);
  const taskUuidByOdooId = new Map<number, string>();
  for (const r of taskRows ?? []) {
    if (r.external_id != null) {
      const n = Number(r.external_id);
      if (Number.isFinite(n)) taskUuidByOdooId.set(n, r.id as string);
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
  for (let i = 0; i < odooTaskIds.length; i += CHUNK) {
    const slice = odooTaskIds.slice(i, i + CHUNK);
    const messages = await ctx.odoo.searchRead<OdooMessage>(
      "mail.message",
      [
        ["model", "=", "project.task"],
        ["res_id", "in", slice],
        // Pull comments/emails AND notifications (which carry stage/priority/
        // assignee tracking changes via tracking_value_ids).
        ["message_type", "in", ["comment", "email", "notification"]],
      ],
      [
        "id", "res_id", "body", "author_id", "date", "message_type",
        "subtype_id", "tracking_value_ids", "attachment_ids",
      ],
      { limit: 5000, order: "date asc" },
    );

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
          if (tvs.length === 0) return null;
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

    const { error } = await supabaseAdmin
      .from("task_comments")
      .upsert(rows, { onConflict: "organization_id,external_source,external_id" });
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

    // Map Odoo message id → Supabase comment uuid for this chunk.
    const odooMsgIdsInChunk = messages.map((m) => String(m.id));
    const { data: commentRows } = await supabaseAdmin
      .from("task_comments")
      .select("id, task_id, external_id")
      .eq("organization_id", ctx.organizationId)
      .eq("external_source", SOURCE)
      .in("external_id", odooMsgIdsInChunk);
    const commentByOdooMsgId = new Map<number, { id: string; task_id: string }>();
    for (const c of commentRows ?? []) {
      const n = Number(c.external_id);
      if (Number.isFinite(n)) commentByOdooMsgId.set(n, { id: c.id, task_id: c.task_id });
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

  return imported;
}

// Mirror Odoo project chatter (mail.message on project.project) into
// project_comments + project_attachments, parallel to importTaskComments.
// Same idempotency contract: (organization_id, external_source, external_id).
async function importProjectComments(ctx: ImportContext): Promise<number> {
  const { data: projectRows } = await supabaseAdmin
    .from("projects")
    .select("id, external_id")
    .eq("organization_id", ctx.organizationId)
    .eq("external_source", SOURCE);
  const projectUuidByOdooId = new Map<number, string>();
  for (const r of projectRows ?? []) {
    if (r.external_id != null) {
      const n = Number(r.external_id);
      if (Number.isFinite(n)) projectUuidByOdooId.set(n, r.id as string);
    }
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

  for (let i = 0; i < odooProjectIds.length; i += CHUNK) {
    const slice = odooProjectIds.slice(i, i + CHUNK);
    const messages = await ctx.odoo.searchRead<OdooMessage>(
      "mail.message",
      [
        ["model", "=", "project.project"],
        ["res_id", "in", slice],
        // Project chatter is normally human comments/emails; notification
        // tracking on projects is rare so we focus on real notes here.
        ["message_type", "in", ["comment", "email"]],
      ],
      [
        "id", "res_id", "body", "author_id", "date", "message_type",
        "subtype_id", "attachment_ids",
      ],
      { limit: 5000, order: "date asc" },
    );

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

    const { error } = await supabaseAdmin
      .from("project_comments")
      .upsert(rows, { onConflict: "organization_id,external_source,external_id" });
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

    const odooMsgIdsInChunk = messages.map((m) => String(m.id));
    const { data: commentRows } = await supabaseAdmin
      .from("project_comments")
      .select("id, project_id, external_id")
      .eq("organization_id", ctx.organizationId)
      .eq("external_source", SOURCE)
      .in("external_id", odooMsgIdsInChunk);
    const commentByOdooMsgId = new Map<number, { id: string; project_id: string }>();
    for (const c of commentRows ?? []) {
      const n = Number(c.external_id);
      if (Number.isFinite(n)) commentByOdooMsgId.set(n, { id: c.id, project_id: c.project_id });
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

  return imported;
}

export async function runImport(
  odoo: OdooClient,
  organizationSlug: string,
): Promise<ImportSummary> {
  const organizationId = await resolveOrganizationId(organizationSlug);
  const ctx: ImportContext = {
    organizationId,
    odoo,
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

  // Hydrate already-synced rows so partial imports stitch together.
  await hydrateExistingMaps(ctx);

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
  try {
    summary.projects = await importProjects(ctx);
  } catch (e) {
    summary.errors.push(`projects: ${(e as Error).message}`);
  }
  try {
    summary.tasks = await importTasks(ctx);
    summary.taskAssignees = ctx.assigneeCount;
  } catch (e) {
    summary.errors.push(`tasks: ${(e as Error).message}`);
  }
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

  return summary;
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
