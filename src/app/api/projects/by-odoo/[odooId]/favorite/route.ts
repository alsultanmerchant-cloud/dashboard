import { NextResponse } from "next/server";

import { requireSession, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function loadProjectFavoriteByOdooId(
  session: Awaited<ReturnType<typeof requireSession>>,
  odooId: number,
) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, is_favorite")
    .eq("organization_id", session.orgId)
    .eq("external_id", odooId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ odooId: string }> },
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

  const { odooId: rawOdooId } = await params;
  const odooId = Number(rawOdooId);
  if (!Number.isFinite(odooId)) {
    return new NextResponse("Invalid Odoo project id", { status: 400 });
  }

  try {
    const project = await loadProjectFavoriteByOdooId(session, odooId);
    if (!project) return new NextResponse("Not found", { status: 404 });
    return NextResponse.json({ projectId: project.id, isFavorite: Boolean(project.is_favorite) });
  } catch (error) {
    console.error("[project favorite by odoo] load failed:", error);
    return new NextResponse("Failed to load favorite state", { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ odooId: string }> },
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

  const { odooId: rawOdooId } = await params;
  const odooId = Number(rawOdooId);
  if (!Number.isFinite(odooId)) {
    return new NextResponse("Invalid Odoo project id", { status: 400 });
  }

  let payload: { isFavorite?: unknown } | null = null;
  try {
    payload = (await req.json()) as { isFavorite?: unknown };
  } catch {
    payload = null;
  }

  try {
    const existing = await loadProjectFavoriteByOdooId(session, odooId);
    if (!existing) return new NextResponse("Not found", { status: 404 });

    const nextFavorite =
      typeof payload?.isFavorite === "boolean"
        ? payload.isFavorite
        : !Boolean(existing.is_favorite);

    const { data, error } = await supabaseAdmin
      .from("projects")
      .update({ is_favorite: nextFavorite })
      .eq("organization_id", session.orgId)
      .eq("id", existing.id)
      .select("id, is_favorite")
      .single();

    if (error || !data) {
      console.error("[project favorite by odoo] update failed:", error?.message);
      return new NextResponse("Failed to update favorite state", { status: 500 });
    }

    return NextResponse.json({ projectId: data.id, isFavorite: Boolean(data.is_favorite) });
  } catch (error) {
    console.error("[project favorite by odoo] update failed:", error);
    return new NextResponse("Failed to update favorite state", { status: 500 });
  }
}
