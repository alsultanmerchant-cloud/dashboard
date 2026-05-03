// Phase T6 — Governance Enforcement contract tests.
//
// Pure-Bun/Node. Run with:
//   bun run tests/governance.test.mjs
//   node tests/governance.test.mjs
//
// We do not boot Postgres or Next here. We assert that the SQL migration
// file, the moveTaskStageAction source, and the governance-watcher edge
// function source contain the contract strings the spec requires. If any
// of those drift, the test screams.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const MIGRATION_PATH = join(
  repoRoot,
  "supabase/migrations/0027_governance.sql",
);
const ACTIONS_PATH = join(
  repoRoot,
  "src/app/(dashboard)/tasks/_actions.ts",
);
const WATCHER_PATH = join(
  repoRoot,
  "supabase/functions/governance-watcher/index.ts",
);
const PAGE_PATH = join(
  repoRoot,
  "src/app/(dashboard)/governance/page.tsx",
);
const RESOLVE_ACTION_PATH = join(
  repoRoot,
  "src/app/(dashboard)/governance/_actions.ts",
);

const cases = [
  // --- migration file -----------------------------------------------------
  ["migration file exists", () => assert.ok(existsSync(MIGRATION_PATH))],
  ["migration declares governance_violations table", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    assert.match(sql, /create table if not exists public\.governance_violations/i);
  }],
  ["migration kind enum has all four values", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    for (const kind of [
      "missing_log_note",
      "stage_jump",
      "unowned_task",
      "permission_breach",
    ]) {
      assert.ok(sql.includes(`'${kind}'`), `missing kind '${kind}'`);
    }
  }],
  ["migration has split-write RLS policies (no FOR ALL)", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    assert.match(sql, /policy gov_violations_select on public\.governance_violations\s+for select/i);
    assert.match(sql, /policy gov_violations_insert on public\.governance_violations\s+for insert/i);
    assert.match(sql, /policy gov_violations_update on public\.governance_violations\s+for update/i);
    assert.match(sql, /policy gov_violations_delete on public\.governance_violations\s+for delete/i);
    // Sanity: never use FOR ALL on this table — it'd recreate the
    // wave-2 visibility leak by OR'ing with the SELECT policy.
    assert.ok(
      !/policy [a-z_]+ on public\.governance_violations\s+for all/i.test(sql),
      "FOR ALL policy detected on governance_violations — split it instead",
    );
  }],
  ["migration uses 1-arg has_permission overload", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    assert.match(sql, /has_permission\('governance\.view'\)/);
    assert.match(sql, /has_permission\('governance\.resolve'\)/);
  }],
  ["migration seeds both permission keys", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    assert.match(sql, /'governance\.view'/);
    assert.match(sql, /'governance\.resolve'/);
  }],
  ["migration grants governance.view to head/admin/owner", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    // The view-grant block targets owner/admin/manager; manager is the seeded
    // key for "Head" per 0006_seed.sql.
    assert.match(
      sql,
      /r\.key in \('owner','admin','manager'\)\s+and p\.key = 'governance\.view'/,
    );
  }],
  ["migration grants governance.resolve to admin/owner only", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    assert.match(
      sql,
      /r\.key in \('owner','admin'\)\s+and p\.key = 'governance\.resolve'/,
    );
  }],

  // --- moveTaskStageAction extension --------------------------------------
  ["actions file contains arabic missing-comment error", () => {
    const src = readFileSync(ACTIONS_PATH, "utf8");
    assert.match(src, /يجب إضافة ملاحظة قبل نقل المرحلة/);
  }],
  ["actions file uses a 5-minute window for fresh comment", () => {
    const src = readFileSync(ACTIONS_PATH, "utf8");
    // Either the literal "5 minutes" comment or a 5 * 60 * 1000 numeric
    // window — both are acceptable signal that the gate exists.
    assert.ok(
      /5 minutes|5 \* 60 \* 1000/.test(src),
      "no 5-minute fresh-comment window detected",
    );
  }],
  ["actions file queries task_comments for the gate", () => {
    const src = readFileSync(ACTIONS_PATH, "utf8");
    assert.match(src, /task_comments/);
    assert.match(src, /author_user_id/);
  }],

  // --- governance-watcher edge function -----------------------------------
  ["edge function file exists", () => assert.ok(existsSync(WATCHER_PATH))],
  ["edge function emits both kinds", () => {
    const src = readFileSync(WATCHER_PATH, "utf8");
    assert.match(src, /missing_log_note/);
    assert.match(src, /unowned_task/);
  }],
  ["edge function uses service role + supabase-js", () => {
    const src = readFileSync(WATCHER_PATH, "utf8");
    assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(src, /createClient/);
  }],
  ["edge function dedupes against open violations of same kind", () => {
    const src = readFileSync(WATCHER_PATH, "utf8");
    assert.match(src, /governance_violations/);
    assert.match(src, /resolved_at/);
  }],

  // --- /governance page + resolve action ----------------------------------
  ["governance page exists and gates on governance.view", () => {
    assert.ok(existsSync(PAGE_PATH));
    const src = readFileSync(PAGE_PATH, "utf8");
    assert.match(src, /requirePagePermission\("governance\.view"\)/);
  }],
  ["resolve action exists and gates on governance.resolve", () => {
    assert.ok(existsSync(RESOLVE_ACTION_PATH));
    const src = readFileSync(RESOLVE_ACTION_PATH, "utf8");
    assert.match(src, /requirePermission\("governance\.resolve"\)/);
    assert.match(src, /resolveViolationAction/);
  }],
];

let pass = 0;
let fail = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    pass += 1;
    console.log(`  ok ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
