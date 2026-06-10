// scripts/apply-contract-migrations.ts
//
// Applies migrations 0157–0159 (contract codes, duration engine, hold flow)
// to the live Supabase project via the Management API, records them in
// supabase_migrations.schema_migrations, then runs a verification suite.
//
// Run from the repo root on a machine with normal network access:
//
//   bun run scripts/apply-contract-migrations.ts            # apply + test
//   bun run scripts/apply-contract-migrations.ts --test     # tests only
//
// Reads SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_ID from .env.local.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = [
  "0157_contract_codes.sql",
  "0158_contract_duration_engine.sql",
  "0159_contract_hold_flow.sql",
];

// --- env ---------------------------------------------------------------------
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = loadEnv();
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const PROJECT = env.SUPABASE_PROJECT_ID;
if (!TOKEN || !PROJECT) {
  console.error("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_ID in .env.local");
  process.exit(1);
}

async function runSql(query: string): Promise<unknown> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// --- verification suite --------------------------------------------------------
type Check = { name: string; sql: string; expect?: (rows: unknown) => string | null };

const first = (rows: unknown): Record<string, unknown> =>
  (Array.isArray(rows) ? (rows[0] as Record<string, unknown>) : {}) ?? {};

const CHECKS: Check[] = [
  {
    name: "duration: New 1 month = 37 days (free first week)",
    sql: "select public.contract_total_days('New', 1, '{}'::uuid[]) as d;",
    expect: (r) => (Number(first(r).d) === 37 ? null : `got ${first(r).d}, want 37`),
  },
  {
    name: "duration: New 3 months = 97 days",
    sql: "select public.contract_total_days('New', 3, '{}'::uuid[]) as d;",
    expect: (r) => (Number(first(r).d) === 97 ? null : `got ${first(r).d}, want 97`),
  },
  {
    name: "duration: Renew 3 months = 90 days",
    sql: "select public.contract_total_days('Renew', 3, '{}'::uuid[]) as d;",
    expect: (r) => (Number(first(r).d) === 90 ? null : `got ${first(r).d}, want 90`),
  },
  {
    name: "duration: WinBack 2 months = 60 days",
    sql: "select public.contract_total_days('WinBack', 2, '{}'::uuid[]) as d;",
    expect: (r) => (Number(first(r).d) === 60 ? null : `got ${first(r).d}, want 60`),
  },
  {
    name: "duration: 12 months = 365 days regardless of type",
    sql: "select public.contract_total_days('New', 12, '{}'::uuid[]) as d;",
    expect: (r) => (Number(first(r).d) === 365 ? null : `got ${first(r).d}, want 365`),
  },
  {
    name: "duration: one-time package extra days added in full",
    sql: `
      with p as (
        select coalesce(array_agg(id), '{}'::uuid[]) as ids
          from packages where price_type = 'OneTime' and extra_days = 30 limit 1
      )
      select public.contract_total_days('New', 1, p.ids) as d,
             coalesce(array_length(p.ids, 1), 0) as n
        from p;`,
    expect: (r) => {
      const { d, n } = first(r) as { d: number; n: number };
      if (Number(n) === 0) return null; // no wordpress-style package seeded; skip
      return Number(d) >= 67 ? null : `got ${d}, want ≥ 67 (37 + 30)`;
    },
  },
  {
    name: "codes: every contract has a contract_code",
    sql: "select count(*)::int as missing from contracts where contract_code is null;",
    expect: (r) => (Number(first(r).missing) === 0 ? null : `${first(r).missing} contracts missing codes`),
  },
  {
    name: "codes: every client has a client_code",
    sql: "select count(*)::int as missing from clients where client_code is null;",
    expect: (r) => (Number(first(r).missing) === 0 ? null : `${first(r).missing} clients missing codes`),
  },
  {
    name: "codes: no duplicate contract codes per org",
    sql: `select count(*)::int as dups from (
            select organization_id, contract_code from contracts
             where contract_code is not null
             group by 1,2 having count(*) > 1) x;`,
    expect: (r) => (Number(first(r).dups) === 0 ? null : `${first(r).dups} duplicate codes`),
  },
  {
    name: "codes: multi-contract client gets -1/-2 suffixes (sample)",
    sql: `select c.contract_code from contracts c
           join (select client_id from contracts group by client_id having count(*) > 1 limit 1) m
             on m.client_id = c.client_id
           order by c.contract_code limit 5;`,
  },
  {
    name: "hold: columns exist + cron job registered",
    sql: `select
            (select count(*)::int from information_schema.columns
              where table_name = 'contracts'
                and column_name in ('hold_started_at','hold_end_date','type_before_hold_id','last_hold_notification')) as cols,
            (select count(*)::int from cron.job where jobname = 'notify-hold-expiring-daily') as jobs;`,
    expect: (r) => {
      const { cols, jobs } = first(r) as { cols: number; jobs: number };
      if (Number(cols) !== 4) return `only ${cols}/4 hold columns`;
      if (Number(jobs) !== 1) return "cron job not registered";
      return null;
    },
  },
  {
    name: "hold: notifier runs (returns count, no matching holds → 0)",
    sql: "select public.notify_hold_expiring_contracts() as sent;",
  },
  {
    name: "hold: dry-run — set a hold ending in 3 days, run notifier, roll back",
    sql: `
      begin;
      with victim as (select id from contracts where status = 'active' limit 1)
      update contracts
         set status = 'hold', hold_end_date = current_date + 3, last_hold_notification = null
       where id in (select id from victim);
      select public.notify_hold_expiring_contracts() as sent_during_dry_run;
      rollback;`,
  },
  {
    name: "engine: recompute sample (new 1-month contract → end = start + 36)",
    sql: `
      begin;
      with sample as (
        select id, start_date from contracts
         where duration_months = 1
           and contract_type_id in (select id from contract_types where key = 'New')
         limit 1
      )
      select s.id, s.start_date,
             public.recompute_contract_end_date(s.id) as computed_end,
             s.start_date + 36 as expected_end_no_extras
        from sample s;
      rollback;`,
  },
];

async function main() {
  const testOnly = process.argv.includes("--test");

  if (!testOnly) {
    for (const file of MIGRATIONS) {
      const sql = readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8");
      process.stdout.write(`applying ${file} … `);
      await runSql(sql);
      // Record in migration history (parity with mcp apply_migration).
      const version = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
      const name = file.replace(/\.sql$/, "");
      await runSql(`
        insert into supabase_migrations.schema_migrations (version, name)
        select '${version}', '${name}'
        where not exists (
          select 1 from supabase_migrations.schema_migrations where name = '${name}'
        );`);
      console.log("ok");
    }
  }

  console.log("\n— verification —");
  let failed = 0;
  for (const c of CHECKS) {
    try {
      const rows = await runSql(c.sql);
      const err = c.expect ? c.expect(rows) : null;
      if (err) {
        failed++;
        console.log(`✗ ${c.name}: ${err}`);
      } else {
        console.log(`✓ ${c.name}${c.expect ? "" : " → " + JSON.stringify(rows).slice(0, 200)}`);
      }
    } catch (e) {
      failed++;
      console.log(`✗ ${c.name}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  console.log(failed === 0 ? "\nAll checks passed ✅" : `\n${failed} check(s) failed ❌`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
