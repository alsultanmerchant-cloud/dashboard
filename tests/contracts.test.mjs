// Phase T7.5-finish — contract layer smoke tests.
//
// Pure-Bun/Node, no harness. Asserts that the Wave-4 deliverables exist:
//   - Migration 0028 with the AM-scoping clauses
//   - Server actions with zod schemas
//   - Data loader functions on src/lib/data/contracts.ts
//   - Edge function monthly-cycle-roller exists
//
// Run:  bun tests/contracts.test.mjs

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (rel) => readFileSync(ROOT + rel, 'utf-8');
const has = (rel) => existsSync(ROOT + rel);

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

// --- Migration 0028 ---
test('migration 0028 exists', () => {
  assert.ok(has('supabase/migrations/0028_contracts_am_scoping.sql'));
});

test('0028 tightens contracts_select with per-AM clause', () => {
  const sql = read('supabase/migrations/0028_contracts_am_scoping.sql');
  assert.match(sql, /drop policy if exists contracts_select/i);
  assert.match(sql, /create policy contracts_select/i);
  assert.match(sql, /target\.view_all/);
  assert.match(sql, /contract\.manage/);
  assert.match(sql, /account_manager_id\s*=\s*\(/);
  assert.match(sql, /from\s+public\.employee_profiles/i);
});

test('0028 tightens installments_select via EXISTS contracts', () => {
  const sql = read('supabase/migrations/0028_contracts_am_scoping.sql');
  assert.match(sql, /drop policy if exists installments_select/i);
  assert.match(sql, /create policy installments_select/i);
  assert.match(sql, /exists \(\s*select 1 from public\.contracts/i);
});

test('0028 tightens monthly_cycles_select via EXISTS', () => {
  const sql = read('supabase/migrations/0028_contracts_am_scoping.sql');
  assert.match(sql, /drop policy if exists monthly_cycles_select/i);
  assert.match(sql, /create policy monthly_cycles_select/i);
});

test('0028 tightens contract_events_select via EXISTS', () => {
  const sql = read('supabase/migrations/0028_contracts_am_scoping.sql');
  assert.match(sql, /drop policy if exists contract_events_select/i);
  assert.match(sql, /create policy contract_events_select/i);
});

test('0028 contains NO FOR ALL policies (Wave-2 trap)', () => {
  const sql = read('supabase/migrations/0028_contracts_am_scoping.sql');
  assert.doesNotMatch(sql, /\bfor\s+all\b/i);
});

test('0028 uses 1-arg has_permission overload', () => {
  const sql = read('supabase/migrations/0028_contracts_am_scoping.sql');
  // No `has_permission(<uuid>, ...)` calls in the new policies.
  assert.doesNotMatch(sql, /has_permission\(\s*organization_id/);
  assert.match(sql, /has_permission\(\s*'target\.view_all'\s*\)/);
  assert.match(sql, /has_permission\(\s*'contract\.manage'\s*\)/);
});

// --- Server actions ---
test('contracts/_actions.ts exists', () => {
  assert.ok(has('src/app/(dashboard)/contracts/_actions.ts'));
});

test('_actions.ts exports the 4 required actions with zod', () => {
  const src = read('src/app/(dashboard)/contracts/_actions.ts');
  assert.match(src, /import .*\bz\b.*from\s+["']zod["']/);
  for (const name of [
    'recordContractEventAction',
    'recordInstallmentReceivedAction',
    'recordMonthlyMeetingAction',
    'addCycleAction',
  ]) {
    assert.match(src, new RegExp(`export async function ${name}\\b`), `missing ${name}`);
  }
});

test('_actions.ts gates on contract.manage permission', () => {
  const src = read('src/app/(dashboard)/contracts/_actions.ts');
  const matches = src.match(/requirePermission\(["']contract\.manage["']\)/g) ?? [];
  assert.ok(matches.length >= 4, `expected ≥4 requirePermission calls, got ${matches.length}`);
});

test('_actions.ts writes audit_log + ai_event', () => {
  const src = read('src/app/(dashboard)/contracts/_actions.ts');
  assert.match(src, /logAudit\(/);
  assert.match(src, /logAiEvent\(/);
  assert.match(src, /CONTRACT_EVENT_RECORDED/);
  assert.match(src, /CONTRACT_INSTALLMENT_RECEIVED/);
});

// --- Data loader ---
test('contracts data loader exposes finish-phase functions', () => {
  const src = read('src/lib/data/contracts.ts');
  for (const fn of [
    'getContractById',
    'getContractInstallments',
    'getContractCycles',
    'getContractEvents',
    'getAmDashboard',
    'getCeoCommercialTiles',
  ]) {
    assert.match(src, new RegExp(`export async function ${fn}\\b`), `missing ${fn}`);
  }
});

// --- UI surfaces ---
test('contracts/[id]/page.tsx exists', () => {
  assert.ok(has('src/app/(dashboard)/contracts/[id]/page.tsx'));
});

test('am/[id]/dashboard/page.tsx exists', () => {
  assert.ok(has('src/app/(dashboard)/am/[id]/dashboard/page.tsx'));
});

// --- Edge function ---
test('monthly-cycle-roller exists and uses Asia/Riyadh comment', () => {
  assert.ok(has('supabase/functions/monthly-cycle-roller/index.ts'));
  const src = read('supabase/functions/monthly-cycle-roller/index.ts');
  assert.match(src, /Asia\/Riyadh/);
  assert.match(src, /MONTHLY_CYCLE_DUE/);
});

// --- Run ---
let pass = 0, fail = 0;
for (const [name, fn] of cases) {
  try { fn(); pass++; console.log(`  ok ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
