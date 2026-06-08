import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Locate and fetch a client's BRIEF document so satisfaction analysis can score
// brief-adherence against the client's DOCUMENTED requirements (a Google Doc
// linked to the Brief task / project documents) instead of inferring it from
// the internal WhatsApp chat. The brief lives in the project's "all documents"
// (project_attachments + task_attachments), usually a file named "البريف".
//
// Only Google Docs (docs.google.com/document) are text-extractable here, and
// only when shared as "anyone with the link". Restricted docs, Drive files, and
// folders return null → callers degrade gracefully.

export interface ClientBrief {
  source: "project" | "task";
  filename: string;
  url: string;
  text: string;
}

const MAX_BRIEF_CHARS = 15_000;

export function extractGoogleDocId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Fetch the plain-text export of a public Google Doc. Returns null for
// restricted docs (Google serves the sign-in HTML page instead of text).
export async function fetchGoogleDocText(docId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; RawasmBot/1.0)" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (
      contentType.includes("text/html") ||
      /accounts\.google\.com|ServiceLogin|Sign in|Request access/i.test(text.slice(0, 2000))
    ) {
      return null;
    }
    const clean = text.replace(/﻿/g, "").trim();
    return clean.length > 0 ? clean.slice(0, MAX_BRIEF_CHARS) : null;
  } catch {
    return null;
  }
}

const BRIEF_FILTER = "filename.ilike.%بريف%,filename.ilike.%brief%";

export async function getClientBrief(
  orgId: string,
  clientId: string,
): Promise<ClientBrief | null> {
  // The client's live (non-archived) projects.
  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .neq("status", "archived");
  const projectIds = (projects ?? []).map((p) => p.id as string);
  if (projectIds.length === 0) return null;

  const [projAtt, taskAtt] = await Promise.all([
    supabaseAdmin
      .from("project_attachments")
      .select("filename, source_url")
      .eq("organization_id", orgId)
      .in("project_id", projectIds)
      .or(BRIEF_FILTER),
    supabaseAdmin
      .from("task_attachments")
      .select("filename, source_url, task:tasks!inner(project_id)")
      .eq("organization_id", orgId)
      .in("task.project_id", projectIds)
      .or(BRIEF_FILTER),
  ]);

  type Cand = { source: "project" | "task"; filename: string; url: string; docId: string };
  const cands: Cand[] = [];
  for (const r of (projAtt.data ?? []) as Array<{ filename: string | null; source_url: string | null }>) {
    const docId = extractGoogleDocId(r.source_url);
    if (docId) cands.push({ source: "project", filename: r.filename ?? "", url: r.source_url!, docId });
  }
  for (const r of (taskAtt.data ?? []) as Array<{ filename: string | null; source_url: string | null }>) {
    const docId = extractGoogleDocId(r.source_url);
    if (docId) cands.push({ source: "task", filename: r.filename ?? "", url: r.source_url!, docId });
  }
  if (cands.length === 0) return null;

  // Prefer an exact "البريف"/"brief" file, and project-level over task-level.
  const rank = (c: Cand) =>
    (/^\s*(البريف|brief)\s*$/i.test(c.filename) ? 2 : 0) + (c.source === "project" ? 1 : 0);
  cands.sort((a, b) => rank(b) - rank(a));

  for (const c of cands) {
    const text = await fetchGoogleDocText(c.docId);
    if (text) return { source: c.source, filename: c.filename, url: c.url, text };
  }
  return null;
}
