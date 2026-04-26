// One-shot Odoo → Supabase importer.
//
// Order matters: employees → clients (partners) → projects → tasks.
// Every upsert is keyed on (organization_id, external_source='odoo', external_id),
// so re-running is safe.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { OdooClient } from "./client";
import {
  OdooEmployee,
  OdooPartner,
  OdooProject,
  OdooTask,
  OdooTaskStage,
  mapStageName,
} from "./types";

const SOURCE = "odoo";

export interface ImportContext {
  organizationId: string;
  odoo: OdooClient;
  /** Cache of Odoo id → Supabase uuid, populated as we go. */
  employeeIdMap: Map<number, string>;
  clientIdMap: Map<number, string>;
  projectIdMap: Map<number, string>;
  stageNameById: Map<number, string>;
}

export interface ImportSummary {
  employees: number;
  clients: number;
  projects: number;
  tasks: number;
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
  const employees = await ctx.odoo.searchRead<OdooEmployee>(
    "hr.employee",
    [["active", "=", true]],
    [
      "id",
      "name",
      "work_email",
      "work_phone",
      "job_title",
      "department_id",
      "parent_id",
    ],
    { limit: 1000 },
  );

  for (const emp of employees) {
    const row = {
      organization_id: ctx.organizationId,
      external_source: SOURCE,
      external_id: emp.id,
      full_name: emp.name,
      email: nullable(emp.work_email),
      phone: nullable(emp.work_phone),
      job_title: nullable(emp.job_title),
      employment_status: "active",
    };
    const { data, error } = await supabaseAdmin
      .from("employee_profiles")
      .upsert(row, {
        onConflict: "organization_id,external_source,external_id",
      })
      .select("id")
      .single();
    if (error) throw new Error(`employee ${emp.id}: ${error.message}`);
    ctx.employeeIdMap.set(emp.id, data.id);
  }

  // Second pass: wire up manager_employee_id now that every employee has a uuid.
  for (const emp of employees) {
    if (!emp.parent_id) continue;
    const managerUuid = ctx.employeeIdMap.get(emp.parent_id[0]);
    const selfUuid = ctx.employeeIdMap.get(emp.id);
    if (!managerUuid || !selfUuid) continue;
    await supabaseAdmin
      .from("employee_profiles")
      .update({ manager_employee_id: managerUuid })
      .eq("id", selfUuid);
  }

  return employees.length;
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
    if (!p.partner_id) continue; // dashboard requires client_id
    const clientUuid = ctx.clientIdMap.get(p.partner_id[0]);
    if (!clientUuid) continue;

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
      "date_deadline",
      "create_date",
      "date_end",
      "description",
      "priority",
      "progress_percentage",
      "expected_progress",
      "progress_slip",
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

    const row = {
      organization_id: ctx.organizationId,
      external_source: SOURCE,
      external_id: t.id,
      project_id: projectUuid,
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
    const { error } = await supabaseAdmin
      .from("tasks")
      .upsert(row, {
        onConflict: "organization_id,external_source,external_id",
      });
    if (error) throw new Error(`task ${t.id}: ${error.message}`);
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
    stageNameById: new Map(),
  };

  const summary: ImportSummary = {
    employees: 0,
    clients: 0,
    projects: 0,
    tasks: 0,
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
    summary.projects = await importProjects(ctx);
  } catch (e) {
    summary.errors.push(`projects: ${(e as Error).message}`);
  }
  try {
    summary.tasks = await importTasks(ctx);
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
}
