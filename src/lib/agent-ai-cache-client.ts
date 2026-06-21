// Client-side helpers for the agent AI cache. Cards call saveAgentAi() in their
// useObject onFinish to persist the freshly streamed result; formatAgo()
// renders the "updated X ago" stamp shown next to the re-analyse button.

export type AgentAiKind = "growth_coach" | "tech_tip" | "today_priorities";

export function saveAgentAi(kind: AgentAiKind, payload: unknown): void {
  // Fire-and-forget — persistence must never block or break the UI.
  void fetch("/api/agent-ai-cache", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, payload }),
  }).catch(() => {});
}

/** Compact, locale-aware "x ago" for a stored timestamp (or "" when absent). */
export function formatAgo(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar" : "en", { numeric: "auto" });
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 60) return rtf.format(-mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  return rtf.format(-days, "day");
}
