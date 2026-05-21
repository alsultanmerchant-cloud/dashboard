import { NextResponse } from "next/server";

import { requireSession, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function loadProjectFavorite(session: Awaited<ReturnType<typeof requireSession>>, projectId: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, is_favorite")
    .eq("organization_id", session.orgId)
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

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

  try {
    const project = await loadProjectFavorite(session, projectId);
    if (!project) return new NextResponse("Not found", { status: 404 });
    return NextResponse.json({ isFavorite: Boolean(project.is_favorite) });
  } catch (error) {
    console.error("[project favorite] load failed:", error);
    return new NextResponse("Failed to load favorite state", { status: 500 });
  }
}

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
  if (!hasPermission(session, "projects.view")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id: projectId } = await params;

  let payload: { isFavorite?: unknown } | null = null;
  try {
    payload = (await req.json()) as { isFavorite?: unknown };
  } catch {
    payload = null;
  }

  try {
    const existing = await loadProjectFavorite(session, projectId);
    if (!existing) return new NextResponse("Not found", { status: 404 });

    const nextFavorite =
      typeof payload?.isFavorite === "boolean"
        ? payload.isFavorite
        : !Boolean(existing.is_favorite);

    const { data, error } = await supabaseAdmin
      .from("projects")
      .update({ is_favorite: nextFavorite })
      .eq("organization_id", session.orgId)
      .eq("id", projectId)
      .select("is_favorite")
      .single();

    if (error || !data) {
      console.error("[project favorite] update failed:", error?.message);
      return new NextResponse("Failed to update favorite state", { status: 500 });
    }

    return NextResponse.json({ isFavorite: Boolean(data.is_favorite) });
  } catch (error) {
    console.error("[project favorite] update failed:", error);
    return new NextResponse("Failed to update favorite state", { status: 500 });
  }
}
