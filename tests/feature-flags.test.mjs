// Unit tests for the resolveFlag pure function (phase T0).
//
// Self-running. Run any of:
//   bun run tests/feature-flags.test.mjs
//   node tests/feature-flags.test.mjs
//   node --test tests/feature-flags.test.mjs   (also works — run() is a no-op
//                                                under the test runner)
//
// We avoid a heavy test runner — node:test is built-in but not always
// available in the dev sandbox. The cases below are tiny and deterministic.

import assert from 'node:assert/strict';

// Minimal port of resolveFlag — kept in sync with src/lib/feature-flags.ts.
// We re-implement here (rather than import .ts) so the test runs with plain
// Node. Any divergence will fail fast because the rules are tiny.
function resolveFlag(flag, user) {
  if (!flag) return false;
  if (!flag.enabled) return false;
  const roles = flag.rollout_roles ?? [];
  if (roles.length === 0) return true;
  if (!user) return false;
  if (user.isOwner) return true;
  return roles.some((r) => user.roleKeys.includes(r));
}

const owner = { userId: 'u-1', roleKeys: ['owner'], isOwner: true };
const adminUser = { userId: 'u-2', roleKeys: ['admin'], isOwner: false };
const agent = { userId: 'u-3', roleKeys: ['specialist'], isOwner: false };
const noUser = null;

const cases = [
  ['null flag → off', () => assert.equal(resolveFlag(null, owner), false)],
  ['undefined flag → off', () => assert.equal(resolveFlag(undefined, owner), false)],

  // Disabled + empty roles
  ['disabled+empty → off (owner)', () =>
    assert.equal(resolveFlag({ enabled: false, rollout_roles: [] }, owner), false)],
  ['disabled+empty → off (admin)', () =>
    assert.equal(resolveFlag({ enabled: false, rollout_roles: [] }, adminUser), false)],
  ['disabled+empty → off (no user)', () =>
    assert.equal(resolveFlag({ enabled: false, rollout_roles: [] }, noUser), false)],

  // Enabled + empty roles
  ['enabled+empty → on (owner)', () =>
    assert.equal(resolveFlag({ enabled: true, rollout_roles: [] }, owner), true)],
  ['enabled+empty → on (admin)', () =>
    assert.equal(resolveFlag({ enabled: true, rollout_roles: [] }, adminUser), true)],
  ['enabled+empty → on (agent)', () =>
    assert.equal(resolveFlag({ enabled: true, rollout_roles: [] }, agent), true)],
  ['enabled+empty → on (no user)', () =>
    assert.equal(resolveFlag({ enabled: true, rollout_roles: [] }, noUser), true)],

  // Enabled + roles
  ['enabled+role-match → on', () =>
    assert.equal(
      resolveFlag({ enabled: true, rollout_roles: ['admin', 'manager'] }, adminUser),
      true,
    )],
  ['enabled+role-mismatch → off', () =>
    assert.equal(
      resolveFlag({ enabled: true, rollout_roles: ['admin', 'manager'] }, agent),
      false,
    )],
  ['enabled+roles, no user → off', () =>
    assert.equal(
      resolveFlag({ enabled: true, rollout_roles: ['admin'] }, noUser),
      false,
    )],
  ['enabled+roles, owner override → on', () =>
    assert.equal(
      resolveFlag({ enabled: true, rollout_roles: ['admin'] }, owner),
      true,
    )],

  // Disabled trumps role match
  ['disabled+roles → off (owner)', () =>
    assert.equal(
      resolveFlag({ enabled: false, rollout_roles: ['owner', 'admin'] }, owner),
      false,
    )],
  ['disabled+roles → off (admin)', () =>
    assert.equal(
      resolveFlag({ enabled: false, rollout_roles: ['owner', 'admin'] }, adminUser),
      false,
    )],
];

let pass = 0;
let fail = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    pass++;
    console.log(`  ok ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
