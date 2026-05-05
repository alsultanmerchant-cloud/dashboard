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
  const partnerIds = users.map((u) => u.partner_id?.[0]).filter((x): x is number => Boolean(x));
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
  // Customers only — Odoo flags them with customer_rank > 0.
  const partners = await ctx.odoo.searchRead<OdooPartner>(
    "res.partner",
    [
      ["customer_rank", ">", 0],
      ["is_company", "=", true],
    ],
    ["id", "name", "email", "phone", "mobile", "website", "comment"],
    { limit: 2000 },
  );

  for (const p of partners) {
    const row = {
      organization_id: ctx.organizationId,
      external_source: SOURCE,
      external_id: p.id,
      name: p.name,
      email: nullable(p.email),
      phone: nullable(p.phone) ?? nullable(p.mobile),
      company_website: nullable(p.website),
      notes: nullable(p.comment),
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

async function importProjects(ctx: ImportContext): Promise<number> {
  const projects = await ctx.odoo.searchRead<OdooProject>(
    "project.project",
    [["active", "=", true]],
    [
      "id",
      "name",
      "partner_id",
      "user_id",
      "date_start",
      "date",
      "description",
    ],
    { limit: 1000 },
  );

  let imported = 0;
  for (const p of projects) {
    // Resolve client: real partner if linked, else fall back to a placeholder
    // "Unassigned Client" so the project still imports. This catches Sky Light
    // projects that exist in Odoo without partner_id (common in their data).
    let clientUuid: string | undefined;
    if (p.partner_id) {
      clientUuid = ctx.clientIdMap.get(p.partner_id[0]);
    }
    if (!clientUuid) {
      clientUuid = await ensureUnassignedClient(ctx);
    }

    const accountManagerUuid =
      p.user_id && ctx.employeeIdMap.get(p.user_id[0])
        ? ctx.employeeIdMap.get(p.user_id[0])!
        : null;

    const row = {
      organization_id: ctx.organizationId,
      external_source: SOURCE,
      external_id: p.id,
      name: p.name,
      client_id: clientUuid,
      account_manager_employee_id: accountManagerUuid,
      start_date: nullable(p.date_start),
      end_date: nullable(p.date),
      description: nullable(p.description),
      status: "active",
      priority: "medium",
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
    imported++;
  }

  return imported;
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

  const tasks = await ctx.odoo.searchRead<OdooTask>(
    "project.task",
    [["project_id", "in", projectOdooIds]],
    [
      "id",
      "name",
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
    ],
    { limit: 5000 },
  );

  let imported = 0;
  for (const t of tasks) {
    if (!t.project_id) continue;
    const projectUuid = ctx.projectIdMap.get(t.project_id[0]);
    if (!projectUuid) continue;

    const stageName = t.stage_id ? ctx.stageNameById.get(t.stage_id[0]) : "New";
    const stage = mapStageName(stageName);

    const serviceUuid =
      t.category_id ? ctx.serviceIdMap.get(t.category_id[0]) ?? null : null;

    const row = {
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
    };
    const { data: taskRow, error } = await supabaseAdmin
      .from("tasks")
      .upsert(row, { onConflict: "organization_id,external_source,external_id" })
      .select("id")
      .single();
    if (error || !taskRow) throw new Error(`task ${t.id}: ${error?.message}`);

    // task_assignees: insert each user as 'agent' role (best-guess default).
    // Owner can re-slot via dashboard. We delete the existing 'agent' rows
    // for this task before reinserting so re-imports don't pile up duplicates.
    const userIds = Array.isArray(t.user_ids) ? t.user_ids : [];
    if (userIds.length > 0) {
      const employeeIds = userIds
        .map((uid) => ctx.odooUserToEmployee.get(uid))
        .filter((x): x is string => Boolean(x));

      // Wipe prior 'agent' rows for this task (keep specialist/manager/AM
      // assignments the owner may have set in the dashboard).
      await supabaseAdmin
        .from("task_assignees")
        .delete()
        .eq("task_id", taskRow.id)
        .eq("role_type", "agent");

      if (employeeIds.length > 0) {
        const assigneeRows = employeeIds.map((eid) => ({
          organization_id: ctx.organizationId,
          task_id: taskRow.id,
          employee_id: eid,
          role_type: "agent" as const,
        }));
        const { error: assignError } = await supabaseAdmin
          .from("task_assignees")
          .insert(assigneeRows);
        if (assignError) {
          // Don't fail the whole import on a single assignee conflict —
          // log + continue.
          console.warn(`task ${t.id} assignees: ${assignError.message}`);
        } else {
          ctx.assigneeCount += assigneeRows.length;
        }
      }
    }

    imported++;
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
    errors: [],
  };

  // Hydrate already-synced rows so partial imports stitch together.
  await hydrateExistingMaps(ctx);

  try {
    summary.employees = await importEmployees(ctx);
  } catch (e) {
    summary.errors.push(`employees: ${(e as Error).message}`);
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

  return summary;
}

async function hydrateExistingMaps(ctx: ImportContext): Promise<void> {
  const tables = [
    { name: "employee_profiles", map: ctx.employeeIdMap },
    { name: "clients", map: ctx.clientIdMap },
    { name: "projects", map: ctx.projectIdMap },
    { name: "services", map: ctx.serviceIdMap },
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
