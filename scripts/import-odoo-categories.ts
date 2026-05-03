#!/usr/bin/env bun
// import-odoo-categories.ts — Phase T4 Odoo → Supabase category importer.
//
// READ-ONLY against Odoo. Reads:
//   * project.category       (≈13 rows) — service buckets
//   * project.category.task  (≈279 rows) — per-bucket task templates with
//                                          deadline_offset_days etc.
//
// Default behaviour is dry-run: writes tmp/categories-diff.csv summarising
// what would be inserted/updated against the live Supabase project. Pass
// `--commit` to actually upsert into:
//   * public.service_categories         (matched by external_source/id pair)
//   * public.task_templates             (matched by external_source/id)
//
// We never write task_template_items in this script — those are the per-step
// rows already seeded by migration 0014, and the Odoo "task" rows correspond
// to templates, not items. A second-pass importer can be added once owner
// confirms which template-item shape they want.
//
// Usage:
//   bun run scripts/import-odoo-categories.ts            # dry-run, CSV diff
//   bun run scripts/import-odoo-categories.ts --commit   # actually write

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { odooFromEnv, OdooClient } from "../src/lib/odoo/client";

type OdooCategory = {
  id: number;
  name: string;
  code?: string | false;
  color?: number | false;
  description?: string | false;
};

type OdooCategoryTask = {
  id: number;
  name: string;
  category_id: [number, string] | false;
  deadline_offset_days?: number | false;
  upload_offset_days?: number | false;
  default_owner_position?: string | false;
  sequence?: number | false;
  description?: string | false;
};

const COMMIT = process.argv.includes("--commit");

function envOrThrow(key: string) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

async function main() {
  const odoo: OdooClient = odooFromEnv();
  console.log("[import-odoo-categories] authenticating against Odoo…");
  await odoo.authenticate();

  console.log("[import-odoo-categories] reading project.category…");
  let categories: OdooCategory[] = [];
  try {
    categories = await odoo.searchRead<OdooCategory>(
      "project.category",
      [],
      ["id", "name", "code", "color", "description"],
      { limit: 200 },
    );
  } catch (e) {
    console.error("[import-odoo-categories] project.category not available:", (e as Error).message);
  }
  console.log(`  → ${categories.length} category rows`);

  console.log("[import-odoo-categories] reading project.category.task…");
  let tasks: OdooCategoryTask[] = [];
  try {
    tasks = await odoo.searchRead<OdooCategoryTask>(
      "project.category.task",
      [],
      ["id", "name", "category_id", "deadline_offset_days", "upload_offset_days", "default_owner_position", "sequence", "description"],
      { limit: 5000 },
    );
  } catch (e) {
    console.error("[import-odoo-categories] project.category.task not available:", (e as Error).message);
  }
  console.log(`  → ${tasks.length} category-task rows`);

  // CSV dump for review.
  const tmp = path.resolve("tmp");
  fs.mkdirSync(tmp, { recursive: true });
  const csvPath = path.join(tmp, "categories-diff.csv");
  const lines: string[] = [];
  lines.push("kind,odoo_id,name,extra");
  for (const c of categories) {
    lines.push(`category,${c.id},"${c.name.replace(/"/g, '""')}","code=${c.code || ""}"`);
  }
  for (const t of tasks) {
    const cat = Array.isArray(t.category_id) ? t.category_id[1] : "?";
    const offsets = `deadline=${t.deadline_offset_days || ""};upload=${t.upload_offset_days || ""}`;
    lines.push(`category_task,${t.id},"${t.name.replace(/"/g, '""')}","cat=${cat};${offsets}"`);
  }
  fs.writeFileSync(csvPath, lines.join("\n"), "utf-8");
  console.log(`[import-odoo-categories] dry-run dump → ${csvPath}`);

  if (!COMMIT) {
    console.log("[import-odoo-categories] dry-run only. Re-run with --commit to write.");
    return;
  }

  // Commit path: upsert into Supabase via service-role key.
  const supabaseUrl = envOrThrow("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = envOrThrow("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Resolve org — single-tenant, slug `rawasm-demo`.
  const { data: org, error: orgErr } = await supabase
    .from("organizations").select("id").eq("slug", "rawasm-demo").maybeSingle();
  if (orgErr || !org) throw new Error(`Cannot resolve org: ${orgErr?.message}`);

  console.log("[import-odoo-categories] upserting service_categories…");
  let categoryUpserts = 0;
  for (const c of categories) {
    const key = c.code && typeof c.code === "string" ? c.code : `odoo:cat:${c.id}`;
    const payload = {
      organization_id: org.id,
      key,
      name_ar: c.name,
      name_en: typeof c.code === "string" ? c.code : null,
      description: typeof c.description === "string" ? c.description : null,
      external_source: "odoo",
      external_id: c.id,
      sort_order: 0,
      is_active: true,
    };
    const { error } = await supabase
      .from("service_categories")
      .upsert(payload, { onConflict: "organization_id,key" });
    if (error) console.error(`  ! ${c.name}: ${error.message}`);
    else categoryUpserts++;
  }
  console.log(`  → ${categoryUpserts} categories upserted`);

  console.log("[import-odoo-categories] upserting task_templates rows from category-tasks…");
  // Build a lookup of supabase service_categories by external_id
  const { data: scRows } = await supabase
    .from("service_categories")
    .select("id, external_id")
    .eq("organization_id", org.id)
    .eq("external_source", "odoo");
  const byExt = new Map<number, string>();
  for (const r of scRows ?? []) if (r.external_id) byExt.set(r.external_id, r.id);

  // Pick a default service to anchor templates that have no explicit service.
  const { data: defaultService } = await supabase
    .from("services").select("id").eq("organization_id", org.id).limit(1).maybeSingle();
  if (!defaultService) {
    console.error("  ! no services row available — cannot anchor task_templates");
    return;
  }

  let templateUpserts = 0;
  for (const t of tasks) {
    const odooCatId = Array.isArray(t.category_id) ? t.category_id[0] : null;
    const category_id = odooCatId ? byExt.get(odooCatId) ?? null : null;
    const payload = {
      organization_id: org.id,
      service_id: defaultService.id,
      category_id,
      name: t.name,
      description: typeof t.description === "string" ? t.description : null,
      deadline_offset_days: typeof t.deadline_offset_days === "number" ? t.deadline_offset_days : null,
      upload_offset_days: typeof t.upload_offset_days === "number" ? t.upload_offset_days : null,
      default_owner_position: typeof t.default_owner_position === "string" ? t.default_owner_position : null,
      sort_order: typeof t.sequence === "number" ? t.sequence : 0,
      is_active: true,
    };
    // task_templates has no natural unique key on (org, name); emulate idempotency
    // by checking for an existing row with the same external_id once we extend
    // the table later. For now we INSERT only when no row matches (org, name).
    const { data: existing } = await supabase
      .from("task_templates")
      .select("id")
      .eq("organization_id", org.id)
      .eq("name", t.name)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("task_templates").update(payload).eq("id", existing.id);
      if (error) console.error(`  ! update ${t.name}: ${error.message}`);
      else templateUpserts++;
    } else {
      const { error } = await supabase.from("task_templates").insert(payload);
      if (error) console.error(`  ! insert ${t.name}: ${error.message}`);
      else templateUpserts++;
    }
  }
  console.log(`  → ${templateUpserts} templates upserted`);
  console.log("[import-odoo-categories] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
