import "server-only";

// Name-based matching of WhatsApp groups → clients/projects.
// Group subjects look like "إدارة مشروع | radiology 💫", "ادارة نشاط | 💫 كوكتيل مزة",
// "Cozy Baby 📍" — the meaningful token is the CLIENT name. Projects are named
// "<client> - <service> <duration>", so a group resolves to a client and, since
// almost every client has a single project, to that client's project too.

export interface ClientRef {
  id: string;
  name: string;
}
export interface ProjectRef {
  id: string;
  name: string;
  clientId: string | null;
  status?: string | null;
}

export type MatchConfidence = "exact" | "high" | "low";
export type GroupKind = "client" | "technical";

export interface GroupMatch {
  chatId: string;
  chatName: string | null;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
  groupKind: GroupKind | null;
  confidence: MatchConfidence | null;
}

// Agency naming convention (confirmed by ops): every CLIENT-facing group name
// carries 💫, every INTERNAL team group carries 📍. They are mutually exclusive.
// Org-level groups (leads, renewals, complaints…) carry neither → unclassified.
const STAR = "\u{1F4AB}"; // 💫
const PIN = "\u{1F4CD}"; // 📍
export function detectGroupKind(name: string | null | undefined): GroupKind | null {
  if (!name) return null;
  const hasStar = name.includes(STAR);
  const hasPin = name.includes(PIN);
  if (hasStar && !hasPin) return "client";
  if (hasPin && !hasStar) return "technical";
  return null;
}

const AR_DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
// Boilerplate prefixes/labels stripped before comparing to a client name.
const PREFIXES = [
  "إدارة مشروع",
  "ادارة مشروع",
  "اداره مشروع",
  "إدارة نشاط",
  "ادارة نشاط",
  "اداره نشاط",
  "إدارة التسويق",
  "ادارة التسويق",
  "access group",
  "ideal solution",
  "إدارة",
  "ادارة",
];

export function normalizeName(s: string | null | undefined): string {
  if (!s) return "";
  let out = s.normalize("NFKC");
  // strip emoji / symbols (rough: anything outside common scripts/punctuation)
  out = out.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‏‎]/gu, " ");
  out = out.replace(AR_DIAC, "");
  out = out
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
  out = out.toLowerCase();
  out = out.replace(/[|/\\\-–—•:.,()\[\]💫📍]/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

function coreToken(groupName: string): string {
  let n = normalizeName(groupName);
  for (const p of PREFIXES.map(normalizeName)) {
    if (!p) continue;
    n = n.split(p).join(" ");
  }
  return n.replace(/\s+/g, " ").trim();
}

interface ScoredClient {
  score: number;
  confidence: MatchConfidence;
  client: ClientRef;
}

function scoreClient(gcore: string, clients: { ref: ClientRef; norm: string }[]): ScoredClient | null {
  if (!gcore) return null;
  let best: ScoredClient | null = null;
  for (const { ref, norm } of clients) {
    if (!norm) continue;
    let score = 0;
    let conf: MatchConfidence = "low";
    if (norm === gcore) {
      score = 100;
      conf = "exact";
    } else if (gcore.includes(norm) || norm.includes(gcore)) {
      // containment — strong when lengths are close
      const diff = Math.abs(norm.length - gcore.length);
      score = 85 - diff;
      conf = diff <= 3 ? "exact" : "high";
    } else {
      const gt = new Set(gcore.split(" ").filter(Boolean));
      const ct = new Set(norm.split(" ").filter(Boolean));
      const overlap = [...gt].filter((w) => ct.has(w)).length;
      const minLen = Math.min(gt.size, ct.size);
      if (overlap > 0 && overlap >= minLen) {
        score = 50 + overlap;
        conf = overlap >= 2 ? "high" : "low";
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { score, confidence: conf, client: ref };
  }
  return best;
}

/**
 * Match groups to client + project by name.
 * Project = the matched client's project (prefers active; if exactly one project
 * overall, uses it). Returns null project when the client has 0 or >1 candidate
 * projects so the result stays unambiguous.
 */
export function matchGroups(
  groups: { id: string; name: string | null }[],
  clients: ClientRef[],
  projects: ProjectRef[],
): GroupMatch[] {
  const clientsN = clients.map((c) => ({ ref: c, norm: normalizeName(c.name) }));
  const byClient = new Map<string, ProjectRef[]>();
  for (const p of projects) {
    if (!p.clientId) continue;
    const arr = byClient.get(p.clientId) ?? [];
    arr.push(p);
    byClient.set(p.clientId, arr);
  }

  return groups
    .filter((g) => g.id.endsWith("@g.us"))
    .map((g) => {
      const groupKind = detectGroupKind(g.name);
      const sc = scoreClient(coreToken(g.name ?? ""), clientsN);
      if (!sc) {
        return {
          chatId: g.id,
          chatName: g.name,
          clientId: null,
          clientName: null,
          projectId: null,
          projectName: null,
          groupKind,
          confidence: null,
        };
      }
      // pick the client's project: prefer the single active one, else the only one
      const projs = byClient.get(sc.client.id) ?? [];
      const active = projs.filter((p) => p.status === "active");
      let chosen: ProjectRef | null = null;
      if (active.length === 1) chosen = active[0];
      else if (projs.length === 1) chosen = projs[0];
      return {
        chatId: g.id,
        chatName: g.name,
        clientId: sc.client.id,
        clientName: sc.client.name,
        projectId: chosen?.id ?? null,
        projectName: chosen?.name ?? null,
        groupKind,
        confidence: sc.confidence,
      };
    });
}
