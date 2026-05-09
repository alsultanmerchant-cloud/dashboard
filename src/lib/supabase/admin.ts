import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Admin client with service role key — SERVER-SIDE ONLY
// Never import this file in client components.
//
// Lazy: created on first use, not at module load. This keeps a missing
// SUPABASE_SERVICE_ROLE_KEY from crashing every route that transitively
// imports this module (e.g. via auth-server) — instead the failure surfaces
// as a clear thrown error from the call site, with a message pointing at
// the missing env var.

let cached: SupabaseClient | null = null;

function build(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      `supabaseAdmin: missing env vars (url=${!!url}, serviceRoleKey=${!!key}). Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this environment.`,
    );
  }
  return createClient(url, key);
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!cached) cached = build();
    return Reflect.get(cached, prop, cached);
  },
});
