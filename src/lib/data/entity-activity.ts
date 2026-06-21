import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MentionableEmployee } from "@/lib/data/employees";

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
      // Full contract-state snapshot the sheet records on every log event.
      // Carries the detail (target/type/dates/values) that `notes` omits —
      // e.g. Close events have no notes, only this snapshot.
      snapshot: Record<string, unknown>;
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
  job_title: string | null;
  employment_status: string;
};

type ActorResolver = {
  byUserId: (userId: string | null | undefined) => ActivityActor;
  byProfileId: (profileId: string | null | undefined) => ActivityActor;
  byName: (name: string | null | undefined) => ActivityActor;
};

async function listActivityEmployees(orgId: string): Promise<EmployeeLite[]> {
  const { data } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, user_id, full_name, avatar_url, job_title, employment_status")
    .eq("organization_id", orgId);
  return (data ?? []) as EmployeeLite[];
}

function buildActorResolver(employees: EmployeeLite[]): ActorResolver {
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

type ActivityEventRow = {
  id: string;
  event_type: string;
  occurred_at: string;
  actor_id: string | null;
  payload: Record<string, unknown> | null;
};

async function loadEntityActivity(
  orgId: string,
  ref: EntityRef,
  limit: number,
  knownContractExternalId?: string | null,
): Promise<{
  items: EntityActivity[];
  employees: EmployeeLite[];
  events: ActivityEventRow[];
}> {
  // These requests are independent. Start them together so employee lookup,
  // contract-scope resolution, and comments do not form a waterfall.
  const employeesPromise = listActivityEmployees(orgId);
  const scopePromise = (async () => {
    if (ref.entityType === "contract") {
      if (knownContractExternalId !== undefined) {
        return {
          contractIds: [ref.entityId],
          contractKeys: knownContractExternalId ? [knownContractExternalId] : [],
        };
      }
      const { data: contract } = await supabaseAdmin
        .from("contracts")
        .select("external_id")
        .eq("organization_id", orgId)
        .eq("id", ref.entityId)
        .maybeSingle();
      const externalId = (contract as { external_id?: string | null } | null)?.external_id;
      return {
        contractIds: [ref.entityId],
        contractKeys: externalId ? [externalId] : [],
      };
    }

    const { data: rows } = await supabaseAdmin
      .from("contracts")
      .select("id, external_id")
      .eq("organization_id", orgId)
      .eq("client_id", ref.entityId);
    const contractIds: string[] = [];
    const contractKeys: string[] = [];
    for (const row of (rows ?? []) as { id: string; external_id: string | null }[]) {
      contractIds.push(row.id);
      if (row.external_id) contractKeys.push(row.external_id);
    }
    return { contractIds, contractKeys };
  })();
  const commentsPromise = supabaseAdmin
    .from("entity_comments")
    .select("id, body, is_internal, created_at, author_user_id")
    .eq("organization_id", orgId)
    .eq("entity_type", ref.entityType)
    .eq("entity_id", ref.entityId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const [{ contractIds, contractKeys }, { data: comments }] = await Promise.all([
    scopePromise,
    commentsPromise,
  ]);
  const commentRows = (comments ?? []) as {
    id: string;
    body: string;
    is_internal: boolean;
    created_at: string;
    author_user_id: string | null;
  }[];

  const commentIds = commentRows.map((c) => c.id);
  const commentDetailsPromise =
    commentIds.length > 0
      ? Promise.all([
          supabaseAdmin
            .from("entity_comment_mentions")
            .select("comment_id, mentioned_employee_id, employee_profiles!entity_comment_mentions_mentioned_employee_id_fkey(full_name)")
            .in("comment_id", commentIds),
          supabaseAdmin
            .from("entity_comment_attachments")
            .select("id, comment_id, storage_path, filename, mimetype, size_bytes")
            .in("comment_id", commentIds),
        ])
      : Promise.resolve([
          { data: [] as unknown[] },
          { data: [] as unknown[] },
        ]);

  let logsPromise: PromiseLike<{ data: unknown[] | null }> = Promise.resolve({ data: [] });
  if (contractIds.length > 0 || contractKeys.length > 0) {
    const orParts: string[] = [];
    if (contractIds.length > 0) orParts.push(`contract_id.in.(${contractIds.join(",")})`);
    if (contractKeys.length > 0) {
      const quoted = contractKeys.map((key) => `"${key.replace(/"/g, '\\"')}"`).join(",");
      orParts.push(`contract_key.in.(${quoted})`);
    }
    logsPromise = supabaseAdmin
      .from("contract_sheet_logs")
      .select("id, log_type, notes, snapshot, log_time, account_manager, contract_key, contract_id")
      .eq("organization_id", orgId)
      .or(orParts.join(","))
      .order("log_time", { ascending: false })
      .limit(limit);
  }

  const eventsPromise =
    contractIds.length > 0
      ? supabaseAdmin
          .from("contract_events")
          .select("id, event_type, occurred_at, actor_id, payload")
          .eq("organization_id", orgId)
          .in("contract_id", contractIds)
          .order("occurred_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [] as unknown[] });

  const [employees, commentDetails, logsResult, eventsResult] = await Promise.all([
    employeesPromise,
    commentDetailsPromise,
    logsPromise,
    eventsPromise,
  ]);
  const resolver = buildActorResolver(employees);
  const [{ data: mns }, { data: atts }] = commentDetails;
  const mentionsByComment = new Map<string, { employee_id: string; full_name: string }[]>();
  const attachmentsByComment = new Map<string, ActivityAttachment[]>();
  for (const mention of (mns ?? []) as unknown as Array<{
    comment_id: string;
    mentioned_employee_id: string;
    employee_profiles: { full_name: string } | { full_name: string }[] | null;
  }>) {
    const employee = Array.isArray(mention.employee_profiles)
      ? mention.employee_profiles[0]
      : mention.employee_profiles;
    const rows = mentionsByComment.get(mention.comment_id) ?? [];
    rows.push({
      employee_id: mention.mentioned_employee_id,
      full_name: employee?.full_name ?? "",
    });
    mentionsByComment.set(mention.comment_id, rows);
  }

  const attachmentRows = (atts ?? []) as Array<{
    id: string;
    comment_id: string;
    storage_path: string;
    filename: string;
    mimetype: string | null;
    size_bytes: number | null;
  }>;
  const signedByPath = new Map<string, string>();
  if (attachmentRows.length > 0) {
    const paths = Array.from(new Set(attachmentRows.map((attachment) => attachment.storage_path)));
    const { data: signed } = await supabaseAdmin.storage
      .from("attachments")
      .createSignedUrls(paths, 3600);
    for (const row of signed ?? []) {
      if (row.path && row.signedUrl) signedByPath.set(row.path, row.signedUrl);
    }
  }
  for (const attachment of attachmentRows) {
    const rows = attachmentsByComment.get(attachment.comment_id) ?? [];
    rows.push({
      id: attachment.id,
      filename: attachment.filename,
      mimetype: attachment.mimetype,
      size_bytes: attachment.size_bytes,
      url: signedByPath.get(attachment.storage_path) ?? null,
    });
    attachmentsByComment.set(attachment.comment_id, rows);
  }

  const out: EntityActivity[] = [];
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
  for (const log of (logsResult.data ?? []) as Array<{
    id: string;
    log_type: string;
    notes: string | null;
    snapshot: Record<string, unknown> | null;
    log_time: string | null;
    account_manager: string | null;
    contract_key: string;
    contract_id: string | null;
  }>) {
    out.push({
      kind: "sheet_log",
      id: log.id,
      created_at: log.log_time ?? new Date(0).toISOString(),
      actor: resolver.byName(log.account_manager),
      log_type: log.log_type,
      notes: log.notes,
      snapshot: log.snapshot ?? {},
      contract_key: log.contract_key,
      contract_id: log.contract_id,
    });
  }

  // 3) contract_events
  const events = (eventsResult.data ?? []) as ActivityEventRow[];
  for (const event of events) {
    out.push({
      kind: "event",
      id: event.id,
      created_at: event.occurred_at,
      actor: resolver.byProfileId(event.actor_id),
      event_type: event.event_type,
      payload: event.payload ?? {},
    });
  }

  // newest first
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return { items: out.slice(0, limit), employees, events };
}

export async function listEntityActivity(
  orgId: string,
  ref: EntityRef,
  limit = 200,
): Promise<EntityActivity[]> {
  const result = await loadEntityActivity(orgId, ref, limit);
  return result.items;
}

export async function getContractActivityBundle(
  orgId: string,
  contractId: string,
  contractExternalId: string | null,
  limit = 200,
): Promise<{
  activity: EntityActivity[];
  mentionable: MentionableEmployee[];
  events: Array<{ event_type: string; occurred_at: string }>;
}> {
  const result = await loadEntityActivity(
    orgId,
    { entityType: "contract", entityId: contractId },
    limit,
    contractExternalId,
  );
  return {
    activity: result.items,
    mentionable: result.employees
      .filter((employee) => employee.employment_status === "active")
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"))
      .map((employee) => ({
        id: employee.id,
        name: employee.full_name,
        jobTitle: employee.job_title,
        avatarUrl: employee.avatar_url,
      })),
    events: result.events.map((event) => ({
      event_type: event.event_type,
      occurred_at: event.occurred_at,
    })),
  };
}
