import "server-only";
import { cache } from "react";
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
async function _listMyUploadQueue(
  orgId: string,
  employeeId: string,
): Promise<UploadQueueRow[]> {
  // Fully manual (Sky Light): a task is in the upload queue ONLY when someone
  // has explicitly set its upload date (tasks.upload_due_date, migration 0210).
  // No auto-detection by task type — the specialist activates "موعد الرفع" per
  // task. Execution-role assignments only ('agent' is the Odoo-synced specialist
  // slot, 'specialist' the native one), not done, not archived.
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(`
      id, title, status, stage, priority, due_date, planned_date, upload_due_date,
      project:projects ( id, name, client:clients ( name ) ),
      service:services ( id, name, slug ),
      task_assignees!inner ( role_type, employee_id )
    `)
    .eq("organization_id", orgId)
    .in("task_assignees.role_type", ["specialist", "agent"])
    .eq("task_assignees.employee_id", employeeId)
    .neq("stage", "done")
    .is("archived_at", null)
    .not("upload_due_date", "is", null)
    .limit(500);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Use Asia/Riyadh "today" so bucket boundaries match the cron in 0016.
  const today = ksaToday();
  const todayMs = today.getTime();
  const dayMs = 86_400_000;

  const rows: UploadQueueRow[] = [];
  for (const t of data) {
    const project = Array.isArray(t.project) ? t.project[0] : t.project;
    const clientRaw = project?.client && (Array.isArray(project.client) ? project.client[0] : project.client);
    const service = Array.isArray(t.service) ? t.service[0] : t.service;
    if (!t.upload_due_date) continue; // guard (query already filters)

    const uploadDue = parseDateOnly(t.upload_due_date);
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
      upload_offset_days: null,
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

export const listMyUploadQueue = cache(_listMyUploadQueue);

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
