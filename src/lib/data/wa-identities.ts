import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Resolved WhatsApp identities (real phone JIDs) that post in the agency's
// client groups, aggregated by the wa_resolved_identities RPC (migration 0253).
// Powers the "واتساب" column + linker on /organization/employees, which fills
// employee_profiles.phone so the satisfaction tagger attributes staff messages
// correctly. See memory: project_wa_sender_identity_lid.

export interface WaIdentity {
  phoneJid: string; // 966…@c.us
  phone: string; // canonical last-9 (Saudi) or trailing digits — for matching
  displayDigits: string; // full digits, for display / storage as +<digits>
  displayName: string | null;
  messageCount: number;
  groupCount: number;
}

// Canonicalise a phone/JID the way the satisfaction tagger does: strip the JID
// suffix + non-digits, drop 00 IDD, and reduce Saudi mobiles to their final 9
// digits so +966 5…, 00966…, 05… and 9665…@c.us all compare equal. Kept inline
// (not imported from satisfaction.ts) so this stays decoupled from that module.
export function canonicalWaPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/@.*$/, "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^05\d{8}$/.test(digits)) return digits.slice(1);
  if (/^9665\d{8}$/.test(digits)) return digits.slice(3);
  return digits.length >= 7 ? digits : null;
}

export function fullDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/@.*$/, "").replace(/\D/g, "");
}

export async function listResolvedWaIdentities(orgId: string): Promise<WaIdentity[]> {
  const { data, error } = await supabaseAdmin.rpc("wa_resolved_identities", {
    p_org: orgId,
  });
  if (error || !data) return [];
  const out: WaIdentity[] = [];
  for (const r of data as Array<{
    phone_jid: string;
    display_name: string | null;
    message_count: number;
    group_count: number;
  }>) {
    const phone = canonicalWaPhone(r.phone_jid);
    if (!phone) continue;
    out.push({
      phoneJid: r.phone_jid,
      phone,
      displayDigits: fullDigits(r.phone_jid),
      displayName: r.display_name ?? null,
      messageCount: Number(r.message_count) || 0,
      groupCount: Number(r.group_count) || 0,
    });
  }
  // Most active first — account managers (many groups / messages) surface atop
  // the picker; single-group numbers (usually clients) sink.
  out.sort((a, b) => b.groupCount - a.groupCount || b.messageCount - a.messageCount);
  return out;
}
