import "server-only";
import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveClientProjectIds } from "@/lib/data/satisfaction-identity";

// Locate and fetch a client's BRIEF document so satisfaction analysis can score
// brief-adherence against the client's DOCUMENTED requirements (a Google Doc
// linked to the Brief task / project documents) instead of inferring it from
// the internal WhatsApp chat. The brief lives in the project's "all documents"
// (project_attachments + task_attachments), usually a file named "البريف".
//
// Google Docs and Google Sheets are text-extractable here when shared as
// "anyone with the link". Restricted docs, opaque Drive files/folders, and
// meeting recordings return null → callers degrade gracefully.

export interface ClientBrief {
  source: "project" | "task";
  filename: string;
  url: string; // shareable URL, or `storage:<path>` for an uploaded file
  kind: "google_doc" | "google_sheet" | "text" | "csv" | "xlsx";
  text: string;
}

const MAX_BRIEF_CHARS = 15_000;

// CSV cleanup shared by Google-Sheets export and uploaded .csv/.xlsx files.
function cleanCsv(text: string): string {
  return text
    .replace(/﻿/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/,+\n/g, "\n")
    .trim();
}

// Read an uploaded brief stored in the private `attachments` bucket. Returns
// plain text for txt/csv and the first sheet (as CSV) for xlsx. Anything we
// cannot reliably extract as text (PDF, images, audio, docx, …) returns null so
// the caller keeps briefAdherenceScore null instead of fabricating one.
export async function fetchStorageBriefText(
  storagePath: string,
  filename: string,
  mimetype: string | null,
): Promise<{ text: string; kind: "text" | "csv" | "xlsx" } | null> {
  const lower = `${filename} ${mimetype ?? ""}`.toLowerCase();
  const isXlsx =
    /\.xlsx?$/.test(filename.toLowerCase()) ||
    lower.includes("spreadsheetml") ||
    lower.includes("ms-excel");
  const isCsv = /\.(csv|tsv)$/.test(filename.toLowerCase()) || lower.includes("csv");
  const isText =
    /\.(txt|md|text)$/.test(filename.toLowerCase()) ||
    (mimetype ?? "").startsWith("text/");
  if (!isXlsx && !isCsv && !isText) return null; // unreadable format → degrade

  try {
    const { data, error } = await supabaseAdmin.storage.from("attachments").download(storagePath);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());

    if (isXlsx) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const first = wb.SheetNames[0];
      if (!first) return null;
      const csv = cleanCsv(XLSX.utils.sheet_to_csv(wb.Sheets[first]));
      return csv.length > 0 ? { text: csv.slice(0, MAX_BRIEF_CHARS), kind: "xlsx" } : null;
    }

    const raw = buf.toString("utf-8");
    const clean = isCsv ? cleanCsv(raw) : raw.replace(/﻿/g, "").trim();
    if (clean.length === 0) return null;
    return { text: clean.slice(0, MAX_BRIEF_CHARS), kind: isCsv ? "csv" : "text" };
  } catch {
    return null;
  }
}

export function extractGoogleDocId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export function extractGoogleSheetId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
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

// Fetch the first sheet as CSV. Many agency briefs are Google Sheets templates
// with questions and answers; CSV gives the model enough plain text to compare
// requested scope against delivery.
export async function fetchGoogleSheetText(sheetId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`, {
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
    const clean = text
      .replace(/﻿/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/,+\n/g, "\n")
      .trim();
    return clean.length > 0 ? clean.slice(0, MAX_BRIEF_CHARS) : null;
  } catch {
    return null;
  }
}

// A brief is discoverable either by a "بريف"/"brief" filename OR by being a
// manual upload (external_source) — manually-attached briefs keep their original
// filename, so the filename filter alone would miss them.
const BRIEF_FILTER = "filename.ilike.%بريف%,filename.ilike.%brief%";
const PROJECT_BRIEF_FILTER = `${BRIEF_FILTER},external_source.eq.manual_satisfaction_brief`;

type AttRow = {
  id: string;
  filename: string | null;
  source_url: string | null;
  storage_path: string | null;
  mimetype: string | null;
};

// Either a public Google Doc/Sheet (read via export URL) or a file uploaded to
// the `attachments` bucket (read via storage download). Resolved lazily so an
// unreadable candidate falls through to the next one. `id` is the attachment
// row id (in project_attachments or task_attachments per `source`) so callers
// can delete/replace the wrong brief.
type Cand = { id: string; source: "project" | "task"; filename: string; url: string } & (
  | { via: "google"; kind: "google_doc" | "google_sheet"; googleId: string }
  | { via: "storage"; storagePath: string; mimetype: string | null }
);

function toCand(source: "project" | "task", r: AttRow): Cand | null {
  const docId = extractGoogleDocId(r.source_url);
  if (docId)
    return { id: r.id, source, filename: r.filename ?? "", url: r.source_url!, via: "google", kind: "google_doc", googleId: docId };
  const sheetId = extractGoogleSheetId(r.source_url);
  if (sheetId)
    return { id: r.id, source, filename: r.filename ?? "", url: r.source_url!, via: "google", kind: "google_sheet", googleId: sheetId };
  if (r.storage_path)
    return { id: r.id, source, filename: r.filename ?? "", url: `storage:${r.storage_path}`, via: "storage", storagePath: r.storage_path, mimetype: r.mimetype };
  return null;
}

// Discover the client's candidate brief documents, best-ranked first (exact
// "البريف"/"brief" filename, project-level over task-level). Shared by the text
// fetcher (getClientBrief) and the lightweight reference lookup
// (getClientBriefRef) so both agree on which document is "the brief".
async function findBriefCandidates(orgId: string, clientId: string): Promise<Cand[]> {
  // ALL of the client's live projects across its identity (owned + WA-group-linked
  // + merged twins), so a brief attached to the twin's project is still found.
  const projectIds = await resolveClientProjectIds(orgId, clientId);
  if (projectIds.length === 0) return [];

  const [projAtt, taskAtt] = await Promise.all([
    supabaseAdmin
      .from("project_attachments")
      .select("id, filename, source_url, storage_path, mimetype")
      .eq("organization_id", orgId)
      .in("project_id", projectIds)
      .or(PROJECT_BRIEF_FILTER),
    supabaseAdmin
      .from("task_attachments")
      .select("id, filename, source_url, storage_path, mimetype, task:tasks!inner(project_id)")
      .eq("organization_id", orgId)
      .in("task.project_id", projectIds)
      .or(BRIEF_FILTER),
  ]);

  const cands: Cand[] = [];
  for (const r of (projAtt.data ?? []) as AttRow[]) {
    const c = toCand("project", r);
    if (c) cands.push(c);
  }
  for (const r of (taskAtt.data ?? []) as AttRow[]) {
    const c = toCand("task", r);
    if (c) cands.push(c);
  }
  if (cands.length === 0) return [];

  // Prefer an exact "البريف"/"brief" file, and project-level over task-level.
  const rank = (c: Cand) =>
    (/^\s*(البريف|brief)\s*$/i.test(c.filename) ? 2 : 0) + (c.source === "project" ? 1 : 0);
  cands.sort((a, b) => rank(b) - rank(a));
  return cands;
}

// A reachable reference to the client's brief document — enough for the UI to
// link/download it, WITHOUT fetching or parsing its text. For uploaded files we
// mint a short-lived signed URL into the private `attachments` bucket; Google
// Docs/Sheets keep their original shareable URL.
export interface ClientBriefRef {
  attachmentId: string; // row id in project_attachments / task_attachments
  source: "project" | "task"; // which table the row lives in
  filename: string;
  href: string; // directly openable in the browser
  kind: "google_doc" | "google_sheet" | "file";
}

export async function getClientBriefRef(
  orgId: string,
  clientId: string,
): Promise<ClientBriefRef | null> {
  const cands = await findBriefCandidates(orgId, clientId);
  const top = cands[0];
  if (!top) return null;

  const filename = top.filename || "البريف";
  if (top.via === "google") {
    return { attachmentId: top.id, source: top.source, filename, href: top.url, kind: top.kind };
  }
  // Uploaded file: sign a 1-hour URL so the operator can open/download it.
  const { data } = await supabaseAdmin.storage
    .from("attachments")
    .createSignedUrl(top.storagePath, 3600);
  if (!data?.signedUrl) return null;
  return { attachmentId: top.id, source: top.source, filename, href: data.signedUrl, kind: "file" };
}

export async function getClientBrief(
  orgId: string,
  clientId: string,
): Promise<ClientBrief | null> {
  const cands = await findBriefCandidates(orgId, clientId);
  if (cands.length === 0) return null;

  for (const c of cands) {
    if (c.via === "google") {
      const text = c.kind === "google_doc" ? await fetchGoogleDocText(c.googleId) : await fetchGoogleSheetText(c.googleId);
      if (text) return { source: c.source, filename: c.filename, url: c.url, kind: c.kind, text };
    } else {
      const res = await fetchStorageBriefText(c.storagePath, c.filename, c.mimetype);
      if (res) return { source: c.source, filename: c.filename, url: c.url, kind: res.kind, text: res.text };
    }
  }
  return null;
}
