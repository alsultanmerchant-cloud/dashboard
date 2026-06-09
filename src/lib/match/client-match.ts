// Shared Arabic-aware client name matcher. Used by both the merge page
// (to show suggestions) and the bulk-merge action (to apply them), so the
// score the team sees is exactly the score the bulk merge uses — no drift.

const AR_DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

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

export type MatchClient = { id: string; name: string };

// Returns the best + second-best Odoo match for one sheet client, so callers
// can require an unambiguous lead before auto-merging.
export function bestClientMatch(
  sheet: { name: string },
  odoo: MatchClient[],
): { best: { client: MatchClient; score: number } | null; secondScore: number } {
  const sn = normName(sheet.name);
  const sl = latinTokens(sheet.name);
  let best: { client: MatchClient; score: number } | null = null;
  let second = 0;
  for (const o of odoo) {
    let score = diceRatio(sn, normName(o.name));
    const ol = latinTokens(o.name);
    for (const l of sl) if (ol.has(l)) score = Math.max(score, 0.95);
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { client: o, score };
    } else if (score > second) {
      second = score;
    }
  }
  return { best, secondScore: second };
}
