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

// Tenant isolation: the OpenWA gateway is shared across tenants on the same VPS,
// so its session list includes OTHER tenants' numbers. This dashboard must only
// ever touch its OWN sessions — the primary (WA_SESSION_ID) and the numbers it
// created via Connect, which are named `${WA_SESSION_ID}-<hex>`. Anything else
// (e.g. `dash-org-…`) belongs to a different tenant and must never be enrolled,
// webhooked, or read from here.
export function isOwnSession(sessionName: string | null | undefined): boolean {
  if (!sessionName) return false;
  return sessionName === WA_SESSION_ID || sessionName.startsWith(`${WA_SESSION_ID}-`);
}

// A webhook URL the GATEWAY itself must be able to reach. `.env.local` points
// WA_PUBLIC_WEBHOOK_URL at http://localhost:3000, so any connect/reconnect run
// from a dev machine would happily delete the working production webhook and
// replace it with an address the VPS can never reach — silently black-holing
// every message. Enforced inside registerSessionWebhook so EVERY caller is
// protected (add-number, connect, resync, wa-health), not just the resync route.
export function isPubliclyRoutableWebhookUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return !/^(localhost$|127\.|0\.0\.0\.0$|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
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
  statusUpdatedAt?: string | null;
  // See WaSessionRow.lastActive — a session can report CONNECTED while its
  // browser is wedged and this clock is days old. The Connect page must show
  // that instead of a green "متصل".
  lastActive?: string | null;
  detail?: string;
}

// OpenWA addresses sessions by UUID, NOT by the human "name". We look up the
// uuid for a session name once per process and reuse it. Multiple numbers =
// multiple session names, so the cache is keyed by name. Cleared on logout.
const sessionUuidCache = new Map<string, string>();

async function findSessionUuid(sessionName: string = WA_SESSION_ID): Promise<string | null> {
  const cached = sessionUuidCache.get(sessionName);
  if (cached) return cached;
  const { ok, json } = await call("/api/sessions");
  if (!ok) return null;
  const list = Array.isArray(json)
    ? json
    : ((json as { data?: unknown }).data ?? (json as { sessions?: unknown }).sessions ?? []);
  const found = (list as Array<Record<string, unknown>>).find((s) => s.name === sessionName);
  const uuid = (found?.id as string) ?? null;
  if (uuid) sessionUuidCache.set(sessionName, uuid);
  return uuid;
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
    statusUpdatedAt:
      (data?.updatedAt as string) ??
      (data?.updated_at as string) ??
      null,
    lastActive: historyString(data?.lastActive, data?.last_active, data?.lastSeenAt) ?? null,
  };
}

export async function getSessionInfo(sessionName: string = WA_SESSION_ID): Promise<WaSessionInfo> {
  if (!waConfigured()) return { status: "NOT_CONFIGURED", phone: null, pushname: null };
  try {
    const uuid = await findSessionUuid(sessionName);
    if (!uuid) return { status: "NOT_CREATED", phone: null, pushname: null };
    const { ok, status, json } = await call(`/api/sessions/${uuid}`);
    if (status === 404) {
      sessionUuidCache.delete(sessionName);
      return { status: "NOT_CREATED", phone: null, pushname: null };
    }
    if (!ok) return { status: "UNREACHABLE", phone: null, pushname: null, detail: `HTTP ${status}` };
    return parseSessionPayload(json);
  } catch (e) {
    return { status: "UNREACHABLE", phone: null, pushname: null, detail: (e as Error).message };
  }
}

export async function getQrImage(sessionName: string = WA_SESSION_ID): Promise<string | null> {
  if (!waConfigured()) return null;
  try {
    const uuid = await findSessionUuid(sessionName);
    if (!uuid) return null;
    const { ok, json } = await call(`/api/sessions/${uuid}/qr`);
    if (!ok) return null;
    // Real OpenWA response: { qrCode: "data:image/png;base64,...", status }.
    // Docs-shape fallback: { data: { image: "..." } }.
    if (typeof json === "string") return json;
    const top = json as {
      qrCode?: string;
      image?: string;
      data?: { image?: string; qrCode?: string };
    };
    return top.qrCode ?? top.image ?? top.data?.qrCode ?? top.data?.image ?? null;
  } catch {
    return null;
  }
}

// Create (idempotent) + start the session, and register our webhook so
// incoming group messages flow to the dashboard automatically.
export async function startSession(
  sessionName: string = WA_SESSION_ID,
): Promise<{ ok: boolean; error?: string }> {
  if (!waConfigured()) return { ok: false, error: "WA_API_URL غير مهيأ" };
  try {
    // Find or create — POST /api/sessions returns the new uuid; 409 if it
    // already exists, in which case we look it up.
    let uuid = await findSessionUuid(sessionName);
    if (!uuid) {
      const created = await call(`/api/sessions`, {
        method: "POST",
        body: JSON.stringify({ name: sessionName }),
      });
      const body = created.json as { id?: string; data?: { id?: string } } | null;
      uuid = body?.id ?? body?.data?.id ?? null;
      if (!uuid) {
        // Conflict or unexpected — re-list.
        sessionUuidCache.delete(sessionName);
        uuid = await findSessionUuid(sessionName);
      }
      if (uuid) sessionUuidCache.set(sessionName, uuid);
    }
    if (!uuid) return { ok: false, error: "could not resolve session uuid" };

    const started = await call(`/api/sessions/${uuid}/start`, {
      method: "POST",
      // Chromium startup on the VPS regularly exceeds the generic 8s API
      // timeout even though the session goes on to connect successfully.
      timeoutMs: 30_000,
    });
    if (!started.ok && started.status !== 409) {
      return { ok: false, error: `start HTTP ${started.status}` };
    }
    await registerSessionWebhook(uuid, sessionName);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// A session can remain wedged in `authenticating` while its browser process is
// still registered as running. Calling start again then returns HTTP 400 and no
// QR is ever produced. Force-kill is OpenWA's explicit recovery path for that
// state; once teardown completes, starting the same session produces a fresh QR.
export async function restartStuckSession(
  sessionName: string = WA_SESSION_ID,
): Promise<{ ok: boolean; error?: string }> {
  if (!waConfigured()) return { ok: false, error: "WA_API_URL غير مهيأ" };
  try {
    const uuid = await findSessionUuid(sessionName);
    if (!uuid) return startSession(sessionName);

    let stopped = await call(`/api/sessions/${uuid}/force-kill`, {
      method: "POST",
      timeoutMs: 15_000,
    });
    // Older OpenWA deployments predate force-kill but expose /stop, which is
    // sufficient to tear down the stale engine before restarting it.
    if (stopped.status === 404) {
      stopped = await call(`/api/sessions/${uuid}/stop`, {
        method: "POST",
        timeoutMs: 15_000,
      });
    }
    if (!stopped.ok) {
      return { ok: false, error: `stop HTTP ${stopped.status}` };
    }

    // The response normally arrives after teardown, but allow a short grace
    // period before starting Chromium again on slower gateways.
    await new Promise((resolve) => setTimeout(resolve, 500));
    sessionUuidCache.delete(sessionName);
    return startSession(sessionName);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Register the dashboard webhook on ONE session. Idempotent + self-cleaning:
// the gateway's POST /webhooks is NOT idempotent (repeated calls pile up
// duplicate rows → duplicate deliveries), so we first DELETE any existing
// webhooks that point at THIS app's webhook path, then create exactly one.
// Tag the URL with ?account=<sessionName> so inbound events attribute to the
// right wa_accounts row (provenance). Returns false (no throw) when no public
// URL is configured, or when the session isn't ours (tenant isolation).
export async function registerSessionWebhook(
  uuid: string,
  sessionName: string,
): Promise<boolean> {
  const webhookUrl = process.env.WA_PUBLIC_WEBHOOK_URL;
  if (!webhookUrl) return false;
  // Bail BEFORE the delete pass below: a dev-machine run must never strip the
  // live production webhook off the shared gateway.
  if (!isPubliclyRoutableWebhookUrl(webhookUrl)) {
    console.warn("[wa_webhook_register_skipped] WA_PUBLIC_WEBHOOK_URL is not publicly routable");
    return false;
  }
  if (!isOwnSession(sessionName)) return false; // never webhook a foreign tenant's session
  const basePath = webhookUrl.split("?")[0]; // our /api/wa/webhook, sans query
  const taggedUrl = `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}account=${encodeURIComponent(sessionName)}`;

  // Remove our own stale/duplicate webhooks first (match by our base path only,
  // so we never touch another app's webhook registered on the same session).
  const existing = await listSessionWebhooks(uuid);
  for (const w of existing) {
    if (w.url.split("?")[0] === basePath) {
      await call(`/api/sessions/${uuid}/webhooks/${w.id}`, { method: "DELETE" }).catch(() => {});
    }
  }

  const res = await call(`/api/sessions/${uuid}/webhooks`, {
    method: "POST",
    body: JSON.stringify({
      // OpenWA gateway event names: incoming messages = "message.received"
      // (NOT "message", which it silently ignores). See docs/06-api-spec.
      url: taggedUrl,
      events: ["message.received", "session.status"],
      secret: process.env.WA_WEBHOOK_SECRET ?? undefined,
    }),
  }).catch(() => ({ ok: false }) as { ok: boolean });
  return res.ok;
}

// The webhooks currently registered on a session (id + url, for de-duplication).
export async function listSessionWebhooks(
  uuid: string,
): Promise<Array<{ id: string; url: string; active: boolean }>> {
  const { ok, json } = await call(`/api/sessions/${uuid}/webhooks`);
  if (!ok) return [];
  const list = Array.isArray(json)
    ? json
    : ((json as { data?: unknown }).data ?? (json as { webhooks?: unknown }).webhooks ?? []);
  return (list as Array<Record<string, unknown>>)
    .map((w) => ({
      id: (w.id as string) ?? "",
      url: (w.url as string) ?? "",
      // The gateway can leave a row in place but flag it inactive. A registered
      // -but-inactive webhook delivers nothing, so health checks must treat it
      // as missing rather than trusting the row's existence.
      active: w.active !== false,
    }))
    .filter((w) => w.id && w.url);
}

export interface WaSessionRow {
  name: string;
  uuid: string;
  phone: string | null;
  status: WaSessionStatus;
  // Gateway's own "last time this session did anything" clock. A session can sit
  // at status CONNECTED while its Chromium/WhatsApp-Web page is wedged and this
  // clock stays frozen for days (the 2026-07-14 primary-number failure). Health
  // checks must look at lastActive, NOT status alone.
  lastActive: string | null;
}

// All sessions the gateway knows about, normalised. Lets the dashboard span
// every connected number (not just WA_SESSION_ID) — a client's group may be
// served by any of the agency's numbers, and we must ingest from whichever one
// is actually a member.
export async function listSessions(): Promise<WaSessionRow[]> {
  if (!waConfigured()) return [];
  const { ok, json } = await call("/api/sessions");
  if (!ok) return [];
  const list = Array.isArray(json)
    ? json
    : ((json as { data?: unknown }).data ?? (json as { sessions?: unknown }).sessions ?? []);
  return (list as Array<Record<string, unknown>>)
    .map((s) => ({
      name: (s.name as string) ?? "",
      uuid: (s.id as string) ?? "",
      phone: (s.phone as string) ?? (s.me as string) ?? null,
      status: extractStatus(s) ?? "INITIALIZING",
      lastActive:
        historyString(s.lastActive, s.last_active, s.lastSeenAt, s.updatedAt) ?? null,
    }))
    .filter((s) => s.name && s.uuid);
}

// Fetch a chat's history from whichever of the given sessions is actually a
// member of the group — try each in turn, return the first that yields
// messages (plus the session that served them, for ingest provenance). Groups
// are served by different numbers, so a single-session fetch silently misses
// any group that number isn't in.
export async function fetchChatHistoryViaSessions(
  chatId: string,
  sessionNames: string[],
  limit = 1000,
): Promise<{ messages: WaHistoryMessage[]; sessionName: string } | null> {
  for (const sessionName of sessionNames) {
    try {
      const messages = await fetchChatHistory(chatId, limit, sessionName);
      if (messages.length > 0) return { messages, sessionName };
    } catch {
      /* try the next session */
    }
  }
  return null;
}

export async function logoutSession(
  sessionName: string = WA_SESSION_ID,
): Promise<{ ok: boolean; error?: string }> {
  if (!waConfigured()) return { ok: false, error: "WA_API_URL غير مهيأ" };
  try {
    const uuid = await findSessionUuid(sessionName);
    if (!uuid) return { ok: true }; // nothing to log out
    const { ok, status } = await call(`/api/sessions/${uuid}/logout`, { method: "POST" });
    sessionUuidCache.delete(sessionName); // forget so next call re-resolves
    return ok || status === 404 ? { ok: true } : { ok: false, error: `HTTP ${status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface WaHistoryMessage {
  id: string;
  from: string | null;
  senderName: string | null;
  body: string;
  type: string;
  timestamp: number; // unix seconds
  fromMe: boolean;
  media?: {
    dataBase64: string;
    mimeType: string;
    filename: string | null;
    sizeBytes: number | null;
  } | null;
}

export interface WaContactIdentity {
  aliases: string[];
  phoneJid: string | null;
  name: string | null;
}

function historyContactId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  const obj = historyObj(value);
  if (!obj) return null;
  const direct = historyString(obj._serialized, obj.serialized, obj.id, obj.phoneNumber, obj.phone);
  if (direct) return direct;
  const user = historyString(obj.user);
  const server = historyString(obj.server);
  return user && server ? `${user}@${server}` : null;
}

// Resolve modern opaque @lid participant IDs to their phone JIDs. The custom
// gateway exposes the underlying OpenWA getAllContacts() result at /contacts;
// callers tolerate an unavailable/disconnected session by receiving [].
export async function fetchSessionContacts(
  sessionName: string = WA_SESSION_ID,
): Promise<WaContactIdentity[]> {
  if (!waConfigured()) return [];
  const uuid = await findSessionUuid(sessionName);
  if (!uuid) return [];
  const { ok, json } = await call(`/api/sessions/${uuid}/contacts`, { timeoutMs: 90_000 });
  if (!ok || !json) return [];
  const list = Array.isArray(json)
    ? json
    : ((json as { data?: unknown; contacts?: unknown }).data ??
      (json as { contacts?: unknown }).contacts ??
      []);
  if (!Array.isArray(list)) return [];
  const out: WaContactIdentity[] = [];
  for (const raw of list as Array<Record<string, unknown>>) {
    const idObj = historyObj(raw.id);
    const candidates = [
      historyContactId(raw.id),
      historyContactId(raw.lid),
      historyContactId(raw.lidId),
      historyContactId(raw.phoneNumber),
      historyContactId(raw.phone),
      historyContactId(idObj?._serialized),
    ].filter((value): value is string => Boolean(value));
    const aliases = [...new Set(candidates)];
    if (aliases.length === 0) continue;
    const explicitPhone = historyString(raw.phoneNumber, raw.phone);
    const phoneJid =
      aliases.find((value) => /@(?:c\.us|s\.whatsapp\.net)$/i.test(value)) ??
      (explicitPhone
        ? `${explicitPhone.replace(/\D/g, "")}@c.us`
        : null);
    out.push({
      aliases,
      phoneJid,
      name: historyString(raw.pushname, raw.pushName, raw.formattedName, raw.name),
    });
  }
  return out;
}

function historyObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function historyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function historyNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return null;
}

function historyMedia(m: Record<string, unknown>): WaHistoryMessage["media"] {
  const media = historyObj(m.media) ?? historyObj(m.mediaData) ?? historyObj(m._data);
  const data = historyString(m.data, m.fileData, media?.data, media?.body, media?.fileData);
  if (!data) return null;
  const comma = data.indexOf(",");
  return {
    dataBase64: (comma >= 0 ? data.slice(comma + 1) : data).replace(/\s+/g, ""),
    mimeType:
      historyString(m.mimetype, m.mimeType, media?.mimetype, media?.mimeType) ??
      "application/octet-stream",
    filename: historyString(m.filename, m.fileName, media?.filename, media?.fileName),
    sizeBytes: historyNumber(m.size, m.filesize, m.fileSize, media?.size, media?.fileSize),
  };
}

// Fetch historical messages for a chat from the WhatsApp-Web store via the
// custom gateway endpoint (added to OpenWA: GET /groups/:chatId/messages).
// Returns up to `limit` messages (the store caps at whatever WA synced).
export async function fetchChatHistory(
  chatId: string,
  limit = 1000,
  sessionName: string = WA_SESSION_ID,
): Promise<WaHistoryMessage[]> {
  if (!waConfigured()) return [];
  const uuid = await findSessionUuid(sessionName);
  if (!uuid) return [];
  const { ok, json } = await call(
    `/api/sessions/${uuid}/groups/${chatId}/messages?limit=${limit}`,
    { timeoutMs: 90000 },
  );
  if (!ok || !json) return [];
  const arr = (json as { messages?: unknown }).messages;
  if (!Array.isArray(arr)) return [];
  return (arr as Array<Record<string, unknown>>)
    .map((m) => {
      const sender = historyObj(m.sender) ?? historyObj(m.contact);
      const preferredContactId =
        historyContactId(sender?.phoneNumber) ??
        historyContactId(sender?.phone) ??
        historyContactId(sender?.id);
      return {
        id: String(m.id ?? ""),
        from:
          (preferredContactId && !preferredContactId.endsWith("@lid")
            ? preferredContactId
            : null) ??
          historyContactId(m.author) ??
          historyContactId(m.participant) ??
          historyContactId(m.from) ??
          preferredContactId,
        senderName: historyString(
          sender?.pushname,
          sender?.pushName,
          sender?.formattedName,
          sender?.name,
          m.notifyName,
        ),
        body: typeof m.body === "string" ? m.body : "",
        type: String(m.type ?? "chat"),
        timestamp: Number(m.timestamp ?? 0),
        fromMe: m.fromMe === true,
        media: historyMedia(m),
      };
    })
    .filter((m) => m.id);
}

export interface WaRemoteGroup {
  id: string;
  name: string | null;
}

export async function listGroups(sessionName: string = WA_SESSION_ID): Promise<WaRemoteGroup[]> {
  if (!waConfigured()) return [];
  const uuid = await findSessionUuid(sessionName);
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

// Is the session's WhatsApp-Web store actually usable, or only *nominally*
// connected? Two real failures on 2026-07-20 both reported healthy by status +
// lastActive, and neither delivered a single message:
//   • the primary HUNG — /groups never returns (504 after 90s);
//   • the second answered fast with HTTP 500 and could not list a single group,
//     returning 0 history for a chat it had previously served — an empty store,
//     while still emitting session.status heartbeats that keep lastActive fresh.
// So health checks must PROBE the store, not just read the status field.
// `ok:false` means: connected on paper, useless in practice.
export async function probeSessionStore(
  uuid: string,
  timeoutMs = 12_000,
): Promise<{ ok: boolean; groups: number; detail: string }> {
  try {
    const { ok, status, json } = await call(`/api/sessions/${uuid}/groups`, { timeoutMs });
    if (!ok) return { ok: false, groups: 0, detail: `groups HTTP ${status}` };
    const list = Array.isArray(json)
      ? json
      : ((json as { data?: unknown }).data ?? (json as { groups?: unknown }).groups ?? []);
    const groups = Array.isArray(list) ? list.length : 0;
    return { ok: groups > 0, groups, detail: groups > 0 ? "ok" : "store empty (0 groups)" };
  } catch (e) {
    // Abort/timeout — the wedged case.
    return { ok: false, groups: 0, detail: `groups unreachable: ${(e as Error).message}` };
  }
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

// ---- Outbound sends (CEO brief) ------------------------------------------
// OpenWA send endpoints (docs/06-api-specification.md in the gateway repo):
//   POST /api/sessions/:uuid/messages/send-text  { chatId, text }
//   POST /api/sessions/:uuid/messages/send-image { chatId, image: { base64 }, caption? }
// chatId for a person is `<digits>@c.us` (country code, no + or spaces).
// Gateway rate limit: 60 req/min — callers should pace multi-image sends.

export function phoneToChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@c.us`;
}

export interface WaSendResult {
  ok: boolean;
  messageId: string | null;
  error?: string;
}

function parseSendResult(ok: boolean, status: number, json: unknown): WaSendResult {
  if (!ok) {
    const msg = (json as { message?: unknown })?.message;
    return { ok: false, messageId: null, error: `http ${status}: ${typeof msg === "string" ? msg : "send failed"}` };
  }
  const data = (json as { data?: Record<string, unknown> })?.data ?? (json as Record<string, unknown>);
  const id = data?.messageId ?? data?.id;
  return { ok: true, messageId: typeof id === "string" ? id : null };
}

export async function sendText(chatId: string, text: string): Promise<WaSendResult> {
  if (!waConfigured()) return { ok: false, messageId: null, error: "gateway not configured" };
  const uuid = await findSessionUuid();
  if (!uuid) return { ok: false, messageId: null, error: "session not found" };
  const { ok, status, json } = await call(`/api/sessions/${uuid}/messages/send-text`, {
    method: "POST",
    body: JSON.stringify({ chatId, text }),
    timeoutMs: 30000,
  });
  return parseSendResult(ok, status, json);
}

// URL mode only: the gateway 413s on bodies over ~100KB (base64 PNGs) and
// its accepted shape is a TOP-LEVEL url field — { chatId, url, caption? }.
// An object-style { image: { url } } body fails validation with a bare 400.
export async function sendImage(
  chatId: string,
  image: { url: string },
  caption?: string,
): Promise<WaSendResult> {
  if (!waConfigured()) return { ok: false, messageId: null, error: "gateway not configured" };
  const uuid = await findSessionUuid();
  if (!uuid) return { ok: false, messageId: null, error: "session not found" };
  const { ok, status, json } = await call(`/api/sessions/${uuid}/messages/send-image`, {
    method: "POST",
    body: JSON.stringify({
      chatId,
      url: image.url,
      ...(caption ? { caption } : {}),
    }),
    timeoutMs: 90000,
  });
  return parseSendResult(ok, status, json);
}
