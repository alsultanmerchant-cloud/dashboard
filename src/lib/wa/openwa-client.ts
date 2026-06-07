import "server-only";

// Thin server-side client for the self-hosted OpenWA gateway REST API.
// Base: http://<host>:2785/api · auth: X-API-Key. One fixed session per
// install (single dedicated WhatsApp number). All dashboard calls go through
// here so OpenWA credentials never reach the browser.
//
// Endpoints (OpenWA docs/06-api-specification.md):
//   POST   /api/sessions                         create
//   POST   /api/sessions/:id/start               start
//   GET    /api/sessions/:id                      status
//   GET    /api/sessions/:id/qr                   { data: { code, image } }
//   POST   /api/sessions/:id/logout              logout
//   GET    /api/sessions/:id/groups              list groups
//   POST   /api/sessions/:id/webhooks            register webhook

export type WaSessionStatus =
  | "NOT_CONFIGURED" // no WA_API_URL set
  | "UNREACHABLE" // gateway down / network error
  | "NOT_CREATED" // session doesn't exist yet
  | "INITIALIZING"
  | "SCAN_QR"
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "FAILED";

export const WA_SESSION_ID = process.env.WA_SESSION_ID ?? "rawasm";

export function waConfigured(): boolean {
  return !!process.env.WA_API_URL;
}

function base(): string {
  return (process.env.WA_API_URL ?? "").replace(/\/$/, "");
}

async function call(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const key = process.env.WA_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "X-API-Key": key } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-json */
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

// OpenWA in practice returns lowercase statuses like "qr_ready", "created",
// "initializing", "connected" — NOT the uppercase forms the docs imply.
// Normalise to the dashboard's WaSessionStatus union.
function extractStatus(json: unknown): WaSessionStatus | null {
  const data =
    (json as { data?: Record<string, unknown> })?.data ??
    (json as Record<string, unknown>);
  const raw = (data?.status ?? data?.state) as string | undefined;
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/-/g, "_");
  switch (s) {
    case "qr_ready":
    case "scan_qr":
    case "scan_code":
      return "SCAN_QR";
    case "created":
    case "initializing":
    case "starting":
      return "INITIALIZING";
    case "connecting":
    case "authenticating":
      return "CONNECTING";
    case "connected":
    case "ready":
    case "working":
      return "CONNECTED";
    case "disconnected":
    case "logged_out":
    case "stopped":
      return "DISCONNECTED";
    case "failed":
    case "auth_failure":
    case "error":
      return "FAILED";
    default:
      return "INITIALIZING";
  }
}

export interface WaSessionInfo {
  status: WaSessionStatus;
  phone: string | null;
  pushname: string | null;
  detail?: string;
}

// OpenWA addresses sessions by UUID, NOT by the human "name". We look up the
// uuid for our configured WA_SESSION_ID name once per process and reuse it.
// `null` = no session yet. Cleared on logout.
let cachedSessionUuid: string | null = null;

async function findSessionUuid(): Promise<string | null> {
  if (cachedSessionUuid) return cachedSessionUuid;
  const { ok, json } = await call("/api/sessions");
  if (!ok) return null;
  const list = Array.isArray(json)
    ? json
    : ((json as { data?: unknown }).data ?? (json as { sessions?: unknown }).sessions ?? []);
  const found = (list as Array<Record<string, unknown>>).find((s) => s.name === WA_SESSION_ID);
  cachedSessionUuid = (found?.id as string) ?? null;
  return cachedSessionUuid;
}

function parseSessionPayload(json: unknown): WaSessionInfo {
  const data =
    (json as { data?: Record<string, unknown> })?.data ?? (json as Record<string, unknown>);
  return {
    status: extractStatus(json) ?? "INITIALIZING",
    phone: (data?.phone as string) ?? (data?.me as string) ?? null,
    pushname:
      (data?.pushname as string) ??
      (data?.pushName as string) ??
      (data?.name as string) ??
      null,
  };
}

export async function getSessionInfo(): Promise<WaSessionInfo> {
  if (!waConfigured()) return { status: "NOT_CONFIGURED", phone: null, pushname: null };
  try {
    const uuid = await findSessionUuid();
    if (!uuid) return { status: "NOT_CREATED", phone: null, pushname: null };
    const { ok, status, json } = await call(`/api/sessions/${uuid}`);
    if (status === 404) {
      cachedSessionUuid = null;
      return { status: "NOT_CREATED", phone: null, pushname: null };
    }
    if (!ok) return { status: "UNREACHABLE", phone: null, pushname: null, detail: `HTTP ${status}` };
    return parseSessionPayload(json);
  } catch (e) {
    return { status: "UNREACHABLE", phone: null, pushname: null, detail: (e as Error).message };
  }
}

export async function getQrImage(): Promise<string | null> {
  if (!waConfigured()) return null;
  try {
    const uuid = await findSessionUuid();
    if (!uuid) return null;
    const { ok, json } = await call(`/api/sessions/${uuid}/qr`);
    if (!ok) return null;
    // Real OpenWA response: { qrCode: "data:image/png;base64,...", status }.
    // Docs-shape fallback: { data: { image: "..." } }.
    const top = json as { qrCode?: string; data?: { image?: string; qrCode?: string } };
    return top.qrCode ?? top.data?.qrCode ?? top.data?.image ?? null;
  } catch {
    return null;
  }
}

// Create (idempotent) + start the session, and register our webhook so
// incoming group messages flow to the dashboard automatically.
export async function startSession(): Promise<{ ok: boolean; error?: string }> {
  if (!waConfigured()) return { ok: false, error: "WA_API_URL غير مهيأ" };
  try {
    // Find or create — POST /api/sessions returns the new uuid; 409 if it
    // already exists, in which case we look it up.
    let uuid = await findSessionUuid();
    if (!uuid) {
      const created = await call(`/api/sessions`, {
        method: "POST",
        body: JSON.stringify({ name: WA_SESSION_ID }),
      });
      const body = created.json as { id?: string; data?: { id?: string } } | null;
      uuid = body?.id ?? body?.data?.id ?? null;
      if (!uuid) {
        // Conflict or unexpected — re-list.
        cachedSessionUuid = null;
        uuid = await findSessionUuid();
      }
      cachedSessionUuid = uuid;
    }
    if (!uuid) return { ok: false, error: "could not resolve session uuid" };

    const started = await call(`/api/sessions/${uuid}/start`, { method: "POST" });
    if (!started.ok && started.status !== 409) {
      return { ok: false, error: `start HTTP ${started.status}` };
    }
    // Best-effort webhook registration (idempotent on the OpenWA side).
    const webhookUrl = process.env.WA_PUBLIC_WEBHOOK_URL;
    if (webhookUrl) {
      await call(`/api/sessions/${uuid}/webhooks`, {
        method: "POST",
        body: JSON.stringify({
          url: webhookUrl,
          // OpenWA gateway event names: incoming messages = "message.received"
          // (NOT "message", which it silently ignores). See docs/06-api-spec.
          events: ["message.received", "session.status"],
          secret: process.env.WA_WEBHOOK_SECRET ?? undefined,
        }),
      }).catch(() => {});
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function logoutSession(): Promise<{ ok: boolean; error?: string }> {
  if (!waConfigured()) return { ok: false, error: "WA_API_URL غير مهيأ" };
  try {
    const uuid = await findSessionUuid();
    if (!uuid) return { ok: true }; // nothing to log out
    const { ok, status } = await call(`/api/sessions/${uuid}/logout`, { method: "POST" });
    cachedSessionUuid = null; // forget so next call re-resolves
    return ok || status === 404 ? { ok: true } : { ok: false, error: `HTTP ${status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface WaHistoryMessage {
  id: string;
  from: string | null;
  body: string;
  type: string;
  timestamp: number; // unix seconds
  fromMe: boolean;
}

// Fetch historical messages for a chat from the WhatsApp-Web store via the
// custom gateway endpoint (added to OpenWA: GET /groups/:chatId/messages).
// Returns up to `limit` messages (the store caps at whatever WA synced).
export async function fetchChatHistory(
  chatId: string,
  limit = 1000,
): Promise<WaHistoryMessage[]> {
  if (!waConfigured()) return [];
  const uuid = await findSessionUuid();
  if (!uuid) return [];
  const { ok, json } = await call(
    `/api/sessions/${uuid}/groups/${chatId}/messages?limit=${limit}`,
    { timeoutMs: 90000 },
  );
  if (!ok || !json) return [];
  const arr = (json as { messages?: unknown }).messages;
  if (!Array.isArray(arr)) return [];
  return (arr as Array<Record<string, unknown>>).map((m) => ({
    id: String(m.id ?? ""),
    from: typeof m.from === "string" ? m.from : null,
    body: typeof m.body === "string" ? m.body : "",
    type: String(m.type ?? "chat"),
    timestamp: Number(m.timestamp ?? 0),
    fromMe: m.fromMe === true,
  })).filter((m) => m.id);
}

export interface WaRemoteGroup {
  id: string;
  name: string | null;
}

export async function listGroups(): Promise<WaRemoteGroup[]> {
  if (!waConfigured()) return [];
  const uuid = await findSessionUuid();
  if (!uuid) return [];
  const { ok, json } = await call(`/api/sessions/${uuid}/groups`);
  if (!ok) return [];
  const list = Array.isArray(json)
    ? json
    : ((json as { data?: unknown }).data ?? (json as { groups?: unknown }).groups ?? []);
  return (list as Array<Record<string, unknown>>)
    .map((g) => ({
      id:
        (typeof g.id === "string" ? g.id : (g.id as { _serialized?: string })?._serialized) ??
        (g.chatId as string) ??
        "",
      name: (g.name as string) ?? (g.subject as string) ?? null,
    }))
    .filter((g) => g.id.endsWith("@g.us"));
}

export interface WaGroupMeta {
  memberCount: number;
  adminCount: number;
  owner: string | null;
  description: string | null;
}

// Live group metadata from GET /api/sessions/:uuid/groups/:gid — the only
// source of participant/member info (OpenWA stores no message history).
// The gateway caps concurrency on this endpoint (~3-4) and returns 429 beyond
// that, so callers MUST go through getGroupsMeta (bounded pool + retry).
async function fetchGroupMeta(uuid: string, chatId: string): Promise<WaGroupMeta | null> {
  // Retry on 429 (concurrency cap) with exponential backoff + jitter. The gateway
  // budget drifts under sustained load over hundreds of groups, so be patient.
  for (let attempt = 0; attempt < 7; attempt++) {
    const res = await call(`/api/sessions/${uuid}/groups/${chatId}`, {
      timeoutMs: 12000,
    }).catch(() => ({ ok: false, status: 0, json: null }) as Awaited<ReturnType<typeof call>>);
    if (res.status === 429) {
      const backoff = Math.min(3000, 300 * 2 ** attempt) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    if (!res.ok || !res.json || typeof res.json !== "object") return null;
    const g = res.json as Record<string, unknown>;
    const participants = Array.isArray(g.participants)
      ? (g.participants as Array<Record<string, unknown>>)
      : [];
    return {
      memberCount: participants.length,
      adminCount: participants.filter((p) => p.isAdmin === true || p.isSuperAdmin === true).length,
      owner: typeof g.owner === "string" ? g.owner : null,
      description: typeof g.description === "string" ? g.description : null,
    };
  }
  return null;
}

// Fetch member counts for many groups with a BOUNDED worker pool. The OpenWA
// gateway 429s above ~3-4 concurrent requests, so we cap at 3. Failures for
// individual groups are skipped (omitted from the map), never thrown.
const META_CONCURRENCY = 2;
export async function getGroupsMeta(chatIds: string[]): Promise<Record<string, WaGroupMeta>> {
  if (!waConfigured() || chatIds.length === 0) return {};
  const uuid = await findSessionUuid();
  if (!uuid) return {};
  const queue = Array.from(new Set(chatIds.filter((id) => id.endsWith("@g.us"))));
  const out: Record<string, WaGroupMeta> = {};
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const chatId = queue[cursor++];
      const meta = await fetchGroupMeta(uuid!, chatId);
      if (meta) out[chatId] = meta;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(META_CONCURRENCY, queue.length) }, () => worker()),
  );
  return out;
}
