"use server";

// Phase T7.5-finish — Commercial Layer server actions.
//
// Mutation contract:
//   zod validate → requirePermission('contract.manage') → org-scope check
//   → write audit_log + ai_event when business-relevant.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ContractActionState = { ok: true; id?: string } | { error: string };

// ---------------------------------------------------------------------------
// recordContractEvent
// ---------------------------------------------------------------------------
const RecordEventSchema = z.object({
  contract_id: z.string().regex(UUID_RE),
  event_type: z.string().trim().min(1).max(100),
  payload_json: z.string().optional(),
  note: z.string().trim().max(2000).optional(),
});

export async function recordContractEventAction(
  _prev: ContractActionState | undefined,
  formData: FormData,
): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = RecordEventSchema.safeParse({
    contract_id: formData.get("contract_id"),
    event_type: formData.get("event_type"),
    payload_json: formData.get("payload_json") ?? undefined,
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  // Org-scope check.
  const { data: contract } = await supabaseAdmin
    .from("contracts")
    .select("id, organization_id")
    .eq("id", parsed.data.contract_id)
    .maybeSingle();
  if (!contract || contract.organization_id !== session.orgId) {
    return { error: "العقد غير موجود" };
  }

  let payload: Record<string, unknown> = {};
  if (parsed.data.payload_json) {
    try {
      payload = JSON.parse(parsed.data.payload_json) ?? {};
    } catch {
      return { error: "payload JSON غير صالح" };
    }
  }
  if (parsed.data.note) payload.note = parsed.data.note;

  const { data: row, error } = await supabaseAdmin
    .from("contract_events")
    .insert({
      organization_id: session.orgId,
      contract_id: contract.id,
      event_type: parsed.data.event_type,
      actor_id: session.employeeId,
      payload,
    })
    .select("id")
    .single();
  if (error || !row) return { error: error?.message ?? "تعذّر تسجيل الحدث" };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contract.record_event",
    entityType: "contract",
    entityId: contract.id,
    metadata: { event_type: parsed.data.event_type, event_id: row.id },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "CONTRACT_EVENT_RECORDED",
    entityType: "contract",
    entityId: contract.id,
    payload: { event_type: parsed.data.event_type, event_id: row.id },
    importance: "normal",
  });

  revalidatePath(`/contracts/${contract.id}`);
  revalidatePath("/contracts");
  return { ok: true, id: row.id };
}

// ---------------------------------------------------------------------------
// recordInstallmentReceived
// ---------------------------------------------------------------------------
const ReceiveSchema = z.object({
  installment_id: z.string().regex(UUID_RE),
  actual_date: z.string().regex(DATE_RE),
  actual_amount: z.coerce.number().nonnegative(),
});

export async function recordInstallmentReceivedAction(
  _prev: ContractActionState | undefined,
  formData: FormData,
): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ReceiveSchema.safeParse({
    installment_id: formData.get("installment_id"),
    actual_date: formData.get("actual_date"),
    actual_amount: formData.get("actual_amount"),
  });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const { data: inst } = await supabaseAdmin
    .from("installments")
    .select(
      "id, organization_id, contract_id, expected_amount, actual_amount, status",
    )
    .eq("id", parsed.data.installment_id)
    .maybeSingle();
  if (!inst || inst.organization_id !== session.orgId) {
    return { error: "الدفعة غير موجودة" };
  }

  const expected = Number(inst.expected_amount || 0);
  const actual = parsed.data.actual_amount;
  const newStatus =
    actual <= 0
      ? "pending"
      : actual + 0.01 < expected
        ? "partial"
        : "received";

  const { error: updErr } = await supabaseAdmin
    .from("installments")
    .update({
      actual_date: parsed.data.actual_date,
      actual_amount: actual,
      status: newStatus,
    })
    .eq("id", inst.id);
  if (updErr) return { error: updErr.message };

  // Bump contracts.paid_value: recompute from sum(actual_amount).
  const { data: sumRows } = await supabaseAdmin
    .from("installments")
    .select("actual_amount")
    .eq("contract_id", inst.contract_id);
  const paidSum = (sumRows ?? []).reduce(
    (s, r) => s + Number(r.actual_amount || 0),
    0,
  );
  await supabaseAdmin
    .from("contracts")
    .update({ paid_value: paidSum })
    .eq("id", inst.contract_id);

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contract.installment_received",
    entityType: "installment",
    entityId: inst.id,
    metadata: {
      contract_id: inst.contract_id,
      actual_amount: actual,
      actual_date: parsed.data.actual_date,
      status: newStatus,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "CONTRACT_INSTALLMENT_RECEIVED",
    entityType: "contract",
    entityId: inst.contract_id,
    payload: {
      installment_id: inst.id,
      actual_amount: actual,
      status: newStatus,
      paid_value_total: paidSum,
    },
    importance: "high",
  });

  revalidatePath(`/contracts/${inst.contract_id}`);
  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  return { ok: true, id: inst.id };
}

// ---------------------------------------------------------------------------
// recordMonthlyMeeting
// ---------------------------------------------------------------------------
const MeetingSchema = z.object({
  cycle_id: z.string().regex(UUID_RE),
  actual_date: z.string().regex(DATE_RE),
  status: z.enum(["on-time", "late", "missed"]),
  delay_days: z.coerce.number().int().min(0).max(365).optional(),
});

export async function recordMonthlyMeetingAction(
  _prev: ContractActionState | undefined,
  formData: FormData,
): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = MeetingSchema.safeParse({
    cycle_id: formData.get("cycle_id"),
    actual_date: formData.get("actual_date"),
    status: formData.get("status"),
    delay_days: formData.get("delay_days") ?? undefined,
  });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const { data: cycle } = await supabaseAdmin
    .from("monthly_cycles")
    .select("id, organization_id, contract_id, expected_meeting_date")
    .eq("id", parsed.data.cycle_id)
    .maybeSingle();
  if (!cycle || cycle.organization_id !== session.orgId) {
    return { error: "الدورة غير موجودة" };
  }

  let delay = parsed.data.delay_days ?? 0;
  if (delay === 0 && cycle.expected_meeting_date) {
    const exp = new Date(`${cycle.expected_meeting_date}T00:00:00.000Z`).getTime();
    const act = new Date(`${parsed.data.actual_date}T00:00:00.000Z`).getTime();
    delay = Math.max(0, Math.round((act - exp) / 86_400_000));
  }

  const { error: updErr } = await supabaseAdmin
    .from("monthly_cycles")
    .update({
      actual_meeting_date: parsed.data.actual_date,
      meeting_status: parsed.data.status,
      meeting_delay_days: delay,
      state: parsed.data.status === "missed" ? "skipped" : "done",
    })
    .eq("id", cycle.id);
  if (updErr) return { error: updErr.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contract.record_meeting",
    entityType: "monthly_cycle",
    entityId: cycle.id,
    metadata: {
      contract_id: cycle.contract_id,
      status: parsed.data.status,
      delay_days: delay,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "CONTRACT_MEETING_RECORDED",
    entityType: "contract",
    entityId: cycle.contract_id,
    payload: {
      cycle_id: cycle.id,
      status: parsed.data.status,
      delay_days: delay,
    },
    importance: parsed.data.status === "missed" ? "high" : "normal",
  });

  revalidatePath(`/contracts/${cycle.contract_id}`);
  return { ok: true, id: cycle.id };
}

// ---------------------------------------------------------------------------
// addCycle — manually add the next monthly_cycles row for a contract.
// ---------------------------------------------------------------------------
const AddCycleSchema = z.object({
  contract_id: z.string().regex(UUID_RE),
  month: z.string().regex(DATE_RE),
  expected_meeting_date: z.string().regex(DATE_RE).optional(),
  grace_days: z.coerce.number().int().min(0).max(60).optional(),
});

export async function addCycleAction(
  _prev: ContractActionState | undefined,
  formData: FormData,
): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = AddCycleSchema.safeParse({
    contract_id: formData.get("contract_id"),
    month: formData.get("month"),
    expected_meeting_date: formData.get("expected_meeting_date") ?? undefined,
    grace_days: formData.get("grace_days") ?? undefined,
  });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const { data: contract } = await supabaseAdmin
    .from("contracts")
    .select("id, organization_id, package_id")
    .eq("id", parsed.data.contract_id)
    .maybeSingle();
  if (!contract || contract.organization_id !== session.orgId) {
    return { error: "العقد غير موجود" };
  }

  const { data: existing } = await supabaseAdmin
    .from("monthly_cycles")
    .select("cycle_no")
    .eq("contract_id", contract.id)
    .order("cycle_no", { ascending: false })
    .limit(1);
  const nextNo = (existing?.[0]?.cycle_no ?? 0) + 1;

  let grace = parsed.data.grace_days;
  if (grace == null && contract.package_id) {
    const { data: pkg } = await supabaseAdmin
      .from("packages")
      .select("grace_days")
      .eq("id", contract.package_id)
      .maybeSingle();
    grace = pkg?.grace_days ?? 7;
  }
  grace = grace ?? 7;

  let expectedMeeting = parsed.data.expected_meeting_date;
  if (!expectedMeeting) {
    const m = new Date(`${parsed.data.month}T00:00:00.000Z`);
    m.setUTCDate(m.getUTCDate() + grace);
    expectedMeeting = m.toISOString().slice(0, 10);
  }

  const { data: row, error } = await supabaseAdmin
    .from("monthly_cycles")
    .insert({
      organization_id: session.orgId,
      contract_id: contract.id,
      cycle_no: nextNo,
      month: parsed.data.month,
      grace_days: grace,
      expected_meeting_date: expectedMeeting,
      state: "pending",
    })
    .select("id")
    .single();
  if (error || !row) return { error: error?.message ?? "تعذّر إضافة الدورة" };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contract.add_cycle",
    entityType: "monthly_cycle",
    entityId: row.id,
    metadata: {
      contract_id: contract.id,
      cycle_no: nextNo,
      month: parsed.data.month,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "CONTRACT_CYCLE_ADDED",
    entityType: "contract",
    entityId: contract.id,
    payload: { cycle_id: row.id, cycle_no: nextNo, month: parsed.data.month },
    importance: "normal",
  });

  revalidatePath(`/contracts/${contract.id}`);
  return { ok: true, id: row.id };
}
