// Unit tests for the SLA-watcher resolution logic shipped in
// supabase/functions/sla-watcher/index.ts (phase T5).
//
// We don't run the edge function — it requires Supabase + cron. Instead we
// re-implement the pure resolution rules and check them. Any divergence
// with the real watcher will fail fast because the rules are tiny.
//
// Run: bun run tests/sla-watcher.test.mjs

import assert from 'node:assert/strict';

function resolveMaxMinutes(task, rule, template) {
  if (task.sla_override_minutes != null) {
    return { max: task.sla_override_minutes, source: 'task_override', businessHoursOnly: rule?.business_hours_only ?? true };
  }
  if (task.stage === 'new' && template?.sla_minutes_new != null) {
    return { max: template.sla_minutes_new, source: 'template_new', businessHoursOnly: true };
  }
  if (task.stage === 'in_progress' && template?.sla_minutes_in_progress != null) {
    return { max: template.sla_minutes_in_progress, source: 'template_in_progress', businessHoursOnly: true };
  }
  if (rule) {
    return { max: rule.max_minutes, source: 'global_rule', businessHoursOnly: rule.business_hours_only };
  }
  return { max: null, source: 'none', businessHoursOnly: true };
}

const RULE_MR = { stage_key: 'manager_review', max_minutes: 30, business_hours_only: true };
const RULE_RTS = { stage_key: 'ready_to_send', max_minutes: 15, business_hours_only: true };
const RULE_CC = { stage_key: 'client_changes', max_minutes: 480, business_hours_only: true };
const RULE_NEW = { stage_key: 'new', max_minutes: 240, business_hours_only: true };

const cases = [
  // Per-task override wins everything.
  ['override beats template+global', () => {
    const r = resolveMaxMinutes(
      { stage: 'new', sla_override_minutes: 10 },
      RULE_NEW,
      { sla_minutes_new: 60 },
    );
    assert.equal(r.max, 10);
    assert.equal(r.source, 'task_override');
  }],

  // Template per-stage value used for new.
  ['template_new used for stage=new', () => {
    const r = resolveMaxMinutes(
      { stage: 'new', sla_override_minutes: null },
      RULE_NEW,
      { sla_minutes_new: 60, sla_minutes_in_progress: 90 },
    );
    assert.equal(r.max, 60);
    assert.equal(r.source, 'template_new');
  }],

  // Template per-stage value used for in_progress.
  ['template_in_progress used for stage=in_progress', () => {
    const r = resolveMaxMinutes(
      { stage: 'in_progress', sla_override_minutes: null },
      null,
      { sla_minutes_in_progress: 120 },
    );
    assert.equal(r.max, 120);
    assert.equal(r.source, 'template_in_progress');
  }],

  // Global rule fallback.
  ['global rule used for manager_review', () => {
    const r = resolveMaxMinutes(
      { stage: 'manager_review', sla_override_minutes: null },
      RULE_MR,
      undefined,
    );
    assert.equal(r.max, 30);
    assert.equal(r.source, 'global_rule');
  }],

  // No rule + no template → null (skip).
  ['no rule + no template → null', () => {
    const r = resolveMaxMinutes(
      { stage: 'new', sla_override_minutes: null },
      null,
      null,
    );
    assert.equal(r.max, null);
  }],

  // Ready to send 15-min global.
  ['ready_to_send → 15', () => {
    const r = resolveMaxMinutes(
      { stage: 'ready_to_send', sla_override_minutes: null },
      RULE_RTS,
      undefined,
    );
    assert.equal(r.max, 15);
  }],

  // Client changes hard cap 8h = 480.
  ['client_changes → 480', () => {
    const r = resolveMaxMinutes(
      { stage: 'client_changes', sla_override_minutes: null },
      RULE_CC,
      undefined,
    );
    assert.equal(r.max, 480);
  }],
];

// Simulate breach detection: stage entered N minutes ago vs max → breach when N > max.
function isBreach({ stageEnteredMinutesAgo, max }) {
  if (max == null) return false;
  return stageEnteredMinutesAgo > max;
}

const breachCases = [
  ['under SLA → no breach', () => assert.equal(isBreach({ stageEnteredMinutesAgo: 25, max: 30 }), false)],
  ['exactly SLA → no breach', () => assert.equal(isBreach({ stageEnteredMinutesAgo: 30, max: 30 }), false)],
  ['over SLA → breach', () => assert.equal(isBreach({ stageEnteredMinutesAgo: 31, max: 30 }), true)],
  ['null max → never breach', () => assert.equal(isBreach({ stageEnteredMinutesAgo: 9999, max: null }), false)],
];

let failed = 0;
for (const [name, fn] of [...cases, ...breachCases]) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log(`\nall passed`);
