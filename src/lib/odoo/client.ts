// Minimal typed Odoo JSON-RPC client.
// Talks to /jsonrpc using the `call` method against the `object` service,
// which lets us invoke any model method via execute_kw — the same surface
// the official Odoo XML-RPC docs describe, but JSON.

const JSONRPC_PATH = "/jsonrpc";

export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  // Either an Odoo password or an API key from /odoo/my/security.
  password: string;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: { name?: string; debug?: string; message?: string };
  };
}

export class OdooError extends Error {
  constructor(message: string, public readonly debug?: string) {
    super(message);
    this.name = "OdooError";
  }
}

async function jsonrpc<T>(url: string, params: unknown): Promise<T> {
  const res = await fetch(url + JSONRPC_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params,
      id: Date.now(),
    }),
  });
  if (!res.ok) throw new OdooError(`Odoo HTTP ${res.status}`);
  const body = (await res.json()) as JsonRpcResponse<T>;
  if (body.error) {
    const msg = body.error.data?.message || body.error.message;
    throw new OdooError(msg, body.error.data?.debug);
  }
  return body.result as T;
}

export class OdooClient {
  private uid: number | null = null;
  constructor(private cfg: OdooConfig) {}

  /** Authenticate once; cache the uid for subsequent execute_kw calls. */
  async authenticate(): Promise<number> {
    if (this.uid !== null) return this.uid;
    const uid = await jsonrpc<number | false>(this.cfg.url, {
      service: "common",
      method: "authenticate",
      args: [this.cfg.db, this.cfg.username, this.cfg.password, {}],
    });
    if (!uid) throw new OdooError("Odoo authentication failed");
    this.uid = uid;
    return uid;
  }

  /** Generic typed wrapper around model.method(args, kwargs). */
  async executeKw<T>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {},
  ): Promise<T> {
    const uid = await this.authenticate();
    return jsonrpc<T>(this.cfg.url, {
      service: "object",
      method: "execute_kw",
      args: [this.cfg.db, uid, this.cfg.password, model, method, args, kwargs],
    });
  }

  /** search_read shorthand. */
  searchRead<T>(
    model: string,
    domain: unknown[] = [],
    fields: string[] = [],
    opts: { limit?: number; offset?: number; order?: string } = {},
  ): Promise<T[]> {
    return this.executeKw<T[]>(model, "search_read", [domain], {
      fields,
      ...opts,
    });
  }

  /** read shorthand for a known list of ids. */
  read<T>(model: string, ids: number[], fields: string[] = []): Promise<T[]> {
    return this.executeKw<T[]>(model, "read", [ids], { fields });
  }
}

export function odooFromEnv(): OdooClient {
  const required = ["ODOO_URL", "ODOO_DB", "ODOO_USERNAME", "ODOO_PASSWORD"] as const;
  for (const key of required) {
    if (!process.env[key]) throw new OdooError(`Missing env: ${key}`);
  }
  return new OdooClient({
    url: process.env.ODOO_URL!.replace(/\/$/, ""),
    db: process.env.ODOO_DB!,
    username: process.env.ODOO_USERNAME!,
    password: process.env.ODOO_PASSWORD!,
  });
}
