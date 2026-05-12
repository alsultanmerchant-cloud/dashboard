import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Sky Light §9.2: CRUD-lite for AI conversations persisted in Postgres.
//   GET    → list current user's conversations (newest activity first)
//   POST   → create a new empty conversation (optionally with a title)
// Per-conversation messages live under /conversations/[id]/messages.

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin
    .from("ai_conversations")
    .select("id, title, created_at, updated_at")
    .eq("organization_id", session.orgId)
    .eq("user_id", session.userId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let title: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.title === "string" && body.title.trim().length > 0) {
      title = body.title.trim().slice(0, 200);
    }
  } catch {
    // ignore
  }
  const { data, error } = await supabaseAdmin
    .from("ai_conversations")
    .insert({
      organization_id: session.orgId,
      user_id: session.userId,
      title,
    })
    .select("id, title, created_at, updated_at")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create conversation" },
      { status: 500 },
    );
  }
  return NextResponse.json({ conversation: data });
}
