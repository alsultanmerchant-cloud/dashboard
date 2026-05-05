import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

type Stage = Database["public"]["Enums"]["task_stage"];
type RoleType = Database["public"]["Enums"]["task_role_type"];
type CommentKind = Database["public"]["Enums"]["task_comment_kind"];

// Sky Light task activity feed.
// Unified read-side projection over three sources:
//   - task_comments         (kind = "note")
//   - task_stage_history    (kind = "stage_change")
//   - audit_logs            (kind = "assignee_change") for task.assignee_change
//
// Returns chronologically ordered items, oldest → newest.
// (PDF screenshots show oldest at top with newest at bottom.)

export type TaskActivity =
  | {
      kind: "note";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      body: string;
      mentions: { employee_id: string; full_name: string }[];
      is_internal: boolean;
      comment_kind: CommentKind;
    }
  | {
      kind: "stage_change";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      from_stage: Stage | null;
      to_stage: Stage;
      duration_seconds: number | null;
    }
  | {
      kind: "assignee_change";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      role_type: RoleType;
      from_employee: { id: string; full_name: string } | null;
      to_employee: { id: string; full_name: string } | null;
    }
  | {
      kind: "task_created";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      initial_stage: Stage;
    }
  | {
      kind: "odoo_message";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      body_html: string;
      attachments: { id: number; name: string; mimetype: string; url: string | null }[];
    }
  | {
      // Stage transition surfaced from Odoo's mail.tracking.value rows. We use
      // `from`/`to` as raw labels (Odoo stores stage names in the local
      // language, e.g. "Manager Review" / "مراجعة المدير"). Treated as a
      // first-class activity item so the chronological feed — and any AI
      // summarization that consumes it — recognizes a stage move at this
      // timestamp regardless of source.
      kind: "odoo_stage_change";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      from_label: string | null;
      to_label: string;
    }
  | {
      kind: "odoo_field_change";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      field: string;
      from_label: string | null;
      to_label: string | null;
    };

type OdooMessageInput = {
  id: number;
  body: string;
  authorName: string | null;
  date: string;
  messageType?: string;
  tracking?: {
    field: string;
    fieldName?: string | null;
    from: string | null;
    to: string | null;
  }[];
  attachments?: { id: number; name: string; mimetype: string; url: string | null }[];
};

// Detect a stage transition by the technical field name (locale-stable),
// falling back to the localized human label.
const STAGE_FIELD_NAMES = new Set(["stage_id", "stage"]);
const STAGE_FIELD_LABELS = new Set(["Stage", "المرحلة", "حالة"]);
function isStageTrackingField(t: {
  field: string;
  fieldName?: string | null;
}): boolean {
  if (t.fieldName && STAGE_FIELD_NAMES.has(t.fieldName)) return true;
  return STAGE_FIELD_LABELS.has(t.field);
}

function odooDateToIso(d: string): string {
  return d.includes("T") ? d : d.replace(" ", "T") + "Z";
}

// Adapter: convert Odoo `mail.message` rows into TaskActivity items so they
// can be merged into the same chronological feed as our Supabase comments.
//
// **Stage switches are first-class activity items.** Odoo's stage moves
// arrive on system messages (message_type='notification') as a
// `tracking_value` whose `field` is "Stage". We split each such message into:
//   • `odoo_stage_change`  — for the stage move (always emitted when the
//     tracking field is a stage field)
//   • `odoo_field_change`  — for any other tracked field on the same message
//   • `odoo_message`       — for the human body, IF non-empty
//
// This means the feed (and any downstream AI assistant reading it) sees a
// distinct event at the moment of every stage transition, the same way the
// Supabase-backed `stage_change` event surfaces for native moves.
export function odooMessagesToActivity(
  messages: OdooMessageInput[],
): TaskActivity[] {
  const out: TaskActivity[] = [];
  for (const m of messages) {
    const created_at = odooDateToIso(m.date);
    const actor = m.authorName ? { name: m.authorName, avatar: null } : null;
    const tracking = m.tracking ?? [];
    const attachments = m.attachments ?? [];

    for (const t of tracking) {
      const stage = isStageTrackingField(t);
      if (stage && t.to) {
        out.push({
          kind: "odoo_stage_change",
          id: `odoo-stage:${m.id}:${t.fieldName ?? t.field}:${t.to}`,
          created_at,
          actor,
          from_label: t.from,
          to_label: t.to,
        });
      } else if (!stage) {
        out.push({
          kind: "odoo_field_change",
          id: `odoo-field:${m.id}:${t.fieldName ?? t.field}`,
          created_at,
          actor,
          field: t.field || t.fieldName || "—",
          from_label: t.from,
          to_label: t.to,
        });
      }
    }

    const bodyText = (m.body ?? "").replace(/<[^>]+>/g, "").trim();
    if (bodyText.length > 0 || attachments.length > 0) {
      out.push({
        kind: "odoo_message",
        id: `odoo:${m.id}`,
        created_at,
        actor,
        body_html: m.body,
        attachments,
      });
    }
  }
  return out;
}

export async function getTaskActivityFeed(
  orgId: string,
  taskId: string,
): Promise<TaskActivity[]> {
  // Fan out three reads in parallel.
  const [commentsRes, stageHistoryRes, auditRes] = await Promise.all([
    supabaseAdmin
      .from("task_comments")
      .select("id, body, is_internal, created_at, author_user_id, kind, external_author_name, external_author_avatar_url")
      .eq("organization_id", orgId)
      .eq("task_id", taskId),
    supabaseAdmin
      .from("task_stage_history")
      .select("id, from_stage, to_stage, entered_at, duration_seconds, moved_by")
      .eq("organization_id", orgId)
      .eq("task_id", taskId),
    supabaseAdmin
      .from("audit_logs")
      .select("id, action, metadata, actor_user_id, created_at")
      .eq("organization_id", orgId)
      .eq("entity_type", "task")
      .eq("entity_id", taskId)
      .eq("action", "task.assignee_change"),
  ]);

  const comments = commentsRes.data ?? [];
  const stageHistory = stageHistoryRes.data ?? [];
  const audits = auditRes.data ?? [];

  // Resolve actor names + employee labels we'll need across all sources.
  const userIds = new Set<string>();
  const employeeIds = new Set<string>();
  const mentionCommentIds: string[] = [];

  for (const c of comments) {
    if (c.author_user_id) userIds.add(c.author_user_id);
    mentionCommentIds.push(c.id);
  }
  for (const h of stageHistory) {
    if (h.moved_by) userIds.add(h.moved_by);
  }
  for (const a of audits) {
    if (a.actor_user_id) userIds.add(a.actor_user_id);
    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.from_employee_id === "string")
      employeeIds.add(meta.from_employee_id);
    if (typeof meta.to_employee_id === "string")
      employeeIds.add(meta.to_employee_id);
  }

  const [profilesRes, employeesRes, mentionsRes] = await Promise.all([
    userIds.size
      ? supabaseAdmin
          .from("employee_profiles")
          .select("user_id, full_name, avatar_url")
          .eq("organization_id", orgId)
          .in("user_id", Array.from(userIds))
      : Promise.resolve({ data: [] as { user_id: string | null; full_name: string; avatar_url: string | null }[] }),
    employeeIds.size
      ? supabaseAdmin
          .from("employee_profiles")
          .select("id, full_name")
          .eq("organization_id", orgId)
          .in("id", Array.from(employeeIds))
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    mentionCommentIds.length
      ? supabaseAdmin
          .from("task_mentions")
          .select(
            "task_comment_id, mentioned_employee_id, employee:employee_profiles!task_mentions_mentioned_employee_id_fkey ( full_name )",
          )
          .in("task_comment_id", mentionCommentIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const profileByUser = new Map<string, { name: string; avatar: string | null }>();
  for (const p of profilesRes.data ?? []) {
    if (p.user_id)
      profileByUser.set(p.user_id, { name: p.full_name, avatar: p.avatar_url });
  }
  const employeeById = new Map<string, { id: string; full_name: string }>();
  for (const e of employeesRes.data ?? []) {
    employeeById.set(e.id, { id: e.id, full_name: e.full_name });
  }
  const mentionsByComment = new Map<
    string,
    { employee_id: string; full_name: string }[]
  >();
  for (const m of (mentionsRes.data ?? []) as Array<{
    task_comment_id: string;
    mentioned_employee_id: string;
    employee:
      | { full_name: string }
      | { full_name: string }[]
      | null;
  }>) {
    const emp = Array.isArray(m.employee) ? m.employee[0] : m.employee;
    if (!emp) continue;
    const arr = mentionsByComment.get(m.task_comment_id) ?? [];
    arr.push({ employee_id: m.mentioned_employee_id, full_name: emp.full_name });
    mentionsByComment.set(m.task_comment_id, arr);
  }

  const items: TaskActivity[] = [];

  for (const c of comments) {
    // Odoo-imported notes have no author_user_id — fall back to the synced
    // external author fields so the feed shows the partner name + avatar.
    const localActor = c.author_user_id ? profileByUser.get(c.author_user_id) : null;
    const actor = localActor
      ?? (c.external_author_name
        ? { name: c.external_author_name, avatar: c.external_author_avatar_url ?? null }
        : null);
    items.push({
      kind: "note",
      id: c.id,
      created_at: c.created_at,
      actor: actor ?? null,
      body: c.body,
      mentions: mentionsByComment.get(c.id) ?? [],
      is_internal: c.is_internal,
      comment_kind: c.kind,
    });
  }

  for (const h of stageHistory) {
    if (h.from_stage === null) {
      // Creation row — render as a "task_created" event so the timeline
      // isn't empty for tasks that have never been moved.
      items.push({
        kind: "task_created",
        id: h.id,
        created_at: h.entered_at,
        actor: h.moved_by ? profileByUser.get(h.moved_by) ?? null : null,
        initial_stage: h.to_stage,
      });
      continue;
    }
    items.push({
      kind: "stage_change",
      id: h.id,
      created_at: h.entered_at,
      actor: h.moved_by ? profileByUser.get(h.moved_by) ?? null : null,
      from_stage: h.from_stage,
      to_stage: h.to_stage,
      duration_seconds: h.duration_seconds,
    });
  }

  for (const a of audits) {
    const meta = (a.metadata ?? {}) as {
      role_type?: RoleType;
      from_employee_id?: string | null;
      to_employee_id?: string | null;
    };
    if (!meta.role_type) continue;
    items.push({
      kind: "assignee_change",
      id: a.id,
      created_at: a.created_at,
      actor: a.actor_user_id ? profileByUser.get(a.actor_user_id) ?? null : null,
      role_type: meta.role_type,
      from_employee: meta.from_employee_id
        ? employeeById.get(meta.from_employee_id) ?? null
        : null,
      to_employee: meta.to_employee_id
        ? employeeById.get(meta.to_employee_id) ?? null
        : null,
    });
  }

  items.sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  return items;
}
