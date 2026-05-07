#!/usr/bin/env bun
// seed-odoo-templates.ts — pulls Odoo project.category.task rows (the 279
// per-category task templates) and upserts them into Supabase.
//
// Mapping:
//   Odoo project.category   -> public.task_templates  (one per category,
//                                  service_id resolved from public.services
//                                  whose slug ends with `-${cat_id}`)
//   Odoo project.category.task -> public.task_template_items
//                                  (organization_id, external_source='odoo',
//                                   external_id=odoo_id) is the upsert key.
//
// Live probe established that 0/279 rows have task_code or target_task_id
// set on the source side, so we skip task_template_links seeding entirely
// (the table from migration 0064 stands ready for the day Sky Light fills
// those fields).
//
// Defaults to dry-run; pass --commit to actually write.
//
// Usage:
//   bun run scripts/seed-odoo-templates.ts            # dry-run, prints diff
//   bun run scripts/seed-odoo-templates.ts --commit   # apply upserts

import { createClient } from "@supabase/supabase-js";
import { odooFromEnv } from "../src/lib/odoo/client";

type OdooCategory = {
  id: number;
  name: string;
};

type OdooCatTask = {
  id: number;
  name: string;
  description: string | false;
  project_categ_id: [number, string] | false;
  task_duration: number | false;
  sequence: number | false;
  priority: string | false; // "0"|"1"
  requires_approval: boolean;
};

const COMMIT = process.argv.includes("--commit");

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

async function main() {
  const supa = createClient(
    envOrThrow("NEXT_PUBLIC_SUPABASE_URL"),
    envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  // Resolve the seeded org id.
  const { data: org, error: orgErr } = await supa
    .from("organizations")
    .select("id, slug")
    .eq("slug", "rawasm-demo")
    .maybeSingle();
  if (orgErr || !org) throw new Error("rawasm-demo org not found");
  const orgId = org.id;

  // Pull services so we can match Odoo categories by slug suffix.
  const { data: services } = await supa
    .from("services")
    .select("id, slug, name")
    .eq("organization_id", orgId);
  const serviceByCatId = new Map<number, { id: string; name: string }>();
  for (const s of services ?? []) {
    const m = s.slug.match(/-(\d+)$/);
    if (m) serviceByCatId.set(Number(m[1]), { id: s.id, name: s.name });
  }
  console.log(`[seed] services with -<catId> suffix: ${serviceByCatId.size}`);

  const odoo = odooFromEnv();
  await odoo.authenticate();

  const odooCats = await odoo.searchRead<OdooCategory>(
    "project.category", [], ["id", "name"], { limit: 500 },
  );
  console.log(`[odoo] project.category rows: ${odooCats.length}`);

  const odooTasks = await odoo.searchRead<OdooCatTask>(
    "project.category.task",
    [],
    ["id", "name", "description", "project_categ_id", "task_duration", "sequence", "priority", "requires_approval"],
    { limit: 5000, order: "project_categ_id, sequence" },
  );
  console.log(`[odoo] project.category.task rows: ${odooTasks.length}`);

  // Build per-cat row groups, skipping cats with no matching service.
  const tasksByCat = new Map<number, OdooCatTask[]>();
  let unmappedTaskCount = 0;
  for (const t of odooTasks) {
    if (!t.project_categ_id) continue;
    const [catId] = t.project_categ_id;
    if (!serviceByCatId.has(catId)) {
      unmappedTaskCount += 1;
      continue;
    }
    if (!tasksByCat.has(catId)) tasksByCat.set(catId, []);
    tasksByCat.get(catId)!.push(t);
  }
  console.log(
    `[seed] cats matched: ${tasksByCat.size}, tasks ready to upsert: ` +
    `${[...tasksByCat.values()].reduce((s, a) => s + a.length, 0)}` +
    (unmappedTaskCount ? ` (skipping ${unmappedTaskCount} task rows whose category isn't in services)` : ""),
  );

  // Upsert one task_template per matched Odoo category.
  type TemplateRow = {
    organization_id: string;
    service_id: string;
    name: string;
    external_source: string;
    external_id: string;
  };
  const templateRows: TemplateRow[] = [];
  for (const cat of odooCats) {
    const svc = serviceByCatId.get(cat.id);
    if (!svc) continue;
    if (!tasksByCat.has(cat.id)) continue;
    templateRows.push({
      organization_id: orgId,
      service_id: svc.id,
      name: cat.name,
      external_source: "odoo",
      external_id: String(cat.id),
    });
  }
  console.log(`[seed] templates to upsert: ${templateRows.length}`);

  if (!COMMIT) {
    console.log("\n[dry-run] Pass --commit to actually write. Sample template:");
    console.log(JSON.stringify(templateRows[0], null, 2));
    console.log("\n[dry-run] Sample task per template:");
    const firstCat = templateRows[0]?.external_id ? Number(templateRows[0].external_id) : null;
    if (firstCat !== null) {
      const sample = tasksByCat.get(firstCat)?.slice(0, 2);
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  // Step 1: upsert templates, keyed by (org, external_source, external_id).
  const { data: upsertedTemplates, error: tErr } = await supa
    .from("task_templates")
    .upsert(templateRows, { onConflict: "organization_id,external_source,external_id" })
    .select("id, external_id");
  if (tErr) throw tErr;
  console.log(`[commit] templates upserted: ${upsertedTemplates?.length ?? 0}`);
  const templateIdByCat = new Map<number, string>();
  for (const r of upsertedTemplates ?? []) {
    if (r.external_id) templateIdByCat.set(Number(r.external_id), r.id);
  }

  // Step 2: upsert template items.
  type ItemRow = {
    organization_id: string;
    task_template_id: string;
    title: string;
    description: string | null;
    duration_days: number;
    order_index: number;
    priority: string;
    requires_approval: boolean;
    external_source: string;
    external_id: string;
  };
  const itemRows: ItemRow[] = [];
  for (const [catId, tasks] of tasksByCat) {
    const templateId = templateIdByCat.get(catId);
    if (!templateId) continue;
    for (const t of tasks) {
      itemRows.push({
        organization_id: orgId,
        task_template_id: templateId,
        title: t.name,
        description: t.description === false ? null : (t.description ?? null),
        duration_days: typeof t.task_duration === "number" ? t.task_duration : 0,
        order_index: typeof t.sequence === "number" ? t.sequence : 0,
        // Odoo only emits "0" (low) / "1" (high). Map to our 4-value enum.
        priority: t.priority === "1" ? "high" : "medium",
        requires_approval: !!t.requires_approval,
        external_source: "odoo",
        external_id: String(t.id),
      });
    }
  }
  console.log(`[commit] items to upsert: ${itemRows.length}`);

  // Batch in 100s to keep payloads sane.
  for (let i = 0; i < itemRows.length; i += 100) {
    const batch = itemRows.slice(i, i + 100);
    const { error: iErr } = await supa
      .from("task_template_items")
      .upsert(batch, { onConflict: "organization_id,external_source,external_id" });
    if (iErr) throw iErr;
    console.log(`  · upserted ${Math.min(i + 100, itemRows.length)}/${itemRows.length}`);
  }

  console.log("\n[commit] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
