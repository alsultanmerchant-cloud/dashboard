import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Unified activity feed for contracts & clients. Merges three sources into one
// chronological, task-style feed (avatar + name + timestamp + body):
//   - entity_comments     (user-posted notes via the composer, 0179)
//   - contract_sheet_logs  (synced from the sheet's Logs tab, 0178)
//   - contract_events      (dashboard events: hold/close/status-change notes)
//
// For a contract: that contract's rows. For a client: the union across all of
// the client's contracts, plus client-level comments.

export type ActivityActor = { name: string; avatar: string | null } | null;

export type ActivityAttachment = {
  id: string;
  filename: string;
  mimetype: string | null;
  size_bytes: number | null;
  url: string | null;
};

export type EntityActivity =
  | {
      kind: "comment";
      id: string;
      created_at: string;
      actor: ActivityActor;
      body: string;
      is_internal: boolean;
      mentions: { employee_id: string; full_name: string }[];
      attachments: ActivityAttachment[];
    }
  | {
      kind: "sheet_log";
      id: string;
      created_at: string;
      actor: ActivityActor;
      log_type: string;
      notes: string | null;
      contract_key: string;
      contract_id: string | null;
    }
  | {
      kind: "event";
      id: string;
      created_at: string;
      actor: ActivityActor;
      event_type: string;
      payload: Record<string, unknown>;
    };

export type EntityType = "contract" | "client";
export type EntityRef = { entityType: EntityType; entityId: string };

// ── actor / avatar resolution ──────────────────────────────────────────────

// Normalize a display name for fuzzy matching: strip emoji/symbols/diacritics,
// collapse whitespace, lowercase. The sheet stores names like "🌟سارة الأمين".
function normalizeName(name: string): string {
  return name
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{S}]/gu, "")
    .replace(/[ً-ٰٟ]/g, "") // Arabic diacritics
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type EmployeeLite = {
  id: string;
  user_id: string | null;
  full_name: string;
  avatar_url: string | null;
};

type ActorResolver = {
  byUserId: (userId: string | null | undefined) => ActivityActor;
  byProfileId: (profileId: string | null | undefined) => ActivityActor;
  byName: (name: string | null | undefined) => ActivityActor;
};

async function buildActorResolver(orgId: string): Promise<ActorResolver> {
  const { data } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, user_id, full_name, avatar_url")
    .eq("organization_id", orgId);
  const employees = (data ?? []) as EmployeeLite[];

  const byUid = new Map<string, EmployeeLite>();
  const byPid = new Map<string, EmployeeLite>();
  const byNorm = new Map<string, EmployeeLite>();
  for (const e of employees) {
    if (e.user_id) byUid.set(e.user_id, e);
    byPid.set(e.id, e);
    const n = normalizeName(e.full_name || "");
    if (n && !byNorm.has(n)) byNorm.set(n, e);
  }

  const toActor = (e: EmployeeLite | undefined, fallbackName?: string): ActivityActor => {
    if (e) return { name: e.full_name, avatar: e.avatar_url };
    if (fallbackName && fallbackName.trim()) return { name: fallbackName.trim(), avatar: null };
    return null;
  };

  return {
    byUserId: (uid) => toActor(uid ? byUid.get(uid) : undefined),
    byProfileId: (pid) => toActor(pid ? byPid.get(pid) : undefined),
    byName: (name) => toActor(name ? byNorm.get(normalizeName(name)) : undefined, name ?? undefined),
  };
}

// ── feed assembly ───────────────────────────────────────────────────────────

export async function listEntityActivity(
  orgId: string,
  ref: EntityRef,
  limit = 200,
): Promise<EntityActivity[]> {
  const resolver = await buildActorResolver(orgId);

  // Resolve the set of contracts in scope (for sheet logs + events).
  let contractIds: string[] = [];
  let contractKeys: string[] = [];
  if (ref.entityType === "contract") {
    contractIds = [ref.entityId];
    const { data: c } = await supabaseAdmin
      .from("contracts")
      .select("external_id")
      .eq("id", ref.entityId)
      .maybeSingle();
    const ext = (c as { external_id?: string | null } | null)?.external_id;
    if (ext) contractKeys = [ext];
  } else {
    const { data: rows } = await supabaseAdmin
      .from("contracts")
      .select("id, external_id")
      .eq("organization_id", orgId)
      .eq("client_id", ref.entityId);
    for (const r of (rows ?? []) as { id: string; external_id: string | null }[]) {
      contractIds.push(r.id);
      if (r.external_id) contractKeys.push(r.external_id);
    }
  }

  const out: EntityActivity[] = [];

  // 1) entity_comments (+ mentions + attachments)
  const { data: comments } = await supabaseAdmin
    .from("entity_comments")
    .select("id, body, is_internal, created_at, author_user_id")
    .eq("organization_id", orgId)
    .eq("entity_type", ref.entityType)
    .eq("entity_id", ref.entityId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const commentRows = (comments ?? []) as {
    id: string;
    body: string;
    is_internal: boolean;
    created_at: string;
    author_user_id: string | null;
  }[];

  const commentIds = commentRows.map((c) => c.id);
  const mentionsByComment = new Map<string, { employee_id: string; full_name: string }[]>();
  const attachmentsByComment = new Map<string, ActivityAttachment[]>();
  if (commentIds.length > 0) {
    const [{ data: mns }, { data: atts }] = await Promise.all([
      supabaseAdmin
        .from("entity_comment_mentions")
        .select("comment_id, mentioned_employee_id, employee_profiles!entity_comment_mentions_mentioned_employee_id_fkey(full_name)")
        .in("comment_id", commentIds),
      supabaseAdmin
        .from("entity_comment_attachments")
        .select("id, comment_id, storage_path, filename, mimetype, size_bytes")
        .in("comment_id", commentIds),
    ]);
    for (const m of (mns ?? []) as unknown as Array<{
      comment_id: string;
      mentioned_employee_id: string;
      employee_profiles: { full_name: string } | { full_name: string }[] | null;
    }>) {
      const emp = Array.isArray(m.employee_profiles) ? m.employee_profiles[0] : m.employee_profiles;
      const arr = mentionsByComment.get(m.comment_id) ?? [];
      arr.push({ employee_id: m.mentioned_employee_id, full_name: emp?.full_name ?? "" });
      mentionsByComment.set(m.comment_id, arr);
    }
    for (const a of (atts ?? []) as Array<{
      id: string;
      comment_id: string;
      storage_path: string;
      filename: string;
      mimetype: string | null;
      size_bytes: number | null;
    }>) {
      const { data: signed } = await supabaseAdmin.storage
        .from("attachments")
        .createSignedUrl(a.storage_path, 3600);
      const arr = attachmentsByComment.get(a.comment_id) ?? [];
      arr.push({
        id: a.id,
        filename: a.filename,
        mimetype: a.mimetype,
        size_bytes: a.size_bytes,
        url: signed?.signedUrl ?? null,
      });
      attachmentsByComment.set(a.comment_id, arr);
    }
  }

  for (const c of commentRows) {
    out.push({
      kind: "comment",
      id: c.id,
      created_at: c.created_at,
      actor: resolver.byUserId(c.author_user_id),
      body: c.body,
      is_internal: c.is_internal,
      mentions: mentionsByComment.get(c.id) ?? [],
      attachments: attachmentsByComment.get(c.id) ?? [],
    });
  }

  // 2) contract_sheet_logs (by contract_id, falling back to contract_key)
  if (contractIds.length > 0 || contractKeys.length > 0) {
    const orParts: string[] = [];
    if (contractIds.length > 0) orParts.push(`contract_id.in.(${contractIds.join(",")})`);
    if (contractKeys.length > 0) {
      const quoted = contractKeys.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(",");
      orParts.push(`contract_key.in.(${quoted})`);
    }
    const { data: logs } = await supabaseAdmin
      .from("contract_sheet_logs")
      .select("id, log_type, notes, log_time, account_manager, contract_key, contract_id")
      .eq("organization_id", orgId)
      .or(orParts.join(","))
      .order("log_time", { ascending: false })
      .limit(limit);
    for (const l of (logs ?? []) as Array<{
      id: string;
      log_type: string;
      notes: string | null;
      log_time: string | null;
      account_manager: string | null;
      contract_key: string;
      contract_id: string | null;
    }>) {
      out.push({
        kind: "sheet_log",
        id: l.id,
        created_at: l.log_time ?? new Date(0).toISOString(),
        actor: resolver.byName(l.account_manager),
        log_type: l.log_type,
        notes: l.notes,
        contract_key: l.contract_key,
        contract_id: l.contract_id,
      });
    }
  }

  // 3) contract_events
  if (contractIds.length > 0) {
    const { data: events } = await supabaseAdmin
      .from("contract_events")
      .select("id, event_type, occurred_at, actor_id, payload")
      .eq("organization_id", orgId)
      .in("contract_id", contractIds)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    for (const e of (events ?? []) as Array<{
      id: string;
      event_type: string;
      occurred_at: string;
      actor_id: string | null;
      payload: Record<string, unknown> | null;
    }>) {
      out.push({
        kind: "event",
        id: e.id,
        created_at: e.occurred_at,
        actor: resolver.byProfileId(e.actor_id),
        event_type: e.event_type,
        payload: e.payload ?? {},
      });
    }
  }

  // newest first
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return out.slice(0, limit);
}
