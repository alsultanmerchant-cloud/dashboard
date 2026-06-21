// Shared Arabic-aware client name matcher. Used by both the merge page
// (to show suggestions) and the bulk-merge action (to apply them), so the
// score the team sees is exactly the score the bulk merge uses — no drift.

// Arabic combining marks only — harakat/tanwin/shadda/sukun (U+064B–U+0652),
// superscript alef (U+0670) and Quranic annotation marks (U+06D6–U+06ED).
// IMPORTANT: must NOT reach into the base-letter block (U+0621–U+064A) — an
// earlier range (U+0610–U+064B) swallowed the whole alphabet, making normName
// return "" for any pure-Arabic name.
const AR_DIAC = /[ً-ْٰۖ-ۭ]/g;

export function normName(s: string): string {
  let x = (s || "").trim().toLowerCase();
  x = x.replace(AR_DIAC, "").replace(/ـ/g, "");
  x = x.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  x = x.replace(/\(.*?\)/g, "").replace(/\s*[-–]\s*.*$/g, "");
  return x.replace(/[^\w\s؀-ۿ]/g, " ").replace(/\s+/g, " ").trim();
}

export function latinTokens(s: string): Set<string> {
  return new Set(
    (s.match(/[A-Za-z][A-Za-z0-9 .&\-]{2,}/g) ?? []).map((t) => t.trim().toLowerCase()),
  );
}

// Dice coefficient over character bigrams.
export function diceRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const big = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const A = big(a), B = big(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size || 1);
}

// ── cross-script (Arabic ↔ Latin) consonant-skeleton matching ──────────────
// The sheet (accounting) names a client in Arabic while Odoo (delivery) often
// names the SAME company in Latin transliteration — e.g. «نقوة الخليج» ↔ «Nuqa».
// Plain Dice can't see this (different scripts → zero bigram overlap). Arabic
// omits short vowels, so we reduce BOTH names to a strong-consonant skeleton
// (transliterate Arabic consonants, then strip vowels + weak letters from the
// Latin side) and compare those. نقوة→"nq", Nuqa→"nq" → match.
const AR_CONSONANT: Record<string, string> = {
  ب: "b", ت: "t", ث: "t", ج: "j", ح: "h", خ: "k", د: "d", ذ: "d", ر: "r",
  ز: "z", س: "s", ش: "s", ص: "s", ض: "d", ط: "t", ظ: "z", غ: "g", ف: "f",
  ق: "q", ك: "k", ل: "l", م: "m", ن: "n", پ: "p", چ: "c", ڤ: "v", گ: "g",
};

export function consonantSkeleton(s: string): string {
  let out = "";
  for (const ch of (s || "").toLowerCase()) {
    if (AR_CONSONANT[ch] !== undefined) out += AR_CONSONANT[ch];
    else if (ch >= "a" && ch <= "z") out += ch;
    // everything else (spaces, digits, Arabic vowels/weak letters: ا و ي ى ه
    // ة ء ع, punctuation) is dropped — it carries little identifying signal.
  }
  // Strip Latin vowels + weak consonants so transliteration variance cancels.
  return out.replace(/[aeiouyhw]/g, "");
}

// Skeleton agreement → a capped score. Capped BELOW the latin-exact tier (0.95)
// so a genuine shared Latin token always outranks a mere cross-script guess,
// and so these never reach "certain". Skeletons under 3 chars (e.g. «رنا»→"rn")
// are too collision-prone to trust — many unrelated names reduce to the same
// 2-letter stub — so we ignore them entirely.
function skeletonScore(aSkel: string, bSkel: string): number {
  if (aSkel.length < 3 || bSkel.length < 3) return 0;
  if (aSkel === bSkel) return 0.9;
  return diceRatio(aSkel, bSkel) * 0.85;
}

// `aliases` are extra names that identify the SAME company through a different
// surface — for an Odoo (delivery) client its PROJECT names, for a sheet
// (accounting) client its WhatsApp GROUP names. The two populations often share
// no client-name resemblance (e.g. «ايلاف التويجري» ↔ «ليب لوستر-فضية») while
// the brand «lip luster» only appears in the project/group name. Matching the
// alias sets recovers those splits. See [[project_clients_centralization]].
export type MatchClient = { id: string; name: string; aliases?: string[] };

// Catch-all placeholder clients that must NEVER be a merge target — merging a
// real client into "unspecified client" would make the placeholder canonical
// and silently absorb unrelated projects/groups.
const PLACEHOLDER_NAMES = new Set([
  "عميل غير محدد",
  "غير محدد",
  "unspecified",
  "unspecified client",
]);
export function isPlaceholderClient(name: string | null | undefined): boolean {
  return PLACEHOLDER_NAMES.has((name ?? "").trim().toLowerCase());
}

type Tok = { n: string; l: Set<string>; sk: string };
function tok(s: string): Tok {
  return { n: normName(s), l: latinTokens(s), sk: consonantSkeleton(s) };
}
function pairScore(a: Tok, b: Tok): number {
  let score = diceRatio(a.n, b.n);
  for (const l of a.l) if (b.l.has(l)) score = Math.max(score, 0.95);
  score = Math.max(score, skeletonScore(a.sk, b.sk));
  return score;
}

// Returns the best + second-best Odoo match for one sheet client, so callers
// can require an unambiguous lead before auto-merging. Each side is scored as
// its name PLUS its aliases (project/group names); the pair's score is the best
// agreement across that cross-product, so a brand shared only via the project↔
// group name still surfaces the match.
export function bestClientMatch(
  sheet: { name: string; aliases?: string[] },
  odoo: MatchClient[],
): { best: { client: MatchClient; score: number } | null; secondScore: number } {
  const sheetToks = [sheet.name, ...(sheet.aliases ?? [])].map(tok);
  let best: { client: MatchClient; score: number } | null = null;
  let second = 0;
  for (const o of odoo) {
    const odooToks = [o.name, ...(o.aliases ?? [])].map(tok);
    let score = 0;
    for (const st of sheetToks) for (const ot of odooToks) {
      const s = pairScore(st, ot);
      if (s > score) score = s;
    }
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { client: o, score };
    } else if (score > second) {
      second = score;
    }
  }
  return { best, secondScore: second };
}
