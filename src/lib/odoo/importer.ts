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
      // Rwasem custom fields used by the projects list UI
      "store_name",
      "account_manager_id",
      "target",
      "color",
      "is_favorite",
      "tag_ids",
      "category_ids",
      "favorite_user_ids",
      "last_update_status",
      "last_update_color",
    ],
    { limit: 1000 },
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
      start_date: nullable(p.date_start),
      end_date: nullable(p.date),
      description: nullable(p.description),
      status: "active",
      priority: "medium",
      store_name: nullable(p.store_name),
      target,
      color: typeof p.color === "number" ? p.color : 0,
      is_favorite: Boolean(p.is_favorite),
      last_update_status: nullable(p.last_update_status),
      last_update_color: typeof p.last_update_color === "number" ? p.last_update_color : null,
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

  // Batch the project filter to keep each RPC well under Odoo's read timeout.
  // A single `project_id IN (76 ids)` request was returning >2 MB and timing
  // out on the Rwasem instance.
  const TASK_FIELDS = [
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
        { limit: 2000 },
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
  };
  for (let i = 0; i < odooTaskIds.length; i += CHUNK) {
    const slice = odooTaskIds.slice(i, i + CHUNK);
    const messages = await ctx.odoo.searchRead<OdooMessage>(
      "mail.message",
      [
        ["model", "=", "project.task"],
        ["res_id", "in", slice],
        // Only user-authored content. Skip purely automated stage notifications;
        // the dashboard already tracks stage_history natively.
        ["message_type", "in", ["comment", "email"]],
      ],
      ["id", "res_id", "body", "author_id", "date", "message_type", "subtype_id"],
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

    const rows = messages
      .map((m) => {
        const taskUuid = taskUuidByOdooId.get(m.res_id);
        if (!taskUuid) return null;
        const body = typeof m.body === "string" ? m.body.trim() : "";
        if (!body) return null;
        const author = Array.isArray(m.author_id) ? m.author_id : null;
        const subtypeId = Array.isArray(m.subtype_id) ? (m.subtype_id[0] as number) : null;
        return {
          organization_id: ctx.organizationId,
          task_id: taskUuid,
          external_source: SOURCE,
          external_id: String(m.id),
          author_user_id: null,
          external_author_name: author ? String(author[1]) : null,
          external_author_avatar_url: author && odooBase
            ? `${odooBase}/web/image/res.partner/${author[0]}/avatar_1`
            : null,
          body,
          is_internal: subtypeId ? internalSubtypeIds.has(subtypeId) : true,
          kind: "note" as const,
          created_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
          updated_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
        };
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

  return summary;
}

async function hydrateExistingMaps(ctx: ImportContext): Promise<void> {
  const tables = [
    { name: "employee_profiles", map: ctx.employeeIdMap },
    { name: "clients", map: ctx.clientIdMap },
    { name: "projects", map: ctx.projectIdMap },
    { name: "services", map: ctx.serviceIdMap },
    { name: "project_tags", map: ctx.tagIdMap },
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
