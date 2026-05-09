// Proxy for Odoo `ir.attachment` binaries.
//
// Why this exists: until the binary backfill job runs, the dashboard only
// has metadata + a `source_url` pointing at https://skylight.rwasem.com/web/
// content/{id}, which requires an active Odoo session in the user's browser.
// This route fetches the file server-side using the dashboard's already-
// authenticated XML-RPC client and streams it back to the user.
//
// Auth: requires a dashboard session and verifies the requested attachment
// belongs to a row in `task_attachments` or `project_attachments` that the
// caller can read (RLS-style, via the admin client + their orgId). This
// stops the route from being a generic Odoo file-grabber.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { odooFromEnv, OdooError } from "@/lib/odoo/client";

export const dynamic = "force-dynamic";

type OdooAttachmentRow = {
  id: number;
  name: string | false;
  mimetype: string | false;
  datas: string | false; // base64
};

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

  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return new NextResponse("Bad attachment id", { status: 400 });
  }

  // Confirm this Odoo attachment was actually imported into one of the
  // attachment tables for the caller's org. This is the access gate.
  const [taskAtt, projectAtt] = await Promise.all([
    supabaseAdmin
      .from("task_attachments")
      .select("id, filename, mimetype")
      .eq("organization_id", session.orgId)
      .eq("external_source", "odoo")
      .eq("external_id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("project_attachments")
      .select("id, filename, mimetype")
      .eq("organization_id", session.orgId)
      .eq("external_source", "odoo")
      .eq("external_id", id)
      .maybeSingle(),
  ]);
  const meta = taskAtt.data ?? projectAtt.data;
  if (!meta) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Pull the binary from Odoo. `datas` is base64 in the JSON-RPC response;
  // we decode and stream it back. ir.attachment.read returns a single row
  // when given a single id.
  let rows: OdooAttachmentRow[];
  try {
    const odoo = odooFromEnv();
    rows = await odoo.read<OdooAttachmentRow>(
      "ir.attachment",
      [Number(id)],
      ["id", "name", "mimetype", "datas"],
    );
  } catch (e) {
    const msg = e instanceof OdooError ? e.message : "Odoo fetch failed";
    console.warn(`[odoo proxy] ${id}: ${msg}`);
    return new NextResponse(msg, { status: 502 });
  }
  const row = rows[0];
  if (!row || typeof row.datas !== "string" || !row.datas) {
    return new NextResponse("Attachment has no binary in Odoo", { status: 410 });
  }

  // Buffer.from is server-only; that's fine, this is a Next.js route handler.
  const bin = Buffer.from(row.datas, "base64");
  const filename =
    typeof row.name === "string" && row.name
      ? row.name
      : meta.filename ?? `attachment-${id}`;
  const mimetype =
    (typeof row.mimetype === "string" && row.mimetype) ||
    meta.mimetype ||
    "application/octet-stream";

  // RFC 5987 encoding so non-ASCII (Arabic) filenames survive the header.
  const encodedName = encodeURIComponent(filename).replace(/['()]/g, escape);

  return new NextResponse(bin, {
    status: 200,
    headers: {
      "Content-Type": mimetype,
      "Content-Length": String(bin.length),
      "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
      // Private cache: 1h. The signed-URL flow uses the same window.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
