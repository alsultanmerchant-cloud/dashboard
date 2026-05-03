// Phase T7.5-finish — Monthly Cycle Roller edge function.
//
// Cron: 1st of each month, 06:00 Asia/Riyadh.
//   ┌── recommended supabase cron expression (UTC):
//   │   "0 3 1 * *"   (06:00 Riyadh = 03:00 UTC; Riyadh has no DST)
//
// For every contract with status='active':
//   1. cycle_no = max(existing cycle_no for this contract) + 1
//   2. month    = first day of current month in Asia/Riyadh
//   3. expected_meeting_date = month + COALESCE(packages.grace_days, 7)
//   4. INSERT into monthly_cycles. Skip if (contract_id, cycle_no) already
//      exists (the unique constraint also covers this — we treat the duplicate
//      error as a no-op).
//   5. Insert one notifications row to the AM (kind='MONTHLY_CYCLE_DUE').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

type ContractRow = {
  id: string;
  organization_id: string;
  account_manager_id: string | null;
  package_id: string | null;
};

type PackageRow = {
  id: string;
  grace_days: number | null;
};

function riyadhMonthStartIso(): string {
  // The Asia/Riyadh offset is fixed at +03:00 (no DST).
  const now = new Date();
  const riy = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return `${riy.getUTCFullYear()}-${String(riy.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadPackages(ids: string[]): Promise<Map<string, PackageRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("packages")
    .select("id, grace_days")
    .in("id", ids);
  if (error) throw error;
  const out = new Map<string, PackageRow>();
  for (const p of (data ?? []) as PackageRow[]) out.set(p.id, p);
  return out;
}

async function nextCycleNo(contractId: string): Promise<number> {
  const { data } = await supabase
    .from("monthly_cycles")
    .select("cycle_no")
    .eq("contract_id", contractId)
    .order("cycle_no", { ascending: false })
    .limit(1);
  return (data?.[0]?.cycle_no ?? 0) + 1;
}

async function notifyAm(params: {
  organizationId: string;
  amEmployeeId: string;
  contractId: string;
  monthIso: string;
}) {
  // Resolve AM user_id from employee_profiles.
  const { data: emp } = await supabase
    .from("employee_profiles")
    .select("user_id")
    .eq("id", params.amEmployeeId)
    .maybeSingle();
  if (!emp?.user_id) return;

  await supabase.from("notifications").insert({
    organization_id: params.organizationId,
    recipient_user_id: emp.user_id,
    type: "MONTHLY_CYCLE_DUE",
    title: "دورة شهرية جديدة",
    body: `بدأت دورة جديدة لشهر ${params.monthIso}. حدّد موعد اجتماع المتابعة.`,
    entity_type: "contract",
    entity_id: params.contractId,
  });
}

async function processContract(
  c: ContractRow,
  pkgs: Map<string, PackageRow>,
  monthIso: string,
) {
  const cycleNo = await nextCycleNo(c.id);
  const grace = (c.package_id ? pkgs.get(c.package_id)?.grace_days : null) ?? 7;
  const expectedMeeting = addDays(monthIso, grace);

  const { error } = await supabase.from("monthly_cycles").insert({
    organization_id: c.organization_id,
    contract_id: c.id,
    cycle_no: cycleNo,
    month: monthIso,
    grace_days: grace,
    expected_meeting_date: expectedMeeting,
    state: "pending",
  });
  if (error) {
    // Duplicate (contract_id, cycle_no) → already rolled this month, skip.
    if (error.code === "23505") return { skipped: true };
    throw error;
  }

  if (c.account_manager_id) {
    await notifyAm({
      organizationId: c.organization_id,
      amEmployeeId: c.account_manager_id,
      contractId: c.id,
      monthIso,
    });
  }

  await supabase.from("ai_events").insert({
    organization_id: c.organization_id,
    event_type: "CONTRACT_CYCLE_ROLLED",
    entity_type: "contract",
    entity_id: c.id,
    payload: { cycle_no: cycleNo, month: monthIso, grace_days: grace },
    importance: "normal",
  });

  return { skipped: false };
}

async function run() {
  const monthIso = riyadhMonthStartIso();

  const { data: contracts, error } = await supabase
    .from("contracts")
    .select("id, organization_id, account_manager_id, package_id")
    .eq("status", "active");
  if (error) throw error;

  const pkgIds = [
    ...new Set(
      ((contracts ?? []) as ContractRow[])
        .map((c) => c.package_id)
        .filter((x): x is string => !!x),
    ),
  ];
  const pkgs = await loadPackages(pkgIds);

  let processed = 0;
  let skipped = 0;
  for (const c of (contracts ?? []) as ContractRow[]) {
    try {
      const res = await processContract(c, pkgs, monthIso);
      if (res?.skipped) skipped += 1;
      else processed += 1;
    } catch (e) {
      console.error("[monthly-cycle-roller] contract failed", c.id, (e as Error).message);
    }
  }
  return { month: monthIso, contracts: contracts?.length ?? 0, processed, skipped };
}

Deno.serve(async () => {
  try {
    const result = await run();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
