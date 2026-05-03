// RLS attack test for the tasks_select policy tightened by migration 0022.
//
// Self-running. From the repo root:
//   bun run tests/rls-attack.test.mjs
//   node tests/rls-attack.test.mjs
//
// What this proves
// ----------------
// Migration 0022 narrowed `public.tasks` SELECT visibility to:
//   1. callers with the global `task.view_all` permission, OR
//   2. callers on `public.task_assignees` for the row, OR
//   3. callers who created the row (`tasks.created_by = auth.uid()`).
//
// We model a non-privileged "Agent" by:
//   - creating an ephemeral auth.user via the service-role admin API,
//   - inserting an `employee_profiles` row into the seeded org,
//   - granting them ONLY the `specialist` role (which does NOT carry
//     `task.view_all` — see migration 0022 binding list).
//
// Then we sign that user in with the anon key (so the request goes through
// PostgREST + RLS, NOT the service role) and read `public.tasks`. The seeded
// org has tasks owned by alsultain (owner) and never assigned to our
// ephemeral user, so the expected row count is exactly ZERO.
//
// We also assert the positive case: as the seeded owner the same anon-key
// query returns >0 rows. Both assertions together prove (a) RLS is on, and
// (b) the policy correctly admits the privileged caller while blocking the
// unprivileged one.
//
// Cleanup runs in a `finally` so a failed assertion still drops the user.
//
// This test requires:
//   - .env.local with NEXT_PUBLIC_SUPABASE_URL,
//     NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
//   - Network access to the project URL.
// If those are missing, the test prints `SKIP` and exits 0 — the same
// fail-soft pattern T0 used (`tests/feature-flags.test.mjs`) so CI/sandbox
// runs that lack secrets do not appear red.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ORG_ID = "11111111-1111-1111-1111-111111111111"; // rawasm-demo
const OWNER_EMAIL = "alsultain@agency.com";
const OWNER_PASSWORD = "alsultain22";

function loadEnv() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return {};
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .reduce((acc, line) => {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) acc[m[1]] = m[2].replace(/^["']|["']$/g, "");
      return acc;
    }, {});
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.log("SKIP rls-attack: missing Supabase credentials in .env.local");
  process.exit(0);
}

// ---------- thin REST helpers (no @supabase/supabase-js dep) ---------------

async function adminCreateUser(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`createUser ${r.status} ${await r.text()}`);
  return r.json();
}

async function adminDeleteUser(userId) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok && r.status !== 404)
    console.warn(`deleteUser ${r.status} ${await r.text()}`);
}

async function serviceInsert(table, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insert ${table} ${r.status} ${await r.text()}`);
  return r.json();
}

async function serviceQuery(sql) {
  // For lookups (role id, employee id) we use PostgREST query params instead
  // of raw SQL to avoid needing the Mgmt API token here.
  return fetch(sql, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).then((r) => r.json());
}

async function signIn(email, password) {
  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!r.ok) throw new Error(`signIn ${r.status} ${await r.text()}`);
  return r.json(); // { access_token, ... }
}

async function userQueryTasks(accessToken) {
  // Anon-key + bearer access_token => request goes through RLS as that user.
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/tasks?select=id,organization_id&limit=200`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (!r.ok) throw new Error(`tasks ${r.status} ${await r.text()}`);
  return r.json();
}

// ---------- test scenario --------------------------------------------------

const stamp = Date.now();
const ephemeralEmail = `rls-attack-${stamp}@agency.test`;
const ephemeralPassword = `Rls!Attack#${stamp}`;

let ephemeralUserId = null;
let ephemeralEmployeeId = null;

let pass = 0;
let fail = 0;
function record(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass++;
      console.log(`  ok ${name}`);
    })
    .catch((e) => {
      fail++;
      console.log(`  FAIL ${name}: ${e.message}`);
    });
}

try {
  // 1. Create ephemeral user.
  const created = await adminCreateUser(ephemeralEmail, ephemeralPassword);
  ephemeralUserId = created.id ?? created.user?.id;
  if (!ephemeralUserId) throw new Error("no user id from admin/users");

  // 2. Insert employee_profiles row in the seeded org.
  const empRows = await serviceInsert("employee_profiles", {
    user_id: ephemeralUserId,
    organization_id: ORG_ID,
    full_name: "RLS Attack Tester",
    email: ephemeralEmail,
  });
  ephemeralEmployeeId = empRows[0]?.id;
  if (!ephemeralEmployeeId) throw new Error("no employee_profiles id");

  // 3. Grant only the `specialist` role (no task.view_all binding).
  const roleLookup = await serviceQuery(
    `${SUPABASE_URL}/rest/v1/roles?key=eq.specialist&select=id`,
  );
  const specialistRoleId = roleLookup[0]?.id;
  if (!specialistRoleId) throw new Error("specialist role missing");
  await serviceInsert("user_roles", {
    user_id: ephemeralUserId,
    role_id: specialistRoleId,
    organization_id: ORG_ID,
  });

  // 4. NEGATIVE — ephemeral user reads tasks via anon key + their JWT.
  await record("ephemeral specialist sees zero tasks", async () => {
    const token = (await signIn(ephemeralEmail, ephemeralPassword))
      .access_token;
    const rows = await userQueryTasks(token);
    assert.equal(
      rows.length,
      0,
      `expected 0 rows, got ${rows.length} — RLS leak`,
    );
  });

  // 5. POSITIVE — owner sees >0 tasks under the same RLS path. Catches the
  //    "policy is so tight nobody can read anything" failure mode.
  await record("seeded owner sees >0 tasks", async () => {
    const token = (await signIn(OWNER_EMAIL, OWNER_PASSWORD)).access_token;
    const rows = await userQueryTasks(token);
    assert.ok(rows.length > 0, "owner should see some tasks");
  });

  // 6. CONTRACT — assigning the ephemeral user to one task lets them see
  //    exactly that task and nothing else. Proves the assignee branch works
  //    in isolation from the view_all branch.
  await record("assignee branch admits exactly the assigned task", async () => {
    // Pick any task in the org owned by someone other than the ephemeral
    // user (every task is owned by the owner).
    const taskLookup = await serviceQuery(
      `${SUPABASE_URL}/rest/v1/tasks?select=id&organization_id=eq.${ORG_ID}&limit=1`,
    );
    const targetTaskId = taskLookup[0]?.id;
    if (!targetTaskId) throw new Error("no task to assign");

    await serviceInsert("task_assignees", {
      organization_id: ORG_ID,
      task_id: targetTaskId,
      employee_id: ephemeralEmployeeId,
      role_type: "specialist",
      assigned_by: ephemeralUserId,
    });

    const token = (await signIn(ephemeralEmail, ephemeralPassword))
      .access_token;
    const rows = await userQueryTasks(token);
    assert.equal(rows.length, 1, `expected exactly 1 row, got ${rows.length}`);
    assert.equal(rows[0].id, targetTaskId, "wrong task id surfaced");
  });
} finally {
  // Cleanup. Order matters: assignees → user_roles → employee → user.
  if (ephemeralEmployeeId) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/task_assignees?employee_id=eq.${ephemeralEmployeeId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    ).catch(() => {});
  }
  if (ephemeralUserId) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${ephemeralUserId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    ).catch(() => {});
    await fetch(
      `${SUPABASE_URL}/rest/v1/employee_profiles?user_id=eq.${ephemeralUserId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    ).catch(() => {});
    await adminDeleteUser(ephemeralUserId).catch(() => {});
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
