import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type UploadBucket = "overdue" | "today" | "this_week" | "later";

export type UploadQueueRow = {
  id: string;
  title: string;
  stage: string;
  status: string;
  priority: string;
  due_date: string | null;
  planned_date: string | null;
  upload_due_date: string;
  upload_offset_days: number | null;
  days_delta: number; // negative = overdue, 0 = today, positive = future
  bucket: UploadBucket;
  project: { id: string; name: string; client_name: string | null } | null;
  service: { id: string; name: string; slug: string } | null;
};

/**
 * Build the Specialist's "today's uploads" queue.
 * - Source-of-truth deadline: tasks.due_date (falls back to planned_date if missing).
 * - Upload due = deadline - upload_offset_days_before_deadline (when set).
 * - Buckets are computed in TS against the Asia/Riyadh "today".
 */
export async function listMyUploadQueue(
  orgId: string,
  employeeId: string,
): Promise<UploadQueueRow[]> {
  // Tasks where the current user is the assignee in the specialist slot,
  // not done. We pull the template item to read upload_offset_days_before_deadline.
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(`
      id, title, status, stage, priority, due_date, planned_date,
      created_from_template_item_id,
      project:projects ( id, name, client:clients ( name ) ),
      service:services ( id, name, slug ),
      task_assignees!inner ( role_type, employee_id )
    `)
    .eq("organization_id", orgId)
    .eq("task_assignees.role_type", "specialist")
    .eq("task_assignees.employee_id", employeeId)
    .neq("stage", "done")
    .limit(500);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Look up upload offsets for the referenced template items in one shot.
  const templateItemIds = Array.from(
    new Set(
      data
        .map((t) => t.created_from_template_item_id)
        .filter((v): v is string => !!v),
    ),
  );
  const offsetByItemId = new Map<string, number | null>();
  if (templateItemIds.length > 0) {
    const { data: tti, error: ttiErr } = await supabaseAdmin
      .from("task_template_items")
      .select("id, upload_offset_days_before_deadline")
      .in("id", templateItemIds);
    if (ttiErr) throw ttiErr;
    for (const row of tti ?? []) {
      offsetByItemId.set(row.id, row.upload_offset_days_before_deadline);
    }
  }

  // Use Asia/Riyadh "today" so bucket boundaries match the cron in 0016.
  const today = ksaToday();
  const todayMs = today.getTime();
  const dayMs = 86_400_000;

  const rows: UploadQueueRow[] = [];
  for (const t of data) {
    const project = Array.isArray(t.project) ? t.project[0] : t.project;
    const clientRaw = project?.client && (Array.isArray(project.client) ? project.client[0] : project.client);
    const service = Array.isArray(t.service) ? t.service[0] : t.service;
    const offset = t.created_from_template_item_id
      ? (offsetByItemId.get(t.created_from_template_item_id) ?? null)
      : null;

    const deadline = t.due_date ?? t.planned_date;
    if (!deadline) continue; // can't compute upload date without a deadline

    const deadlineDate = parseDateOnly(deadline);
    const uploadDue = offset != null
      ? new Date(deadlineDate.getTime() - offset * dayMs)
      : deadlineDate;

    const daysDelta = Math.round((uploadDue.getTime() - todayMs) / dayMs);

    let bucket: UploadBucket;
    if (daysDelta < 0) bucket = "overdue";
    else if (daysDelta === 0) bucket = "today";
    else if (daysDelta <= 7) bucket = "this_week";
    else bucket = "later";

    rows.push({
      id: t.id,
      title: t.title,
      stage: t.stage,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      planned_date: t.planned_date,
      upload_due_date: toIsoDateOnly(uploadDue),
      upload_offset_days: offset,
      days_delta: daysDelta,
      bucket,
      project: project ? {
        id: project.id,
        name: project.name,
        client_name: clientRaw?.name ?? null,
      } : null,
      service: service ? { id: service.id, name: service.name, slug: service.slug } : null,
    });
  }

  // Sort by upload_due_date ascending (oldest overdue first, latest later last).
  rows.sort((a, b) => a.upload_due_date.localeCompare(b.upload_due_date));
  return rows;
}

function ksaToday(): Date {
  // Convert "now" to Asia/Riyadh and zero the time so all comparisons are date-only.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return new Date(Date.UTC(y, m - 1, d));
}

function parseDateOnly(value: string): Date {
  // Tasks store dates as YYYY-MM-DD; treat them in UTC to avoid TZ drift.
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function toIsoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
