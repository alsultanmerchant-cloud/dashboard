#!/usr/bin/env bun
// HR-only sync: pull hr.department + hr.employee + hr.job from Odoo and
// backfill departments + employee_profiles.{department_id, position,
// manager_employee_id}. Useful for fast iteration without re-running the
// slow tasks + comments imports.

import { odooFromEnv } from "@/lib/odoo/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

const SOURCE = "odoo";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

console.log(`[hr-sync] target org: ${slug}`);

const { data: org } = await supabaseAdmin
  .from("organizations")
  .select("id")
  .eq("slug", slug)
  .single();
if (!org) {
  console.error(`org ${slug} not found`);
  process.exit(1);
}
const orgId = org.id as string;

const odoo = odooFromEnv();

// Build res.users.id → employee_profiles.id map from existing rows.
const { data: empRows } = await supabaseAdmin
  .from("employee_profiles")
  .select("id, external_source, external_id")
  .eq("organization_id", orgId)
  .eq("external_source", SOURCE);
const odooUserToEmp = new Map<number, string>();
for (const r of empRows ?? []) {
  if (r.external_id != null) odooUserToEmp.set(Number(r.external_id), r.id as string);
}
console.log(`[hr-sync] loaded ${odooUserToEmp.size} employee_profiles from prior sync`);

// === hr.department → public.departments ===
type OdooDepartment = {
  id: number;
  name: string;
  parent_id: [number, string] | false;
  manager_id: [number, string] | false;
};
console.log("[hr-sync] fetching hr.department…");
const departments = await odoo.searchRead<OdooDepartment>(
  "hr.department",
  [["active", "=", true]],
  ["id", "name", "parent_id", "manager_id"],
  { limit: 500 },
);
console.log(`[hr-sync] hr.department → ${departments.length} rows`);
const deptIdMap = new Map<number, string>();
for (const d of departments) {
  const slugify = `odoo-dept-${d.id}`;
  const { data, error } = await supabaseAdmin
    .from("departments")
    .upsert(
      {
        organization_id: orgId,
        external_source: SOURCE,
        external_id: String(d.id),
        name: d.name,
        slug: slugify,
        kind: "other",
      },
      { onConflict: "organization_id,external_source,external_id" },
    )
    .select("id")
    .single();
  if (error) {
    console.error(`dept ${d.id} (${d.name}): ${error.message}`);
    continue;
  }
  deptIdMap.set(d.id, data.id as string);
}
// Pass 2: parent_department_id
for (const d of departments) {
  if (!d.parent_id) continue;
  const child = deptIdMap.get(d.id);
  const parent = deptIdMap.get(d.parent_id[0]);
  if (!child || !parent) continue;
  await supabaseAdmin
    .from("departments")
    .update({ parent_department_id: parent })
    .eq("id", child);
}
console.log(`[hr-sync] wired ${deptIdMap.size} departments`);

// === hr.employee → employee_profiles backfill ===
type OdooHrEmployee = {
  id: number;
  name: string;
  user_id: [number, string] | false;
  department_id: [number, string] | false;
  job_id: [number, string] | false;
  parent_id: [number, string] | false;
  work_phone: string | false;
};
console.log("[hr-sync] fetching hr.employee…");
const hrEmployees = await odoo.searchRead<OdooHrEmployee>(
  "hr.employee",
  [["active", "=", true]],
  ["id", "name", "user_id", "department_id", "job_id", "parent_id", "work_phone"],
  { limit: 1000 },
);
console.log(`[hr-sync] hr.employee → ${hrEmployees.length} rows`);

// hr.job for clean position names
const jobIds = hrEmployees.map((e) => e.job_id ? e.job_id[0] : null).filter((x): x is number => Boolean(x));
type OdooJob = { id: number; name: string };
const jobs = jobIds.length
  ? await odoo.searchRead<OdooJob>(
      "hr.job",
      [["id", "in", Array.from(new Set(jobIds))]],
      ["id", "name"],
      { limit: 500 },
    )
  : [];
const jobNameById = new Map(jobs.map((j) => [j.id, j.name]));
console.log(`[hr-sync] hr.job → ${jobs.length} positions`);

// Pass 1: backfill department_id + position
const hrIdToEmp = new Map<number, string>();
let updated = 0;
let unmatched = 0;
for (const e of hrEmployees) {
  const uid = e.user_id ? e.user_id[0] : null;
  if (!uid) { unmatched += 1; continue; }
  const empId = odooUserToEmp.get(uid);
  if (!empId) { unmatched += 1; continue; }
  hrIdToEmp.set(e.id, empId);

  const deptOdooId = e.department_id ? e.department_id[0] : null;
  const deptId = deptOdooId ? (deptIdMap.get(deptOdooId) ?? null) : null;
  const jobId = e.job_id ? e.job_id[0] : null;
  const position = jobId ? (jobNameById.get(jobId) ?? (e.job_id ? e.job_id[1] : null)) : null;

  const patch: Record<string, unknown> = {
    department_id: deptId,
  };
  if (e.work_phone) patch.phone = e.work_phone;
  if (position) patch.job_title = position;

  const { error } = await supabaseAdmin
    .from("employee_profiles")
    .update(patch)
    .eq("id", empId);
  if (error) {
    console.warn(`emp ${e.id} (${e.name}): ${error.message}`);
    continue;
  }
  updated += 1;
}
console.log(`[hr-sync] backfilled ${updated} employee_profiles (skipped ${unmatched} without user link)`);

// Pass 2: manager_employee_id
let managers = 0;
for (const e of hrEmployees) {
  const empId = hrIdToEmp.get(e.id);
  if (!empId) continue;
  const managerOdooId = e.parent_id ? e.parent_id[0] : null;
  if (!managerOdooId) continue;
  const managerId = hrIdToEmp.get(managerOdooId);
  if (!managerId) continue;
  await supabaseAdmin
    .from("employee_profiles")
    .update({ manager_employee_id: managerId })
    .eq("id", empId);
  managers += 1;
}
console.log(`[hr-sync] wired ${managers} manager links`);

// Pass 3: department head_employee_id
let heads = 0;
for (const d of departments) {
  if (!d.manager_id) continue;
  const deptId = deptIdMap.get(d.id);
  if (!deptId) continue;
  const headEmpId = hrIdToEmp.get(d.manager_id[0]);
  if (!headEmpId) continue;
  await supabaseAdmin
    .from("departments")
    .update({ head_employee_id: headEmpId })
    .eq("id", deptId);
  heads += 1;
}
console.log(`[hr-sync] wired ${heads} department heads`);

console.log("[hr-sync] done.");
