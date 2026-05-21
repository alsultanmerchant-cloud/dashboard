import { NextResponse } from "next/server";
import sanitizeHtml from "sanitize-html";

import { requireSession, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Odoo mail.message bodies come as HTML. Allowlist the safe subset; drop
// classes (they reference Odoo CSS we don't ship). Links open in a new
// tab with rel=noopener.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "span", "a",
    "ul", "ol", "li", "blockquote", "code", "pre",
  ],
  allowedAttributes: {
    a: ["href", "title"],
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer",
    }),
  },
  allowedSchemes: ["http", "https", "mailto"],
};

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!hasPermission(session, "projects.view")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id: projectId } = await params;

  const { data, error } = await supabaseAdmin
    .from("project_comments")
    .select(
      "id, body, is_internal, created_at, author_user_id, external_author_name, external_author_avatar_url",
    )
    .eq("organization_id", session.orgId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[project comments] load failed:", error.message);
    return new NextResponse("Failed to load comments", { status: 500 });
  }

  type Row = {
    id: string;
    body: string;
    is_internal: boolean;
    created_at: string;
    author_user_id: string | null;
    external_author_name: string | null;
    external_author_avatar_url: string | null;
  };
  const rows = (data ?? []) as Row[];

  // Resolve author names for rows with author_user_id via employee_profiles.
  const userIds = Array.from(
    new Set(rows.map((r) => r.author_user_id).filter((v): v is string => Boolean(v))),
  );
  const lookup = new Map<string, { full_name: string; avatar_url: string | null }>();
  if (userIds.length > 0) {
    const { data: emps } = await supabaseAdmin
      .from("employee_profiles")
      .select("user_id, full_name, avatar_url")
      .eq("organization_id", session.orgId)
      .in("user_id", userIds);
    for (const e of emps ?? []) {
      lookup.set(e.user_id as string, {
        full_name: (e.full_name as string) ?? "—",
        avatar_url: (e.avatar_url as string | null) ?? null,
      });
    }
  }

  // Odoo emits field-change tracking as `mail.message` rows with a body
  // shaped like `<p><strong>Field:</strong> old → new</p>` (multiple <p>
  // for batched changes). They're useful audit context but visually noisy
  // mixed with human notes — tag them so the client can render them as a
  // muted "history" entry instead of a full note.
  const TRACKING_RE = /^\s*(<p[^>]*>\s*<strong>[\s\S]+?<\/strong>[\s\S]*?→[\s\S]*?<\/p>\s*)+\s*$/i;

  const comments = rows.map((r) => {
    const user = r.author_user_id ? lookup.get(r.author_user_id) : null;
    const body = r.body ?? "";
    const isTracking = TRACKING_RE.test(body);
    return {
      id: r.id,
      body_html: sanitizeHtml(body, SANITIZE_OPTS),
      kind: isTracking ? "tracking" : "note",
      is_internal: r.is_internal,
      created_at: r.created_at,
      author_name:
        user?.full_name ?? r.external_author_name ?? "—",
      author_avatar_url:
        user?.avatar_url ?? r.external_author_avatar_url ?? null,
    };
  });

  return NextResponse.json({ comments });
}

// Dashboard-authored log notes. Stays local (no Odoo writeback yet) —
// rows are identified by null external_source/external_id and a non-null
// author_user_id.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!hasPermission(session, "projects.manage")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id: projectId } = await params;

  let payload: { body?: unknown };
  try {
    payload = (await req.json()) as { body?: unknown };
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  const raw = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!raw) {
    return new NextResponse("Body required", { status: 400 });
  }
  if (raw.length > 8000) {
    return new NextResponse("Body too long", { status: 400 });
  }

  // Plain text → HTML: blank-line-separated paragraphs, single newlines
  // become <br>. Sanitization on read handles anything malicious that
  // sneaks through, but escape entities here so user-typed angle brackets
  // don't render as tags.
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const body = raw
    .split(/\n{2,}/)
    .map((para) => `<p>${escape(para).replace(/\n/g, "<br>")}</p>`)
    .join("");

  // Scope check — make sure the project belongs to this org.
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organization_id", session.orgId)
    .eq("id", projectId)
    .maybeSingle();
  if (!project) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("project_comments")
    .insert({
      organization_id: session.orgId,
      project_id: projectId,
      author_user_id: session.userId,
      body,
      is_internal: true,
      kind: "note",
    })
    .select(
      "id, body, is_internal, created_at, author_user_id, external_author_name, external_author_avatar_url",
    )
    .single();

  if (insertError || !inserted) {
    console.error("[project comments] insert failed:", insertError?.message);
    return new NextResponse("Failed to create note", { status: 500 });
  }

  // Resolve author display from employee_profiles for the response shape.
  const { data: emp } = await supabaseAdmin
    .from("employee_profiles")
    .select("full_name, avatar_url")
    .eq("organization_id", session.orgId)
    .eq("user_id", session.userId)
    .maybeSingle();

  const comment = {
    id: inserted.id as string,
    body_html: sanitizeHtml(inserted.body ?? "", SANITIZE_OPTS),
    kind: "note" as const,
    is_internal: inserted.is_internal as boolean,
    created_at: inserted.created_at as string,
    author_name:
      (emp?.full_name as string | undefined) ??
      session.fullName ??
      "—",
    author_avatar_url:
      (emp?.avatar_url as string | null | undefined) ??
      session.avatarUrl ??
      null,
  };

  return NextResponse.json({ comment }, { status: 201 });
}
