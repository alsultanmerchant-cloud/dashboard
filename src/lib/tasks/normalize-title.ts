// Canonical Arabic title normalisation used to match Odoo tasks to template
// items. Odoo generates a task by copying the template item's name verbatim,
// then humans edit it (week numbers, emoji, spelling, alef/hamza variants), so
// matching strips exactly those degrees of freedom:
//   - NFKC unify, lowercase, collapse whitespace
//   - drop emoji / keycaps
//   - fold alef/hamza/ya/ta-marbuta variants
//   - strip diacritics + tatweel
//   - strip digits (latin + arabic-indic) — week/sequence numbers are noise
// Keep this the SINGLE source of truth; the matcher and any backfill/probe must
// import it so their keys are identical.

const ALEF: Record<string, string> = {
  "ى": "ي",
  "ئ": "ي",
  "إ": "ا",
  "أ": "ا",
  "آ": "ا",
  "ة": "ه",
  "ي": "ي",
};

export function normalizeTitle(s: string | null | undefined): string {
  if (!s) return "";
  let t = s.normalize("NFKC");
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}️⃣]/gu, ""); // emoji/keycaps
  t = t.replace(/[ىئإأآةي]/g, (c) => ALEF[c] ?? c);
  t = t.replace(/[ً-ْـ]/g, ""); // diacritics + tatweel
  t = t.replace(/[0-9٠-٩]/g, ""); // latin + arabic digits
  return t.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Word-token set for fuzzy (token-set Jaccard) matching. */
export function titleTokens(norm: string): Set<string> {
  return new Set(norm.split(" ").filter((w) => w.length > 1));
}

/** Jaccard similarity over two token sets (0..1). */
export function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}
