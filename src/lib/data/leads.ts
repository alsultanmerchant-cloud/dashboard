import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  LEAD_STATUSES, OPEN_LEAD_STATUSES, type LeadStatus,
} from "./lead-statuses";

export {
  LEAD_STATUSES, OPEN_LEAD_STATUSES, LEAD_STATUS_LABEL, LEAD_STATUS_TONE,
} from "./lead-statuses";
export type { LeadStatus } from "./lead-statuses";

export interface LeadRow {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  source: string | null;
  estimated_value: number;
  next_step_at: string | null;
  notes: string | null;
  assigned_to_employee_id: string | null;
  assigned_to?: { id: string; full_name: string } | null;
  converted_client_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listLeads(
  orgId: string,
  opts: { status?: LeadStatus | "open"; limit?: number } = {},
): Promise<LeadRow[]> {
  let q = supabaseAdmin
    .from("leads")
    .select(
      `id, name, contact_name, email, phone, status, source,
       estimated_value, next_step_at, notes,
       assigned_to_employee_id,
       assigned_to:employee_profiles!leads_assigned_to_employee_id_fkey ( id, full_name ),
       converted_client_id, created_at, updated_at`,
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (opts.status === "open") {
    q = q.in("status", OPEN_LEAD_STATUSES as unknown as string[]);
  } else if (opts.status) {
    q = q.eq("status", opts.status);
  }
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    estimated_value: Number(r.estimated_value) || 0,
    assigned_to: Array.isArray(r.assigned_to)
      ? r.assigned_to[0] ?? null
      : (r.assigned_to ?? null),
  })) as LeadRow[];
}

export async function getLead(orgId: string, id: string): Promise<LeadRow | null> {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select(
      `id, name, contact_name, email, phone, status, source,
       estimated_value, next_step_at, notes,
       assigned_to_employee_id,
       assigned_to:employee_profiles!leads_assigned_to_employee_id_fkey ( id, full_name ),
       converted_client_id, created_at, updated_at`,
    )
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    estimated_value: Number(data.estimated_value) || 0,
    assigned_to: Array.isArray(data.assigned_to)
      ? data.assigned_to[0] ?? null
      : (data.assigned_to ?? null),
  } as LeadRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline aggregates — used by the /sales overview page
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineSummary {
  totalCount: number;
  totalOpenCount: number;
  totalOpenValue: number;     // sum of estimated_value for open leads
  wonValue: number;           // sum of estimated_value for won leads (all-time)
  lostValue: number;
  byStatus: Record<LeadStatus, { count: number; value: number }>;
  conversionRate: number | null;  // won / (won + lost) — null if no closed deals
  recentLeads: LeadRow[];
}

export async function getPipelineSummary(orgId: string): Promise<PipelineSummary> {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("status, estimated_value")
    .eq("organization_id", orgId);
  if (error) throw error;

  const byStatus = Object.fromEntries(
    LEAD_STATUSES.map((s) => [s, { count: 0, value: 0 }]),
  ) as Record<LeadStatus, { count: number; value: number }>;

  let totalCount = 0;
  for (const row of data ?? []) {
    const s = row.status as LeadStatus;
    const v = Number(row.estimated_value) || 0;
    byStatus[s].count += 1;
    byStatus[s].value += v;
    totalCount += 1;
  }

  const totalOpenCount = OPEN_LEAD_STATUSES.reduce(
    (sum, s) => sum + byStatus[s].count, 0,
  );
  const totalOpenValue = OPEN_LEAD_STATUSES.reduce(
    (sum, s) => sum + byStatus[s].value, 0,
  );
  const closed = byStatus.won.count + byStatus.lost.count;
  const conversionRate = closed > 0
    ? Math.round((byStatus.won.count / closed) * 100)
    : null;

  const recentLeads = await listLeads(orgId, { limit: 5 });

  return {
    totalCount,
    totalOpenCount,
    totalOpenValue,
    wonValue: byStatus.won.value,
    lostValue: byStatus.lost.value,
    byStatus,
    conversionRate,
    recentLeads,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export interface NewLeadInput {
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: LeadStatus;
  source?: string | null;
  estimated_value?: number;
  next_step_at?: string | null;
  notes?: string | null;
  assigned_to_employee_id?: string | null;
}

export async function createLead(
  orgId: string,
  userId: string,
  input: NewLeadInput,
): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .insert({
      organization_id: orgId,
      created_by: userId,
      name: input.name,
      contact_name: input.contact_name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      status: input.status ?? "new",
      source: input.source ?? null,
      estimated_value: input.estimated_value ?? 0,
      next_step_at: input.next_step_at ?? null,
      notes: input.notes ?? null,
      assigned_to_employee_id: input.assigned_to_employee_id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export async function updateLeadStatus(
  orgId: string,
  id: string,
  status: LeadStatus,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("leads")
    .update({ status })
    .eq("organization_id", orgId)
    .eq("id", id);
  if (error) throw error;
}
