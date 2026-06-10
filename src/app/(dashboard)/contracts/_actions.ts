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

// Shift an ISO date by N calendar days (N may be negative). UTC math so a
// daylight-saving boundary can't drop or add a day.
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type ContractActionState = { ok: true; id?: string } | { error: string };

// Today's date in ISO (UTC) — shared by the hold/installment helpers.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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

// ---------------------------------------------------------------------------
// updateContractFieldAction — single-cell inline-edit gateway for the grid.
//
// The new /contracts grid edits one cell at a time. Rather than a separate
// action per field (which would balloon to ~15 endpoints), we route every
// edit through one action with a discriminated payload. Per-field zod
// validation runs server-side so a hand-rolled HTTP call can't bypass the
// enum/check constraints. All mutations log to audit_log; the
// business-relevant ones (target/status/renewed_status) also emit an
// ai_event so the assistant can answer "which contracts moved to On Target
// this week" without re-scanning the row history.
// ---------------------------------------------------------------------------

const TARGET_VALUES = [
  "Overdue",
  "Sales Deposit",
  "On Target",
  "Closed",
  "Lost",
  "Renewed",
] as const;
const STATUS_VALUES = [
  "active",
  "hold",
  "closed",
  "expired",
  "lost",
  "renewed",
] as const;
const RENEWED_VALUES = ["YES", "NO", "Closed"] as const;
const PAYMENT_VALUES = ["Complete", "Installments"] as const;

const FieldUpdateSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("target"), value: z.enum(TARGET_VALUES) }),
  z.object({ field: z.literal("status"), value: z.enum(STATUS_VALUES) }),
  z.object({
    field: z.literal("renewed_status"),
    value: z.enum(RENEWED_VALUES).nullable(),
  }),
  z.object({
    field: z.literal("payment_status"),
    value: z.enum(PAYMENT_VALUES).nullable(),
  }),
  z.object({
    field: z.literal("contract_type_id"),
    value: z.string().regex(UUID_RE).nullable(),
  }),
  z.object({
    field: z.literal("account_manager_id"),
    value: z.string().regex(UUID_RE).nullable(),
  }),
  z.object({
    field: z.literal("notes"),
    value: z.string().trim().max(4000).nullable(),
  }),
  // Money fields — finite numbers, capped to keep typos from blowing the
  // running totals on the dashboard.
  z.object({
    field: z.enum([
      "total_value",
      "paid_value",
      "next_contract_value",
      "renewal_paid_value",
      "repeated_services_value",
    ]),
    value: z.number().finite().min(0).max(10_000_000).nullable(),
  }),
  // Date fields — ISO date only, nullable.
  z.object({
    field: z.enum(["start_date", "end_date", "actual_end_date"]),
    value: z.string().regex(DATE_RE).nullable(),
  }),
  // Small int fields.
  z.object({
    field: z.enum(["duration_months", "delay_days"]),
    value: z.number().int().min(0).max(3650).nullable(),
  }),
  // Extension days — SIGNED: +N pushes the expected end date out, −N pulls it
  // in. Unlike the others this is an input the team drives, not a derived read.
  z.object({
    field: z.literal("extension_days"),
    value: z.number().int().min(-3650).max(3650).nullable(),
  }),
]);

// Field set that warrants an ai_event in addition to audit_log: these are
// the ones the team's renewal-funnel workflow keys on.
const AI_RELEVANT_FIELDS = new Set([
  "target",
  "status",
  "renewed_status",
  "contract_type_id",
]);

export async function updateContractFieldAction(input: {
  id: string;
  field: string;
  value: string | number | null;
}): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  if (!UUID_RE.test(input.id)) return { error: "معرف عقد غير صالح" };

  const parsed = FieldUpdateSchema.safeParse({
    field: input.field,
    value: input.value,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "بيانات غير صالحة";
    return { error: msg };
  }

  // Org-scope + fetch before-state for the audit log. PostgREST + the
  // generated supabase types model the column union as a union, so cast
  // through unknown to a flat record for the field-name index.
  const { data: beforeRaw } = await supabaseAdmin
    .from("contracts")
    .select(
      "id, organization_id, target, status, renewed_status, payment_status, " +
        "contract_type_id, account_manager_id, notes, total_value, paid_value, " +
        "next_contract_value, renewal_paid_value, repeated_services_value, " +
        "start_date, end_date, actual_end_date, original_end_date, " +
        "duration_months, extension_days, delay_days",
    )
    .eq("id", input.id)
    .maybeSingle();
  const before = beforeRaw as unknown as Record<string, unknown> | null;
  if (!before || before.organization_id !== session.orgId) {
    return { error: "العقد غير موجود" };
  }

  const previousValue = before[parsed.data.field] ?? null;
  // No-op short-circuit: avoids audit-log noise when the user picks the
  // same value, which happens often with dropdowns.
  if (previousValue === parsed.data.value) return { ok: true, id: input.id };

  // Hold transitions must go through the dedicated actions so the end-date
  // popup, snapshot and diff logging can't be skipped (sheet-parity guard).
  if (parsed.data.field === "contract_type_id") {
    if (before.status === "hold") {
      return {
        error:
          "العقد موقوف حاليًا — استخدمي زر «رفع الإيقاف» لتغيير النوع",
      };
    }
    if (parsed.data.value) {
      const { data: newType } = await supabaseAdmin
        .from("contract_types")
        .select("key")
        .eq("id", parsed.data.value)
        .maybeSingle();
      if (newType?.key === "Hold") {
        return {
          error: "اختيار Hold يتم من نافذة الإيقاف لتحديد تاريخ نهاية الإيقاف",
        };
      }
    }
  }

  // Extension is an INPUT, not a derived read: editing تمديد re-bases the
  // expected end date off the original baseline (+N days out, −N in). We write
  // the new end_date; the recompute trigger then refreshes total_days and
  // re-derives extension_days to match, so everything stays consistent.
  if (parsed.data.field === "extension_days") {
    const ext = parsed.data.value;
    const baseline =
      (before.original_end_date as string | null) ??
      (before.end_date as string | null);
    if (ext != null && !baseline) {
      return { error: "حدّد تاريخ النهاية المتوقعة أولًا قبل التمديد" };
    }
    const extPatch: Record<string, unknown> = { extension_days: ext };
    if (baseline) {
      // ext null → clear the extension and snap back to the baseline.
      extPatch.end_date = ext == null ? baseline : addDaysIso(baseline, ext);
      // Pin a stable baseline for legacy rows (null original_end_date) so a
      // second extension re-bases off the original instead of compounding.
      if (!before.original_end_date) extPatch.original_end_date = baseline;
    }
    const { error: extErr } = await supabaseAdmin
      .from("contracts")
      .update(extPatch)
      .eq("id", input.id);
    if (extErr) return { error: extErr.message };

    await logAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      action: "contract.update_field",
      entityType: "contract",
      entityId: input.id,
      metadata: { field: "extension_days", from: previousValue, to: ext },
    });

    revalidatePath("/contracts");
    revalidatePath(`/contracts/${input.id}`);
    return { ok: true, id: input.id };
  }

  const patch: Record<string, unknown> = { [parsed.data.field]: parsed.data.value };
  // contract_type_id → also refresh package_name? No — they're orthogonal.
  // status / renewed_status / target are intentionally independent because
  // the team uses them to mean different things (status = lifecycle,
  // target = AM health, renewed_status = end-of-cycle outcome).

  const { error } = await supabaseAdmin
    .from("contracts")
    .update(patch)
    .eq("id", input.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contract.update_field",
    entityType: "contract",
    entityId: input.id,
    metadata: {
      field: parsed.data.field,
      from: previousValue,
      to: parsed.data.value,
    },
  });

  if (AI_RELEVANT_FIELDS.has(parsed.data.field)) {
    await logAiEvent({
      organizationId: session.orgId,
      actorUserId: session.userId,
      eventType: "CONTRACT_FIELD_CHANGED",
      entityType: "contract",
      entityId: input.id,
      payload: {
        field: parsed.data.field,
        from: previousValue,
        to: parsed.data.value,
      },
      importance:
        parsed.data.field === "renewed_status" && parsed.data.value === "NO"
          ? "high"
          : "normal",
    });
  }

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${input.id}`);
  return { ok: true, id: input.id };
}

// ---------------------------------------------------------------------------
// createContractAction — new-row creation from the grid header.
//
// The team's sheet has rows added by hand; the dashboard equivalent is a
// modal triggered by the "+ عقد جديد" button. Minimum payload mirrors the
// sheet's required cells: client, AM, type, start date, package, total
// value. Everything else falls back to safe defaults (target = Overdue,
// status = active, payment_status = Complete). The team can then refine
// each cell inline.
// ---------------------------------------------------------------------------

const CreateContractSchema = z.object({
  client_id: z.string().regex(UUID_RE),
  account_manager_id: z.string().regex(UUID_RE).nullable(),
  contract_type_id: z.string().regex(UUID_RE).nullable(),
  // Multi-package, like the sheet's comma-separated Package column. First
  // entry doubles as the primary package_id for legacy reads.
  package_ids: z.array(z.string().regex(UUID_RE)).max(15).default([]),
  start_date: z.string().regex(DATE_RE),
  duration_months: z.number().int().min(0).max(120).nullable(),
  total_value: z.number().finite().min(0).max(10_000_000),
  paid_value: z.number().finite().min(0).max(10_000_000).nullable(),
  payment_status: z.enum(PAYMENT_VALUES),
  notes: z.string().trim().max(4000).nullable(),
});

export async function createContractAction(input: {
  client_id: string;
  account_manager_id: string | null;
  contract_type_id: string | null;
  package_ids: string[];
  start_date: string;
  duration_months: number | null;
  total_value: number;
  paid_value: number | null;
  payment_status: "Complete" | "Installments";
  notes: string | null;
}): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = CreateContractSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  // Org-scope: client must belong to this org.
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, organization_id, external_id")
    .eq("id", parsed.data.client_id)
    .maybeSingle();
  if (!client || client.organization_id !== session.orgId) {
    return { error: "العميل غير موجود" };
  }

  // External key matches the importer's convention so manual rows + future
  // re-imports don't collide on the same client.
  const startNoDash = parsed.data.start_date.replace(/-/g, "");
  const clientExt = client.external_id ?? client.id.slice(0, 8);
  const externalId = `${clientExt}|${startNoDash}`;

  // Pre-resolve the package names + type label for the denormalized fields
  // the grid reads when the embedded join isn't refreshed yet. Joined with
  // «، » to mirror the sheet's comma-list Package column.
  const pkgIds = parsed.data.package_ids;
  let packageName: string | null = null;
  if (pkgIds.length > 0) {
    const { data: pkgs } = await supabaseAdmin
      .from("packages")
      .select("id, name_ar")
      .in("id", pkgIds);
    const byId = new Map((pkgs ?? []).map((p) => [p.id, p.name_ar]));
    packageName =
      pkgIds.map((id) => byId.get(id)).filter(Boolean).join("، ") || null;
  }
  let amName: string | null = null;
  if (parsed.data.account_manager_id) {
    const { data: am } = await supabaseAdmin
      .from("employee_profiles")
      .select("full_name")
      .eq("id", parsed.data.account_manager_id)
      .maybeSingle();
    amName = am?.full_name ?? null;
  }

  const { data: row, error } = await supabaseAdmin
    .from("contracts")
    .insert({
      organization_id: session.orgId,
      external_source: "dashboard",
      external_id: externalId,
      client_id: parsed.data.client_id,
      account_manager_id: parsed.data.account_manager_id,
      account_manager_name: amName,
      contract_type_id: parsed.data.contract_type_id,
      package_id: pkgIds[0] ?? null,
      package_name: packageName,
      start_date: parsed.data.start_date,
      // end_date is computed below by the sheet-parity duration engine
      // (recompute_contract_end_date) once the package links exist.
      end_date: null,
      duration_months: parsed.data.duration_months,
      total_value: parsed.data.total_value,
      paid_value: parsed.data.paid_value ?? 0,
      target: "Overdue",
      status: "active",
      payment_status: parsed.data.payment_status,
      notes: parsed.data.notes,
    })
    .select("id")
    .single();
  if (error || !row) {
    return { error: error?.message ?? "تعذّر إنشاء العقد" };
  }

  // Mirror into the junction so multi-package reads stay uniform with the
  // imported rows. Order preserved = the user's selection order.
  if (pkgIds.length > 0) {
    await supabaseAdmin.from("contract_packages").insert(
      pkgIds.map((id, i) => ({
        contract_id: row.id,
        package_id: id,
        sort_order: i,
      })),
    );
  }

  // Sheet-parity duration engine (migration 0158): 37 + (m−1)×30 for new
  // clients (free first week), m×30 for renewals/win-back, 365 for 12 months,
  // plus one-time package extra days (15/30) and monthly extras capped at 15.
  // Must run AFTER the contract_packages insert so extras are visible.
  const { error: endErr } = await supabaseAdmin.rpc(
    "recompute_contract_end_date",
    { p_contract: row.id },
  );
  if (endErr) {
    // Non-fatal: the contract exists; the end date can be recomputed later.
    console.error("recompute_contract_end_date failed", endErr.message);
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contract.create",
    entityType: "contract",
    entityId: row.id,
    metadata: {
      client_id: parsed.data.client_id,
      external_id: externalId,
      total_value: parsed.data.total_value,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "CONTRACT_CREATED",
    entityType: "contract",
    entityId: row.id,
    payload: {
      client_id: parsed.data.client_id,
      total_value: parsed.data.total_value,
      package_ids: pkgIds,
    },
    importance: "normal",
  });

  revalidatePath("/contracts");
  return { ok: true, id: row.id };
}

// ---------------------------------------------------------------------------
// Installment management — add / edit / delete a payment on a contract.
//
// The team manages the 4-payment schedule by hand in the sheet's Installments
// Tracker. These actions move that into the dashboard so the sheet can be
// retired. Every write recomputes contracts.paid_value from the sum of
// received installments, and derives each row's status from its dates/amount.
// All gated on contract.manage; all log to audit_log.
// ---------------------------------------------------------------------------

function deriveInstallmentStatus(
  expectedDate: string | null,
  actualDate: string | null,
  expectedAmount: number,
  actualAmount: number | null,
  todayIso: string,
): "pending" | "received" | "partial" | "overdue" {
  if (actualDate && (actualAmount ?? 0) > 0) {
    return (actualAmount ?? 0) + 0.01 < expectedAmount ? "partial" : "received";
  }
  if (expectedDate && expectedDate < todayIso) return "overdue";
  return "pending";
}

async function recomputeContractPaid(contractId: string) {
  const { data: rows } = await supabaseAdmin
    .from("installments")
    .select("actual_amount")
    .eq("contract_id", contractId);
  const paid = (rows ?? []).reduce((s, r) => s + Number(r.actual_amount || 0), 0);
  await supabaseAdmin
    .from("contracts")
    .update({ paid_value: paid })
    .eq("id", contractId);
  return paid;
}

const AddInstallmentSchema = z.object({
  contract_id: z.string().regex(UUID_RE),
  expected_date: z.string().regex(DATE_RE),
  expected_amount: z.coerce.number().positive().max(10_000_000),
});

export async function addInstallmentAction(input: {
  contractId: string;
  expectedDate: string;
  expectedAmount: number;
}): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = AddInstallmentSchema.safeParse({
    contract_id: input.contractId,
    expected_date: input.expectedDate,
    expected_amount: input.expectedAmount,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: contract } = await supabaseAdmin
    .from("contracts")
    .select("id, organization_id")
    .eq("id", parsed.data.contract_id)
    .maybeSingle();
  if (!contract || contract.organization_id !== session.orgId) {
    return { error: "العقد غير موجود" };
  }

  // Next sequence number for this contract.
  const { data: maxRow } = await supabaseAdmin
    .from("installments")
    .select("sequence")
    .eq("contract_id", parsed.data.contract_id)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSeq = (maxRow?.sequence ?? 0) + 1;
  const today = new Date().toISOString().slice(0, 10);

  const { data: row, error } = await supabaseAdmin
    .from("installments")
    .insert({
      organization_id: session.orgId,
      contract_id: parsed.data.contract_id,
      sequence: nextSeq,
      expected_date: parsed.data.expected_date,
      expected_amount: parsed.data.expected_amount,
      status: deriveInstallmentStatus(
        parsed.data.expected_date,
        null,
        parsed.data.expected_amount,
        null,
        today,
      ),
    })
    .select("id")
    .single();
  if (error || !row) return { error: error?.message ?? "تعذّر إضافة الدفعة" };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contract.installment_add",
    entityType: "installment",
    entityId: row.id,
    metadata: {
      contract_id: parsed.data.contract_id,
      sequence: nextSeq,
      expected_amount: parsed.data.expected_amount,
    },
  });

  revalidatePath(`/contracts/${parsed.data.contract_id}`);
  return { ok: true, id: row.id };
}

const UpdateInstallmentSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("expected_date"), value: z.string().regex(DATE_RE) }),
  z.object({
    field: z.literal("expected_amount"),
    value: z.coerce.number().nonnegative().max(10_000_000),
  }),
  z.object({
    field: z.literal("actual_date"),
    value: z.string().regex(DATE_RE).nullable(),
  }),
  z.object({
    field: z.literal("actual_amount"),
    value: z.coerce.number().nonnegative().max(10_000_000).nullable(),
  }),
]);

export async function updateInstallmentAction(input: {
  id: string;
  field: string;
  value: string | number | null;
}): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!UUID_RE.test(input.id)) return { error: "معرف غير صالح" };
  const parsed = UpdateInstallmentSchema.safeParse({
    field: input.field,
    value: input.value,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: inst } = await supabaseAdmin
    .from("installments")
    .select(
      "id, organization_id, contract_id, expected_date, expected_amount, actual_date, actual_amount",
    )
    .eq("id", input.id)
    .maybeSingle();
  if (!inst || inst.organization_id !== session.orgId) {
    return { error: "الدفعة غير موجودة" };
  }

  // Apply the change, then re-derive status from the resulting state.
  const next = {
    expected_date: inst.expected_date as string | null,
    expected_amount: Number(inst.expected_amount || 0),
    actual_date: inst.actual_date as string | null,
    actual_amount:
      inst.actual_amount == null ? null : Number(inst.actual_amount),
  };
  if (parsed.data.field === "expected_date") next.expected_date = parsed.data.value;
  if (parsed.data.field === "expected_amount") next.expected_amount = parsed.data.value;
  if (parsed.data.field === "actual_date") next.actual_date = parsed.data.value;
  if (parsed.data.field === "actual_amount") next.actual_amount = parsed.data.value;

  const today = new Date().toISOString().slice(0, 10);
  const status = deriveInstallmentStatus(
    next.expected_date,
    next.actual_date,
    next.expected_amount,
    next.actual_amount,
    today,
  );

  const { error } = await supabaseAdmin
    .from("installments")
    .update({
      expected_date: next.expected_date,
      expected_amount: next.expected_amount,
      actual_date: next.actual_date,
      actual_amount: next.actual_amount,
      status,
    })
    .eq("id", inst.id);
  if (error) return { error: error.message };

  const paid = await recomputeContractPaid(inst.contract_id);

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contract.installment_update",
    entityType: "installment",
    entityId: inst.id,
    metadata: {
      contract_id: inst.contract_id,
      field: parsed.data.field,
      value: parsed.data.value,
      paid_value_total: paid,
    },
  });

  revalidatePath(`/contracts/${inst.contract_id}`);
  revalidatePath("/contracts");
  return { ok: true, id: inst.id };
}

// ---------------------------------------------------------------------------
// Hold flow (sheet-parity, migration 0159 + docs/CONTRACTS_GAP_ANALYSIS G2).
//
// In the sheet, switching Contract Type to "Hold" ran an Apps Script that
// snapshotted the row, unlocked it, and logged ON HOLD; leaving Hold diffed
// against the snapshot and logged HOLD LIFTED with the changes. The dashboard
// version adds what the team asked for on top: a mandatory hold END DATE
// (popup) that drives the expiry-notification cron, and remembering the
// pre-hold type so lifting can restore it.
// ---------------------------------------------------------------------------

// Fields included in the hold snapshot/diff — mirrors the Apps Script's
// takeHoldSnapshot_/buildHoldDiff_ field list.
const HOLD_SNAPSHOT_FIELDS = [
  "contract_type_id",
  "target",
  "status",
  "start_date",
  "end_date",
  "actual_end_date",
  "duration_months",
  "total_value",
  "paid_value",
  "repeated_services_value",
  "next_contract_value",
  "renewal_paid_value",
  "payment_status",
  "renewed_status",
  "notes",
] as const;

type HoldSnapshot = Record<string, unknown>;

function buildHoldSnapshot(row: Record<string, unknown>): HoldSnapshot {
  const snap: HoldSnapshot = {};
  for (const f of HOLD_SNAPSHOT_FIELDS) snap[f] = row[f] ?? null;
  return snap;
}

function buildHoldDiff(
  before: HoldSnapshot,
  after: Record<string, unknown>,
): Array<{ field: string; from: unknown; to: unknown }> {
  const diffs: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const f of HOLD_SNAPSHOT_FIELDS) {
    const a = before[f] ?? null;
    const b = after[f] ?? null;
    if (String(a ?? "") !== String(b ?? "")) diffs.push({ field: f, from: a, to: b });
  }
  return diffs;
}

const HOLD_SELECT =
  "id, organization_id, status, contract_type_id, type_before_hold_id, " +
  "hold_started_at, hold_end_date, target, start_date, end_date, " +
  "actual_end_date, duration_months, total_value, paid_value, " +
  "repeated_services_value, next_contract_value, renewal_paid_value, " +
  "payment_status, renewed_status, notes, contract_code";

const SetHoldSchema = z.object({
  contract_id: z.string().regex(UUID_RE),
  hold_end_date: z.string().regex(DATE_RE),
  note: z.string().trim().max(2000).optional(),
});

export async function setContractHoldAction(input: {
  contractId: string;
  holdEndDate: string;
  note?: string;
}): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = SetHoldSchema.safeParse({
    contract_id: input.contractId,
    hold_end_date: input.holdEndDate,
    note: input.note || undefined,
  });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const today = todayIso();
  if (parsed.data.hold_end_date < today) {
    return { error: "تاريخ نهاية الإيقاف لا يمكن أن يكون في الماضي" };
  }

  const { data: contractRaw } = await supabaseAdmin
    .from("contracts")
    .select(HOLD_SELECT)
    .eq("id", parsed.data.contract_id)
    .maybeSingle();
  const contract = contractRaw as unknown as Record<string, unknown> | null;
  if (!contract || contract.organization_id !== session.orgId) {
    return { error: "العقد غير موجود" };
  }

  const alreadyOnHold = contract.status === "hold";

  // Resolve the org's Hold contract type.
  const { data: holdType } = await supabaseAdmin
    .from("contract_types")
    .select("id, key")
    .eq("organization_id", session.orgId)
    .eq("key", "Hold")
    .maybeSingle();
  if (!holdType) return { error: "نوع العقد Hold غير معرّف في النظام" };

  const patch: Record<string, unknown> = {
    status: "hold",
    contract_type_id: holdType.id,
    hold_end_date: parsed.data.hold_end_date,
    // Re-arm the notification throttle so the cron re-evaluates tomorrow.
    last_hold_notification: null,
  };
  if (!alreadyOnHold) {
    patch.hold_started_at = today;
    patch.type_before_hold_id = contract.contract_type_id ?? null;
  }

  const { error: updErr } = await supabaseAdmin
    .from("contracts")
    .update(patch)
    .eq("id", contract.id as string);
  if (updErr) return { error: updErr.message };

  // Event log — the sheet's "Entered HOLD — Contract Type was: …" line,
  // plus the full snapshot so lifting can diff against it.
  await supabaseAdmin.from("contract_events").insert({
    organization_id: session.orgId,
    contract_id: contract.id,
    event_type: alreadyOnHold ? "HOLD_UPDATED" : "ON_HOLD",
    actor_id: session.employeeId,
    payload: {
      hold_end_date: parsed.data.hold_end_date,
      hold_started_at: alreadyOnHold ? contract.hold_started_at : today,
      type_before_hold_id: alreadyOnHold
        ? contract.type_before_hold_id
        : (contract.contract_type_id ?? null),
      note: parsed.data.note ?? null,
      snapshot: alreadyOnHold ? undefined : buildHoldSnapshot(contract),
    },
  });

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: alreadyOnHold ? "contract.hold_update" : "contract.hold_set",
    entityType: "contract",
    entityId: contract.id as string,
    metadata: { hold_end_date: parsed.data.hold_end_date, note: parsed.data.note },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: alreadyOnHold ? "CONTRACT_HOLD_UPDATED" : "CONTRACT_HOLD_SET",
    entityType: "contract",
    entityId: contract.id as string,
    payload: { hold_end_date: parsed.data.hold_end_date },
    importance: "high",
  });

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contract.id}`);
  return { ok: true, id: contract.id as string };
}

const LiftHoldSchema = z.object({
  contract_id: z.string().regex(UUID_RE),
  new_type_id: z.string().regex(UUID_RE).nullable(),
  note: z.string().trim().max(2000).optional(),
});

export async function liftContractHoldAction(input: {
  contractId: string;
  newTypeId: string | null; // null → restore the pre-hold type
  note?: string;
}): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = LiftHoldSchema.safeParse({
    contract_id: input.contractId,
    new_type_id: input.newTypeId,
    note: input.note || undefined,
  });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const { data: contractRaw } = await supabaseAdmin
    .from("contracts")
    .select(HOLD_SELECT)
    .eq("id", parsed.data.contract_id)
    .maybeSingle();
  const contract = contractRaw as unknown as Record<string, unknown> | null;
  if (!contract || contract.organization_id !== session.orgId) {
    return { error: "العقد غير موجود" };
  }
  if (contract.status !== "hold") {
    return { error: "العقد ليس موقوفًا" };
  }

  const restoreTypeId =
    parsed.data.new_type_id ?? (contract.type_before_hold_id as string | null);

  // Reject restoring into Hold itself (no-op disguised as a lift).
  if (restoreTypeId) {
    const { data: t } = await supabaseAdmin
      .from("contract_types")
      .select("key")
      .eq("id", restoreTypeId)
      .maybeSingle();
    if (t?.key === "Hold") {
      return { error: "اختاري نوعًا غير Hold لرفع الإيقاف" };
    }
  }

  // Diff against the ON_HOLD snapshot (sheet's HOLD LIFTED changes list).
  const { data: holdEvent } = await supabaseAdmin
    .from("contract_events")
    .select("payload, created_at")
    .eq("contract_id", contract.id as string)
    .eq("event_type", "ON_HOLD")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const snapshot =
    (holdEvent?.payload as { snapshot?: HoldSnapshot } | null)?.snapshot ?? null;
  const changes = snapshot ? buildHoldDiff(snapshot, contract) : [];

  const { error: updErr } = await supabaseAdmin
    .from("contracts")
    .update({
      status: "active",
      contract_type_id: restoreTypeId,
      hold_started_at: null,
      hold_end_date: null,
      type_before_hold_id: null,
      last_hold_notification: null,
    })
    .eq("id", contract.id as string);
  if (updErr) return { error: updErr.message };

  await supabaseAdmin.from("contract_events").insert({
    organization_id: session.orgId,
    contract_id: contract.id,
    event_type: "HOLD_LIFTED",
    actor_id: session.employeeId,
    payload: {
      restored_type_id: restoreTypeId,
      was_on_hold_since: contract.hold_started_at,
      hold_end_date_was: contract.hold_end_date,
      note: parsed.data.note ?? null,
      changes,
    },
  });

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contract.hold_lift",
    entityType: "contract",
    entityId: contract.id as string,
    metadata: { restored_type_id: restoreTypeId, changes_count: changes.length },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "CONTRACT_HOLD_LIFTED",
    entityType: "contract",
    entityId: contract.id as string,
    payload: { restored_type_id: restoreTypeId, changes },
    importance: "high",
  });

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contract.id}`);
  return { ok: true, id: contract.id as string };
}

export async function deleteInstallmentAction(input: {
  id: string;
}): Promise<ContractActionState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!UUID_RE.test(input.id)) return { error: "معرف غير صالح" };

  const { data: inst } = await supabaseAdmin
    .from("installments")
    .select("id, organization_id, contract_id")
    .eq("id", input.id)
    .maybeSingle();
  if (!inst || inst.organization_id !== session.orgId) {
    return { error: "الدفعة غير موجودة" };
  }

  const { error } = await supabaseAdmin
    .from("installments")
    .delete()
    .eq("id", inst.id);
  if (error) return { error: error.message };

  const paid = await recomputeContractPaid(inst.contract_id);

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contract.installment_delete",
    entityType: "installment",
    entityId: inst.id,
    metadata: { contract_id: inst.contract_id, paid_value_total: paid },
  });

  revalidatePath(`/contracts/${inst.contract_id}`);
  return { ok: true, id: inst.id };
}
