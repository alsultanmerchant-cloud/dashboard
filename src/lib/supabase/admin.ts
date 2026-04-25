import { createClient } from "@supabase/supabase-js";

// Admin client with service role key — SERVER-SIDE ONLY
// Never import this file in client components
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
