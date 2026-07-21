#!/usr/bin/env node
// Re-derive tasks.stage_owner_positions from the authoritative /task-templates.
// Faithful standalone port of resolveStageOwnersForOrg
// (src/lib/tasks/resolve-stage-owners.ts) + withEffectiveExecutionOwner, so it
// can run outside the Next server (the refresh-task-owners cron is not currently
// scheduled, so task owner maps drift from the corrected templates).
//
//   DRY_RUN=1 node scripts/rederive-task-owners.mjs   # preview, no writes
//   node scripts/rederive-task-owners.mjs             # apply
//
// Fixes the "design execution stage billed to the social specialist instead of
// the graphics executor" class: a stale map says in_progress/client_changes =
// specialist while the template + an active agent (المنفذ) say agent.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const env = fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n").reduce((a, l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, "");
  return a;
}, {});
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ORG = process.env.ORG_ID || "11111111-1111-1111-1111-111111111111";
const DRY = process.env.DRY_RUN === "1";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const ALEF = { "ى": "ي", "ئ": "ي", "إ": "ا", "أ": "ا", "آ": "ا", "ة": "ه", "ي": "ي" };
function norm(s) {
  if (!s) return "";
  let t = s.normalize("NFKC");
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}️⃣]/gu, "");
  t = t.replace(/[ىئإأآةي]/g, (c) => ALEF[c] ?? c);
  t = t.replace(/[ً-ْـ]/g, "");
  t = t.replace(/[0-9٠-٩]/g, "");
  return t.replace(/\s+/g, " ").trim().toLowerCase();
}
const EXEC = ["in_progress", "client_changes"];
function withEffectiveExecutionOwner(owners, roles) {
  if (roles.has("agent") || !roles.has("specialist")) return owners;
  let resolved = owners;
  for (const st of EXEC) {
    if (owners[st] !== "agent") continue;
    if (resolved === owners) resolved = { ...owners };
    resolved[st] = "specialist";
  }
  return resolved;
}

async function page(pathq) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SB_URL}/rest/v1/${pathq}`, {
      headers: { ...H, Range: `${from}-${from + 999}`, "Range-Unit": "items" },
    });
    const d = await r.json();
    if (!Array.isArray(d)) throw new Error(`load ${pathq}: ${JSON.stringify(d)}`);
    rows.push(...d);
    if (d.length < 1000) return rows;
  }
}

const [tasks, items, tmpls, assignees, employees, positions] = await Promise.all([
  page(`tasks?select=id,task_code,title,service_id,stage_owner_positions&organization_id=eq.${ORG}&order=id.asc`),
  page(`task_template_items?select=title,task_template_id,stage_owner_positions&organization_id=eq.${ORG}&order=id.asc`),
  page(`task_templates?select=id,service_id&organization_id=eq.${ORG}&order=id.asc`),
  page(`task_assignees?select=task_id,employee_id&organization_id=eq.${ORG}&order=id.asc`),
  page(`employee_profiles?select=id,position_id,employment_status&organization_id=eq.${ORG}&order=id.asc`),
  page(`positions?select=id,role&organization_id=eq.${ORG}&order=id.asc`),
]);

const roleByPos = new Map(positions.map((p) => [p.id, p.role]));
const roleByActiveEmp = new Map(
  employees.filter((e) => e.employment_status === "active" && e.position_id).map((e) => [e.id, roleByPos.get(e.position_id) ?? null]),
);
const rolesByTask = new Map();
for (const a of assignees) {
  if (!a.employee_id) continue;
  const role = roleByActiveEmp.get(a.employee_id);
  if (!role) continue;
  const s = rolesByTask.get(a.task_id) ?? new Set();
  s.add(role);
  rolesByTask.set(a.task_id, s);
}
const svcOf = new Map(tmpls.map((t) => [t.id, t.service_id]));
const exact = new Map();
const svcCount = new Map();
for (const it of items) {
  const sid = svcOf.get(it.task_template_id) ?? "";
  const map = JSON.stringify(it.stage_owner_positions);
  const key = `${sid} ${norm(it.title)}`;
  if (!exact.has(key)) exact.set(key, map);
  const c = svcCount.get(sid) ?? new Map();
  c.set(map, (c.get(map) ?? 0) + 1);
  svcCount.set(sid, c);
}
const svcMode = new Map();
for (const [sid, c] of svcCount) {
  let best = "", bn = -1;
  for (const [m, n] of c) if (n > bn) { best = m; bn = n; }
  svcMode.set(sid, best);
}

const byTarget = new Map();
const ipTransition = new Map();
for (const t of tasks) {
  const sid = t.service_id;
  const cur = t.stage_owner_positions || {};
  if (!sid) continue;
  const key = `${sid} ${norm(t.title)}`;
  let target;
  if (exact.has(key)) target = exact.get(key);
  else if (svcMode.has(sid)) target = svcMode.get(sid);
  if (!target) continue;
  const parsed = JSON.parse(target);
  const eff = withEffectiveExecutionOwner(parsed, rolesByTask.get(t.id) ?? new Set());
  if (eff !== parsed) target = JSON.stringify(eff);
  if (JSON.stringify(t.stage_owner_positions) === target) continue;
  const ids = byTarget.get(target) ?? [];
  ids.push(t.id);
  byTarget.set(target, ids);
  const tr = `${cur.in_progress ?? "null"} -> ${eff.in_progress ?? "null"}`;
  ipTransition.set(tr, (ipTransition.get(tr) ?? 0) + 1);
}
let changed = 0;
for (const [, ids] of byTarget) changed += ids.length;
console.log(`org ${ORG} — ${tasks.length} tasks, ${changed} to update.`);
console.log("in_progress transitions:", JSON.stringify(Object.fromEntries([...ipTransition.entries()].sort((a, b) => b[1] - a[1]))));

if (DRY) {
  console.log("DRY RUN — no writes. Re-run without DRY_RUN=1 to apply.");
  process.exit(0);
}

let updated = 0;
for (const [map, ids] of byTarget) {
  const parsed = JSON.parse(map);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const r = await fetch(`${SB_URL}/rest/v1/tasks?id=in.(${chunk.join(",")})`, {
      method: "PATCH",
      headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify({ stage_owner_positions: parsed }),
    });
    if (r.status >= 300) throw new Error(`update failed HTTP ${r.status}: ${await r.text()}`);
    updated += chunk.length;
  }
}
console.log(`APPLIED — updated ${updated} tasks.`);
