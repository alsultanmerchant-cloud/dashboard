// Pulls Odoo project.favorite_user_ids into project_members so the dashboard
// card footer can show the member-avatar stack.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { OdooClient } from "@/lib/odoo/client";

export type ProjectMembersSyncResult = {
  totalMembers: number;
  touchedProjects: number;
};

export async function syncProjectMembers(
  odoo: OdooClient,
  orgSlug: string,
  opts: { log?: boolean } = {},
): Promise<ProjectMembersSyncResult> {
  const log = opts.log ?? false;
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .single();
  if (!org) throw new Error(`org ${orgSlug} not found`);
  const orgId = org.id as string;

  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id, external_id")
    .eq("organization_id", orgId)
    .eq("external_source", "odoo");
  const projectMap = new Map<number, string>();
  for (const p of projects ?? []) {
    if (p.external_id) {
      const n = Number(p.external_id);
      if (Number.isFinite(n)) projectMap.set(n, p.id as string);
    }
  }

  const { data: emps } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, external_id")
    .eq("organization_id", orgId)
    .eq("external_source", "odoo");
  const employeeMap = new Map<number, string>();
  for (const e of emps ?? []) {
    if (e.external_id) {
      const n = Number(e.external_id);
      if (Number.isFinite(n)) employeeMap.set(n, e.id as string);
    }
  }

  const odooProjectIds = Array.from(projectMap.keys());
  if (odooProjectIds.length === 0) return { totalMembers: 0, touchedProjects: 0 };

  const projectsWithMembers = await odoo.searchRead<{
    id: number;
    favorite_user_ids: number[] | false;
  }>(
    "project.project",
    [["id", "in", odooProjectIds]],
    ["id", "favorite_user_ids"],
    { limit: 5000 },
  );

  let touchedProjects = 0;
  let totalMembers = 0;
  for (const p of projectsWithMembers) {
    const projectUuid = projectMap.get(p.id);
    if (!projectUuid) continue;
    const userIds = Array.isArray(p.favorite_user_ids) ? p.favorite_user_ids : [];

    await supabaseAdmin.from("project_members").delete().eq("project_id", projectUuid);

    const employeeUuids = Array.from(
      new Set(
        userIds
          .map((uid) => employeeMap.get(uid))
          .filter((x): x is string => Boolean(x)),
      ),
    );
    if (employeeUuids.length === 0) continue;

    const rows = employeeUuids.map((eid) => ({
      organization_id: orgId,
      project_id: projectUuid,
      employee_id: eid,
      role_label: "member",
    }));
    const { error } = await supabaseAdmin.from("project_members").insert(rows);
    if (error) {
      if (log) console.warn(`[members] project ${p.id}: ${error.message}`);
    } else {
      touchedProjects++;
      totalMembers += rows.length;
    }
  }

  if (log) console.log(`[members] DONE — ${totalMembers} memberships across ${touchedProjects} projects`);
  return { totalMembers, touchedProjects };
}
