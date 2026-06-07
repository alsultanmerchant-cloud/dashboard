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
          events: ["message"],
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
