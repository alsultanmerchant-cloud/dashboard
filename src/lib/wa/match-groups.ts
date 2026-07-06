import "server-only";

// Name-based matching of WhatsApp groups → clients/projects.
// Group subjects look like "إدارة مشروع | radiology 💫", "ادارة نشاط | 💫 كوكتيل مزة",
// "Cozy Baby 📍" — the meaningful token is the CLIENT name. Projects are named
// "<client> - <service> <duration>", so a group resolves to a client and, since
// almost every client has a single project, to that client's project too.

export interface ClientRef {
  id: string;
  name: string;
  // Extra names the same client is known by — contract sheet names (source of
  // truth), brand variants, etc. A group matches the client when its token hits
  // the primary name OR any alias, so a group subject that carries the contract
  // name still resolves. See [[project_client_display_name_resolver]].
  aliases?: string[];
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

// Score a single group-core token against one normalized client name.
function scoreOne(gcore: string, norm: string): { score: number; conf: MatchConfidence } | null {
  if (!gcore || !norm) return null;
  if (norm === gcore) return { score: 100, conf: "exact" };

  if (gcore.includes(norm) || norm.includes(gcore)) {
    const shorterText = norm.length <= gcore.length ? norm : gcore;
    const shorter = Math.min(norm.length, gcore.length);
    const longer = Math.max(norm.length, gcore.length);
    const coverage = shorter / longer; // how much of the longer string is covered
    const shorterTokens = shorterText.split(" ").filter(Boolean);
    // Contract sheet names often append the service/package to the brand
    // ("Home Nest - نوفا", "كوكتيل مزة - تصوير منتجات"). If the whole group
    // core is a meaningful multi-token brand inside that contract name, keep it
    // linkable even though the coverage ratio is low.
    if (shorter >= 6 && shorterTokens.length >= 2) {
      return { score: 78 + Math.round(Math.min(coverage, 1) * 10), conf: "high" };
    }
    // Guard against short-token false positives — a 2–3 char client name (or a
    // tiny shared fragment) swallowed by a longer group subject must NOT score
    // as a confident link. This was the main source of WRONG auto-links.
    if (shorter < 4 || coverage < 0.6) {
      return { score: Math.round(40 * coverage), conf: "low" };
    }
    const conf: MatchConfidence = coverage >= 0.85 ? "exact" : "high";
    return { score: 70 + Math.round(coverage * 15), conf };
  }

  // Token overlap — require the smaller side to be fully covered.
  const gt = new Set(gcore.split(" ").filter(Boolean));
  const ct = new Set(norm.split(" ").filter(Boolean));
  const overlap = [...gt].filter((w) => ct.has(w)).length;
  if (overlap === 0) return null;
  const minLen = Math.min(gt.size, ct.size);
  if (overlap < minLen) return null;
  return { score: 50 + overlap, conf: overlap >= 2 ? "high" : "low" };
}

function scoreClient(gcore: string, clients: { ref: ClientRef; norms: string[] }[]): ScoredClient | null {
  if (!gcore) return null;
  const scored: ScoredClient[] = [];
  for (const { ref, norms } of clients) {
    // Best score across the client's names (primary + aliases) — a group need
    // only match one of them (e.g. its contract name) to link.
    let best: { score: number; conf: MatchConfidence } | null = null;
    for (const norm of norms) {
      const s = scoreOne(gcore, norm);
      if (s && (!best || s.score > best.score)) best = s;
    }
    if (best && best.score > 0) scored.push({ score: best.score, confidence: best.conf, client: ref });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runner = scored[1];

  // Ambiguity guard: if two different clients both match at a linkable
  // confidence and are nearly tied, it's not safe to auto-pick one — downgrade
  // to "low" so the auto-linker leaves it for a human.
  const linkable = (c: MatchConfidence) => c === "exact" || c === "high";
  if (runner && linkable(best.confidence) && linkable(runner.confidence) && best.score - runner.score < 8) {
    return { ...best, confidence: "low" };
  }
  return best;
}

function scoreProject(gcore: string, norm: string): { score: number; conf: MatchConfidence } | null {
  if (!gcore || !norm) return null;
  const gt = new Set(gcore.split(" ").filter(Boolean));
  const pt = new Set(norm.split(" ").filter(Boolean));
  if (gt.size === 0 || pt.size === 0) return null;
  const overlap = [...gt].filter((w) => pt.has(w)).length;
  if (overlap !== gt.size) return null;
  return {
    score: 60 + overlap * 5,
    conf: gt.size >= 2 ? "high" : "low",
  };
}

function pickProjectByGroupName(gcore: string, projects: ProjectRef[]): ProjectRef | null {
  const scorePool = (pool: ProjectRef[]) => {
    const scored = pool
      .map((project) => {
        const score = scoreProject(gcore, normalizeName(project.name));
        return score ? { project, ...score } : null;
      })
      .filter((p): p is { project: ProjectRef; score: number; conf: MatchConfidence } => p !== null)
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.conf === "low") return null;
    const runner = scored[1];
    if (runner && runner.conf !== "low" && best.score - runner.score < 8) return null;
    return best.project;
  };

  return (
    scorePool(projects.filter((p) => p.status === "active")) ??
    scorePool(projects)
  );
}

/**
 * Match groups to client + project by name.
 * Project = the matched client's project (prefers active; if exactly one project
 * overall, uses it). If the client comes from the contract side and the Odoo
 * project still lives on a separate client row, fall back to a single strong
 * project-name match. Returns null project when candidates are ambiguous.
 */
export function matchGroups(
  groups: { id: string; name: string | null }[],
  clients: ClientRef[],
  projects: ProjectRef[],
): GroupMatch[] {
  const clientsN = clients.map((c) => {
    // Dedup the normalized primary name + aliases; drop empties.
    const norms = Array.from(
      new Set([c.name, ...(c.aliases ?? [])].map(normalizeName).filter(Boolean)),
    );
    return { ref: c, norms };
  });
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
      const gcore = coreToken(g.name ?? "");
      const sc = scoreClient(gcore, clientsN);
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
      else chosen = pickProjectByGroupName(gcore, projects);
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
