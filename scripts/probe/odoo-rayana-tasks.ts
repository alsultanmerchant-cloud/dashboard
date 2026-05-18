// Probe: dump Odoo project 1539 (Rayana) active tasks with stage + the
// dashboard's task rows for the same project, so we can diff them.
// Run: bun --env-file=.env.local scripts/probe/odoo-rayana-tasks.ts
import { odooFromEnv } from "@/lib/odoo/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const c = odooFromEnv();
await c.authenticate();

type OTask = {
  id: number;
  name: string;
  active: boolean;
  stage_id: [number, string] | false;
};
const odoo = await c.searchRead<OTask>(
  "project.task",
  [["project_id", "=", 1539]],
  ["id", "name", "active", "stage_id"],
  { limit: 5000, context: { active_test: false } },
);
const odooActive = odoo.filter((t) => t.active);
console.log(`ODOO: ${odoo.length} total, ${odooActive.length} active`);
const byStage = new Map<string, OTask[]>();
for (const t of odooActive) {
  const s = t.stage_id ? t.stage_id[1] : "(none)";
  (byStage.get(s) ?? byStage.set(s, []).get(s)!).push(t);
}
for (const [s, ts] of byStage) {
  console.log(`  [${s}] ${ts.length}`);
  for (const t of ts) console.log(`     odoo#${t.id}  ${t.name}`);
}

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/tasks?select=external_id,title,stage,task_code,archived_at&project_id=eq.cf03841c-d86c-4674-af42-134f14bffa8d&archived_at=is.null&order=stage`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
);
const dash = (await res.json()) as {
  external_id: string;
  title: string;
  stage: string;
  task_code: string;
}[];
console.log(`\nDASHBOARD: ${dash.length} active tasks`);
const dByStage = new Map<string, typeof dash>();
for (const t of dash) (dByStage.get(t.stage) ?? dByStage.set(t.stage, []).get(t.stage)!).push(t);
for (const [s, ts] of dByStage) {
  console.log(`  [${s}] ${ts.length}`);
  for (const t of ts) console.log(`     ext#${t.external_id} ${t.task_code}  ${t.title}`);
}

const odooIds = new Set(odooActive.map((t) => t.id));
const dashIds = new Set(dash.map((t) => Number(t.external_id)));
console.log(
  `\nactive in Odoo but NOT active in dashboard: ${[...odooIds].filter((i) => !dashIds.has(i)).length}`,
);
console.log(
  `active in dashboard but NOT active in Odoo: ${[...dashIds].filter((i) => !odooIds.has(i)).length}`,
);
