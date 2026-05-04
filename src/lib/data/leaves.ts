import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  LEAVE_TYPES, LEAVE_STATUSES,
  type LeaveType, type LeaveStatus,
} from "./leave-types";

export {
  LEAVE_TYPES, LEAVE_TYPE_LABEL,
  LEAVE_STATUSES, LEAVE_STATUS_LABEL, LEAVE_STATUS_BADGE,
} from "./leave-types";
export type { LeaveType, LeaveStatus } from "./leave-types";

export interface LeaveRow {
  id: string;
  employee_user_id: string;
  employee_profile_id: string | null;
  start_date: string;
  end_date: string;
  days: number;
  leave_type: LeaveType;
  reason: string | null;
  status: LeaveStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_by: string | null;
  created_at: string;
  // Joined for display
  employee_name?: string | null;
}

export async function listLeaves(
  orgId: string,
  opts: { status?: LeaveStatus; limit?: number; userId?: string } = {},
): Promise<LeaveRow[]> {
  let q = supabaseAdmin
    .from("leaves")
    .select(
      `id, employee_user_id, employee_profile_id, start_date, end_date, days,
       leave_type, reason, status, decided_by, decided_at, decision_note,
       created_by, created_at`,
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (opts.status) q = q.eq("status", opts.status);
  if (opts.userId) q = q.eq("employee_user_id", opts.userId);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;
  if (!data || data.length === 0) return [];

  return enrichLeaves(orgId, data);
}

export async function listLeavesPaged(
  orgId: string,
  opts: {
    status?: LeaveStatus;
    userId?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{ rows: LeaveRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabaseAdmin
    .from("leaves")
    .select(
      `id, employee_user_id, employee_profile_id, start_date, end_date, days,
       leave_type, reason, status, decided_by, decided_at, decision_note,
       created_by, created_at`,
      { count: "exact" },
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (opts.status) q = q.eq("status", opts.status);
  if (opts.userId) q = q.eq("employee_user_id", opts.userId);

  const { data, error, count } = await q;
  if (error) throw error;
  const rows = data && data.length > 0 ? await enrichLeaves(orgId, data) : [];
  return { rows, total: count ?? 0, page, pageSize };
}

async function enrichLeaves(
  orgId: string,
  rows: Array<Record<string, unknown> & { employee_user_id: string }>,
): Promise<LeaveRow[]> {
  const userIds = Array.from(new Set(rows.map((r) => r.employee_user_id)));
  const { data: profs } = await supabaseAdmin
    .from("employee_profiles")
    .select("user_id, full_name")
    .eq("organization_id", orgId)
    .in("user_id", userIds);
  const nameByUid = new Map<string, string>();
  for (const p of profs ?? []) {
    if (p.user_id && p.full_name) nameByUid.set(p.user_id, p.full_name);
  }
  return rows.map((r) => ({
    ...r,
    days: Number(r.days) || 0,
    employee_name: nameByUid.get(r.employee_user_id) ?? null,
  })) as LeaveRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregates
// ─────────────────────────────────────────────────────────────────────────────

export interface LeavesSummary {
  pendingCount: number;
  approvedCount: number;
  totalCount: number;
  daysOffThisMonth: number;       // sum of approved days in current month
  onLeaveToday: LeaveRow[];        // approved leaves where today ∈ [start, end]
  byType: Record<LeaveType, { count: number; days: number }>;
}

export async function getLeavesSummary(orgId: string): Promise<LeavesSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString().slice(0, 10);
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
    .toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from("leaves")
    .select(
      `id, employee_user_id, employee_profile_id, start_date, end_date, days,
       leave_type, reason, status, decided_by, decided_at, decision_note,
       created_by, created_at`,
    )
    .eq("organization_id", orgId);
  if (error) throw error;

  const byType = Object.fromEntries(
    LEAVE_TYPES.map((t) => [t, { count: 0, days: 0 }]),
  ) as Record<LeaveType, { count: number; days: number }>;

  let pendingCount = 0;
  let approvedCount = 0;
  let totalCount = 0;
  let daysOffThisMonth = 0;
  const onLeaveTodayRows: LeaveRow[] = [];

  for (const r of data ?? []) {
    totalCount++;
    if (r.status === "pending") pendingCount++;
    if (r.status === "approved") approvedCount++;
    const t = r.leave_type as LeaveType;
    const days = Number(r.days) || 0;
    byType[t].count++;
    byType[t].days += days;

    if (
      r.status === "approved" &&
      r.start_date <= monthEnd &&
      r.end_date >= monthStart
    ) {
      // Approximate: count full days even if leave straddles month boundary
      daysOffThisMonth += days;
    }

    if (
      r.status === "approved" &&
      r.start_date <= today &&
      r.end_date >= today
    ) {
      onLeaveTodayRows.push({
        ...r,
        days,
      } as LeaveRow);
    }
  }

  // Resolve names for "on leave today"
  if (onLeaveTodayRows.length > 0) {
    const uids = Array.from(new Set(onLeaveTodayRows.map((r) => r.employee_user_id)));
    const { data: profs } = await supabaseAdmin
      .from("employee_profiles")
      .select("user_id, full_name")
      .eq("organization_id", orgId)
      .in("user_id", uids);
    const map = new Map<string, string>();
    for (const p of profs ?? []) {
      if (p.user_id && p.full_name) map.set(p.user_id, p.full_name);
    }
    for (const r of onLeaveTodayRows) {
      r.employee_name = map.get(r.employee_user_id) ?? null;
    }
  }

  return {
    pendingCount,
    approvedCount,
    totalCount,
    daysOffThisMonth,
    onLeaveToday: onLeaveTodayRows,
    byType,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export interface NewLeaveInput {
  employee_user_id: string;
  start_date: string;
  end_date: string;
  days: number;
  leave_type: LeaveType;
  reason?: string | null;
}

export async function createLeave(
  orgId: string,
  userId: string,
  input: NewLeaveInput,
): Promise<{ id: string }> {
  // Look up employee_profile_id (may be null if user has no profile yet)
  const { data: prof } = await supabaseAdmin
    .from("employee_profiles")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", input.employee_user_id)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from("leaves")
    .insert({
      organization_id: orgId,
      created_by: userId,
      employee_user_id: input.employee_user_id,
      employee_profile_id: prof?.id ?? null,
      start_date: input.start_date,
      end_date: input.end_date,
      days: input.days,
      leave_type: input.leave_type,
      reason: input.reason ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export async function decideLeave(
  orgId: string,
  leaveId: string,
  userId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("leaves")
    .update({
      status: decision,
      decided_by: userId,
      decided_at: new Date().toISOString(),
      decision_note: note ?? null,
    })
    .eq("organization_id", orgId)
    .eq("id", leaveId);
  if (error) throw error;
}

export async function cancelLeave(
  orgId: string,
  leaveId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("leaves")
    .update({ status: "cancelled" })
    .eq("organization_id", orgId)
    .eq("id", leaveId);
  if (error) throw error;
}
