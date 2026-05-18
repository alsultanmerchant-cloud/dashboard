import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

type Stage = Database["public"]["Enums"]["task_stage"];
type RoleType = Database["public"]["Enums"]["task_role_type"];
type CommentKind = Database["public"]["Enums"]["task_comment_kind"];
import { TASK_STATUSES, type TaskStatus } from "@/lib/labels";

// Sky Light task activity feed.
// Unified read-side projection over three sources:
//   - task_comments         (kind = "note")
//   - task_stage_history    (kind = "stage_change")
//   - audit_logs            (kind = "assignee_change" / "status_change")
//
// Returns chronologically ordered items, oldest → newest.
// (PDF screenshots show oldest at top with newest at bottom.)

export type NoteAttachment = {
  id: string;
  filename: string;
  mimetype: string | null;
  size_bytes: number | null;
  url: string | null;
};

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
      attachments: NoteAttachment[];
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
      kind: "status_change";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      from_status: TaskStatus | null;
      to_status: TaskStatus;
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
    }
  | {
      // #6: generic projection of an audit_logs row. Covers the activity
      // types that have a writer but no bespoke feed kind — approval gates,
      // sub-tasks, timesheets, scheduled activities, links/dependencies,
      // followers, hold/resume, deadline edits. Rendered with a per-action
      // Arabic label so the feed reflects everything that happened.
      kind: "audit_event";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      action: string;
      metadata: Record<string, unknown>;
    };

// #6: audit_logs actions surfaced in the task activity feed. `status_change`
// and `assignee_change` keep their dedicated feed kinds; every other action
// here is projected through the generic `audit_event` kind. `comment_add`,
// `task.create` and `star_toggled` are intentionally excluded — they are
// already represented by the note / task_created kinds or are pure noise.
const FEED_AUDIT_ACTIONS = [
  "task.status_change",
  "task.assignee_change",
  "task.assignee_add",
  "task.assignee_remove",
  "task.subtask_create",
  "task.timesheet_add",
  "task.activity_create",
  "task.activity_complete",
  "task.approval_requested",
  "task.approved",
  "task.rejected",
  "task.follower_add",
  "task.follower_remove",
  "task.hold",
  "task.resume",
  "task.deadline_set",
  "task.counts_set",
  "task.bulk_update",
  "task_link.create",
  "task_link.update",
  "task_link.delete",
] as const;

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
        // Route every Odoo attachment through the dashboard proxy so the
        // user doesn't need an active Odoo session in their browser. The
        // raw `url` field on ir.attachment is only set for external links
        // anyway — file-typed attachments (the common case) report null.
        attachments: attachments.map((att) => ({
          ...att,
          url: `/api/odoo/attachment/${att.id}`,
        })),
      });
    }
  }
  return out;
}

export async function getTaskActivityFeed(
  orgId: string,
  taskId: string,
): Promise<TaskActivity[]> {
  // Fan out reads in parallel.
  const [taskRes, commentsRes, stageHistoryRes, auditRes, attachmentsRes] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select("external_source")
      .eq("organization_id", orgId)
      .eq("id", taskId)
      .maybeSingle(),
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
      .in("action", FEED_AUDIT_ACTIONS as unknown as string[]),
    supabaseAdmin
      .from("task_attachments")
      .select("id, task_comment_id, filename, mimetype, size_bytes, storage_path, source_url, external_source, external_id")
      .eq("organization_id", orgId)
      .eq("task_id", taskId)
      .not("task_comment_id", "is", null),
  ]);

  // For Odoo-imported tasks the synced chatter already carries "Task Created"
  // and stage-move notifications, so the task_stage_history-derived feed items
  // would just duplicate them (with a generic "النظام" actor). Suppress them
  // and let Odoo's chatter be the single source for those events.
  const isOdooTask = taskRes.data?.external_source === "odoo";
  const comments = commentsRes.data ?? [];
  const stageHistory = isOdooTask ? [] : stageHistoryRes.data ?? [];
  const audits = auditRes.data ?? [];
  const attachments = attachmentsRes.data ?? [];

  // Group attachments by comment + sign storage paths in batch. Odoo-imported
  // rows carry only `source_url` (no storage_path) so they fall through as-is.
  const attachmentsByComment = new Map<string, NoteAttachment[]>();
  const pathsToSign = attachments
    .map((a) => a.storage_path)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  const signedByPath = new Map<string, string>();
  if (pathsToSign.length > 0) {
    const { data: signed } = await supabaseAdmin
      .storage
      .from("attachments")
      .createSignedUrls(pathsToSign, 60 * 60); // 1 hour
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
    }
  }
  for (const a of attachments) {
    if (!a.task_comment_id) continue;
    // Resolution order:
    //   1. signed Supabase Storage URL (primary path post-backfill)
    //   2. internal proxy /api/odoo/attachment/{external_id} for Odoo-imported
    //      rows that still only have a source_url — the proxy authenticates
    //      to Odoo server-side so the user doesn't need an Odoo session
    //   3. raw source_url (last resort, user must auth to Odoo themselves)
    let url: string | null = null;
    if (a.storage_path) {
      url = signedByPath.get(a.storage_path) ?? null;
    } else if (a.external_source === "odoo" && a.external_id) {
      url = `/api/odoo/attachment/${a.external_id}`;
    } else if (a.source_url) {
      url = a.source_url;
    }
    const arr = attachmentsByComment.get(a.task_comment_id) ?? [];
    arr.push({
      id: a.id,
      filename: a.filename,
      mimetype: a.mimetype,
      size_bytes: a.size_bytes,
      url,
    });
    attachmentsByComment.set(a.task_comment_id, arr);
  }

  // Resolve actor names + employee labels we'll need across all sources.
  const userIds = new Set<string>();
  const employeeIds = new Set<string>();
  const mentionCommentIds: string[] = [];
  // Odoo-imported notes have no author_user_id and only carry the partner
  // name + an Odoo /web/image URL that needs an Odoo session to load. Collect
  // those names so we can swap in the local employee avatar instead.
  const externalAuthorNames = new Set<string>();

  for (const c of comments) {
    if (c.author_user_id) userIds.add(c.author_user_id);
    else if (c.external_author_name) externalAuthorNames.add(c.external_author_name);
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

  const [profilesRes, employeesRes, mentionsRes, externalAuthorsRes] = await Promise.all([
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
    externalAuthorNames.size
      ? supabaseAdmin
          .from("employee_profiles")
          .select("full_name, avatar_url")
          .eq("organization_id", orgId)
          .in("full_name", Array.from(externalAuthorNames))
      : Promise.resolve({ data: [] as { full_name: string; avatar_url: string | null }[] }),
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
  // Local avatar by employee name — used to give Odoo-imported notes the same
  // avatar shown for assignees/followers instead of an unreachable Odoo image.
  const avatarByName = new Map<string, string | null>();
  for (const p of externalAuthorsRes.data ?? []) {
    if (!avatarByName.has(p.full_name)) avatarByName.set(p.full_name, p.avatar_url);
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
        ? {
            name: c.external_author_name,
            // Prefer the synced local avatar (matches assignees/followers);
            // the Odoo /web/image URL needs an Odoo session and won't load.
            avatar:
              avatarByName.get(c.external_author_name)
              ?? c.external_author_avatar_url
              ?? null,
          }
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
      attachments: attachmentsByComment.get(c.id) ?? [],
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

  const isTaskStatus = (v: unknown): v is TaskStatus =>
    typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);

  for (const a of audits) {
    const actor = a.actor_user_id
      ? profileByUser.get(a.actor_user_id) ?? null
      : null;

    if (a.action === "task.status_change") {
      const meta = (a.metadata ?? {}) as { from?: unknown; to?: unknown };
      if (!isTaskStatus(meta.to)) continue;
      items.push({
        kind: "status_change",
        id: a.id,
        created_at: a.created_at,
        actor,
        from_status: isTaskStatus(meta.from) ? meta.from : null,
        to_status: meta.to,
      });
      continue;
    }

    if (a.action === "task.assignee_change") {
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
        actor,
        role_type: meta.role_type,
        from_employee: meta.from_employee_id
          ? employeeById.get(meta.from_employee_id) ?? null
          : null,
        to_employee: meta.to_employee_id
          ? employeeById.get(meta.to_employee_id) ?? null
          : null,
      });
      continue;
    }

    // #6: every other tracked action — approvals, sub-tasks, timesheets,
    // scheduled activities, links, followers, hold/resume — is surfaced
    // through the generic audit_event kind.
    items.push({
      kind: "audit_event",
      id: a.id,
      created_at: a.created_at,
      actor,
      action: a.action,
      metadata: (a.metadata ?? {}) as Record<string, unknown>,
    });
  }

  items.sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  return items;
}
