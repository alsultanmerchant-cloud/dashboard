import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MENTION_RE = /@([\p{L}\p{N}_]+)/gu;

/** Extract @tokens from a comment body. Returns unique lower-cased tokens. */
export function extractMentions(body: string): string[] {
  const tokens = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) {
    if (match[1]) tokens.add(match[1]);
  }
  return Array.from(tokens);
}

/**
 * Resolve @tokens to org employees. Match strategy: full_name ILIKE 'token%'
 * (prefix match), then full ILIKE '%token%'. First match per token wins.
 */
export async function resolveMentions(args: {
  organizationId: string;
  tokens: string[];
}): Promise<{ employeeId: string; userId: string | null; fullName: string }[]> {
  if (args.tokens.length === 0) return [];

  const { data: employees } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, user_id, full_name")
    .eq("organization_id", args.organizationId);
  if (!employees) return [];

  const resolved: { employeeId: string; userId: string | null; fullName: string }[] = [];
  const seen = new Set<string>();

  for (const token of args.tokens) {
    const t = token.toLowerCase();
    const match =
      employees.find((e) => e.full_name.toLowerCase().startsWith(t)) ??
      employees.find((e) => e.full_name.toLowerCase().includes(t));
    if (match && !seen.has(match.id)) {
      seen.add(match.id);
      resolved.push({
        employeeId: match.id,
        userId: match.user_id,
        fullName: match.full_name,
      });
    }
  }
  return resolved;
}
