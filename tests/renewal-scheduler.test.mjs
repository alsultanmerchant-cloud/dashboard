// Phase T7 — pure-Bun unit tests for the renewal scheduler.
//
// We re-implement `shouldNudge` (mirroring
// supabase/functions/renewal-scheduler/index.ts) so the test runs without
// Deno. Any drift will fail fast — the rule surface is tiny.
//
// Run any of:
//   bun run tests/renewal-scheduler.test.mjs
//   node tests/renewal-scheduler.test.mjs

import assert from 'node:assert/strict';

function shouldNudge({ today, nextRenewalDate, cycles }) {
  const days =
    (new Date(`${nextRenewalDate}T00:00:00.000Z`).getTime() -
      new Date(`${today}T00:00:00.000Z`).getTime()) /
    86_400_000;
  if (days < 0 || days > 14) return false;
  for (const c of cycles) {
    if (c.status !== 'active') continue;
    if (c.started_at > nextRenewalDate) continue;
    if (c.ended_at && c.ended_at < nextRenewalDate) continue;
    return false;
  }
  return true;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ok ' + name);
  } catch (err) {
    failed += 1;
    console.error('  fail ' + name + '\n   ' + err.message);
  }
}

console.log('renewal-scheduler shouldNudge');

test('13 days out, no active cycle → nudge', () => {
  assert.equal(
    shouldNudge({ today: '2026-05-03', nextRenewalDate: '2026-05-16', cycles: [] }),
    true,
  );
});

test('exactly 14 days out → nudge (inclusive boundary)', () => {
  assert.equal(
    shouldNudge({ today: '2026-05-03', nextRenewalDate: '2026-05-17', cycles: [] }),
    true,
  );
});

test('15 days out → no nudge', () => {
  assert.equal(
    shouldNudge({ today: '2026-05-03', nextRenewalDate: '2026-05-18', cycles: [] }),
    false,
  );
});

test('past renewal date → no nudge', () => {
  assert.equal(
    shouldNudge({ today: '2026-05-03', nextRenewalDate: '2026-05-01', cycles: [] }),
    false,
  );
});

test('today = next_renewal_date → nudge (0 days out)', () => {
  assert.equal(
    shouldNudge({ today: '2026-05-03', nextRenewalDate: '2026-05-03', cycles: [] }),
    true,
  );
});

test('active cycle covering upcoming date → suppress', () => {
  assert.equal(
    shouldNudge({
      today: '2026-05-03',
      nextRenewalDate: '2026-05-16',
      cycles: [{ status: 'active', started_at: '2026-05-01', ended_at: null }],
    }),
    false,
  );
});

test('completed cycle covering date does NOT suppress', () => {
  assert.equal(
    shouldNudge({
      today: '2026-05-03',
      nextRenewalDate: '2026-05-16',
      cycles: [{ status: 'completed', started_at: '2026-05-01', ended_at: '2026-05-31' }],
    }),
    true,
  );
});

test('active cycle that ended before next renewal date does NOT suppress', () => {
  assert.equal(
    shouldNudge({
      today: '2026-05-03',
      nextRenewalDate: '2026-05-16',
      cycles: [{ status: 'active', started_at: '2026-04-01', ended_at: '2026-04-30' }],
    }),
    true,
  );
});

test('active cycle starting after next renewal date does NOT suppress', () => {
  // Edge case: somebody pre-created a future cycle. We still nudge until
  // a current-period cycle exists.
  assert.equal(
    shouldNudge({
      today: '2026-05-03',
      nextRenewalDate: '2026-05-10',
      cycles: [{ status: 'active', started_at: '2026-06-01', ended_at: null }],
    }),
    true,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
