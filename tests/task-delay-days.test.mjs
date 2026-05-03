// Unit tests for the delay_days computation shipped in migration 0023
// (phase T3). The migration creates a STORED GENERATED column on
// public.tasks. Because we cannot run the database from a unit test, we
// re-implement the SQL CASE in plain JS and verify the contract:
//
//   delay_days =
//     CASE
//       WHEN stage = 'done'
//        AND planned_date IS NOT NULL
//        AND completed_at IS NOT NULL
//       THEN GREATEST(0, completed_at::date - planned_date)
//       ELSE NULL
//     END
//
// Any divergence here from the SQL in 0023 will fail fast because the
// rules are tiny.
//
// Self-running. Run any of:
//   bun run tests/task-delay-days.test.mjs
//   node tests/task-delay-days.test.mjs

import assert from 'node:assert/strict';

function dateOnly(iso) {
  // Mirror Postgres `completed_at::date` — strip the time portion in the
  // server's TZ. Tests run in UTC; if you re-run in another TZ adjust.
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(later, earlier) {
  const ms = dateOnly(later).getTime() - new Date(earlier + 'T00:00:00Z').getTime();
  return Math.round(ms / 86400000);
}

function delayDays(task) {
  if (task.stage !== 'done') return null;
  if (!task.planned_date || !task.completed_at) return null;
  return Math.max(0, daysBetween(task.completed_at, task.planned_date));
}

const cases = [
  ['null when not done',
    () => assert.equal(delayDays({ stage: 'in_progress', planned_date: '2026-05-01', completed_at: '2026-05-05T10:00:00Z' }), null)],
  ['null when planned_date missing',
    () => assert.equal(delayDays({ stage: 'done', planned_date: null, completed_at: '2026-05-05T10:00:00Z' }), null)],
  ['null when completed_at missing',
    () => assert.equal(delayDays({ stage: 'done', planned_date: '2026-05-01', completed_at: null }), null)],
  ['0 when completed exactly on planned date',
    () => assert.equal(delayDays({ stage: 'done', planned_date: '2026-05-01', completed_at: '2026-05-01T09:00:00Z' }), 0)],
  ['0 when ahead of schedule (clamped via GREATEST)',
    () => assert.equal(delayDays({ stage: 'done', planned_date: '2026-05-10', completed_at: '2026-05-05T09:00:00Z' }), 0)],
  ['1 day late',
    () => assert.equal(delayDays({ stage: 'done', planned_date: '2026-05-01', completed_at: '2026-05-02T09:00:00Z' }), 1)],
  ['7 days late',
    () => assert.equal(delayDays({ stage: 'done', planned_date: '2026-05-01', completed_at: '2026-05-08T09:00:00Z' }), 7)],
  ['cross-month boundary (April 30 → May 5 = 5 days)',
    () => assert.equal(delayDays({ stage: 'done', planned_date: '2026-04-30', completed_at: '2026-05-05T09:00:00Z' }), 5)],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} failed / ${cases.length}`);
  process.exit(1);
} else {
  console.log(`\n${cases.length} passed`);
}
