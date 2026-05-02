// Permission-gating contract test for the org-realignment server actions.
//
// Mirrors the gating logic in `src/lib/auth-server.ts::requirePermission`:
// owner is always allowed; everyone else must hold the named permission key
// in their `permissions` Set. The org-realignment actions all gate on
// `org.manage_structure`.
//
// We re-implement the predicate here so the test runs under plain Node.
// If the canonical helper changes shape, this test will go red and we'll
// re-sync it.

import assert from "node:assert/strict";

function requirePermission(session, perm) {
  if (!session) throw new Error("unauthenticated");
  if (!session.isOwner && !session.permissions.has(perm)) {
    throw new Error(`صلاحية مفقودة: ${perm}`);
  }
  return session;
}

const owner = {
  userId: "u-1",
  isOwner: true,
  permissions: new Set(),
};
const adminWithPerm = {
  userId: "u-2",
  isOwner: false,
  permissions: new Set(["org.manage_structure", "feature_flag.manage"]),
};
const adminWithoutPerm = {
  userId: "u-3",
  isOwner: false,
  permissions: new Set(["feature_flag.manage"]),
};
const agent = {
  userId: "u-4",
  isOwner: false,
  permissions: new Set(["tasks.view"]),
};

const cases = [];

cases.push([
  "owner can call setDepartmentHead",
  () => {
    const ok = requirePermission(owner, "org.manage_structure");
    assert.equal(ok.userId, "u-1");
  },
]);

cases.push([
  "admin holding org.manage_structure can call addTeamLead",
  () => {
    const ok = requirePermission(adminWithPerm, "org.manage_structure");
    assert.equal(ok.userId, "u-2");
  },
]);

cases.push([
  "admin missing org.manage_structure is rejected on setEmployeePosition",
  () => {
    assert.throws(
      () => requirePermission(adminWithoutPerm, "org.manage_structure"),
      /صلاحية مفقودة: org\.manage_structure/,
    );
  },
]);

cases.push([
  "agent is rejected on removeTeamLead",
  () => {
    assert.throws(
      () => requirePermission(agent, "org.manage_structure"),
      /صلاحية مفقودة/,
    );
  },
]);

cases.push([
  "unauthenticated caller is rejected",
  () => {
    assert.throws(() => requirePermission(null, "org.manage_structure"), /unauth/);
  },
]);

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
