// Mirror Odoo mail.followers rows where res_model='project.task' into
// public.task_followers.
//
// Non-destructive by design: task_followers has no external-source columns,
// so we insert only missing follower rows and preserve anything users already
// added inside the dashboard.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { OdooClient } from "@/lib/odoo/client";

export type TaskFollowersSyncResult = {
  inserted: number;
  skipped: number;
  alreadyPresent: number;
};

export async function syncTaskFollowers(
  odoo: OdooClient,
  orgSlug: string,
  opts: { log?: boolean } = {},
): Promise<TaskFollowersSyncResult> {
  const log = opts.log ?? false;
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .single();
  if (!org) throw new Error(`org ${orgSlug} not found`);
  const orgId = org.id as string;

  const taskMap = new Map<number, string>();
  const employeeMap = new Map<number, { employeeId: string; userId: string | null }>();
  const PAGE = 1000;

  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select("id, external_id")
      .eq("organization_id", orgId)
      .eq("external_source", "odoo")
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const t of data) {
      if (!t.external_id) continue;
      const n = Number(t.external_id);
      if (Number.isFinite(n)) taskMap.set(n, t.id as string);
    }
    if (data.length < PAGE) break;
  }

  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("employee_profiles")
      .select("id, external_id, user_id")
      .eq("organization_id", orgId)
      .eq("external_source", "odoo")
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const e of data) {
      if (!e.external_id) continue;
      const n = Number(e.external_id);
      if (Number.isFinite(n)) {
        employeeMap.set(n, {
          employeeId: e.id as string,
          userId: (e.user_id as string | null) ?? null,
        });
      }
    }
    if (data.length < PAGE) break;
  }

  type OdooUser = { id: number; partner_id: [number, string] | false };
  const users = await odoo.searchRead<OdooUser>(
    "res.users",
    [["share", "=", false]],
    ["id", "partner_id"],
    { limit: 1000 },
  );
  const partnerToUser = new Map<number, number>();
  for (const u of users) {
    const partnerId = Array.isArray(u.partner_id) ? u.partner_id[0] : null;
    if (partnerId) partnerToUser.set(partnerId, u.id);
  }

  type Follower = {
    id: number;
    res_id: number;
    partner_id: [number, string] | false;
  };

  const odooTaskIds = Array.from(taskMap.keys());
  const CHUNK = 200;
  let inserted = 0;
  let skipped = 0;
  let alreadyPresent = 0;

  for (let i = 0; i < odooTaskIds.length; i += CHUNK) {
    const slice = odooTaskIds.slice(i, i + CHUNK);
    const followers = await odoo.searchRead<Follower>(
      "mail.followers",
      [
        ["res_model", "=", "project.task"],
        ["res_id", "in", slice],
      ],
      ["id", "res_id", "partner_id"],
      { limit: 5000 },
    );
    if (followers.length === 0) continue;

    const taskUuids = Array.from(
      new Set(
        slice
          .map((odooTaskId) => taskMap.get(odooTaskId))
          .filter((x): x is string => Boolean(x)),
      ),
    );
    const existingKeys = new Set<string>();
    if (taskUuids.length > 0) {
      const { data: existing, error } = await supabaseAdmin
        .from("task_followers")
        .select("task_id, employee_id, user_id")
        .in("task_id", taskUuids);
      if (error) throw error;
      for (const row of existing ?? []) {
        if (row.employee_id) existingKeys.add(`emp:${row.task_id}:${row.employee_id}`);
        if (row.user_id) existingKeys.add(`user:${row.task_id}:${row.user_id}`);
      }
    }

    const rows = followers
      .map((f) => {
        const taskUuid = taskMap.get(f.res_id);
        if (!taskUuid) return null;
        const partnerId = Array.isArray(f.partner_id) ? f.partner_id[0] : null;
        if (!partnerId) {
          skipped++;
          return null;
        }
        const userExternalId = partnerToUser.get(partnerId);
        if (!userExternalId) {
          skipped++;
          return null;
        }
        const employee = employeeMap.get(userExternalId);
        if (!employee) {
          skipped++;
          return null;
        }

        const employeeKey = `emp:${taskUuid}:${employee.employeeId}`;
        const userKey = employee.userId ? `user:${taskUuid}:${employee.userId}` : null;
        if (existingKeys.has(employeeKey) || (userKey && existingKeys.has(userKey))) {
          alreadyPresent++;
          return null;
        }

        existingKeys.add(employeeKey);
        if (userKey) existingKeys.add(userKey);
        return {
          task_id: taskUuid,
          employee_id: employee.employeeId,
          user_id: employee.userId,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (rows.length === 0) continue;
    const { error } = await supabaseAdmin.from("task_followers").insert(rows);
    if (error) {
      if (log) console.warn(`[task-followers] chunk @${i}: ${error.message}`);
    } else {
      inserted += rows.length;
    }
  }

  if (log) {
    console.log(
      `[task-followers] DONE — inserted=${inserted}, skipped=${skipped}, alreadyPresent=${alreadyPresent}`,
    );
  }
  return { inserted, skipped, alreadyPresent };
}
