import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// GET  /api/agent/conversations/[id] — return messages for a conversation.
// PATCH                              — rename a conversation.
// DELETE                             — delete a conversation + its messages.

async function authorize(id: string) {
  const session = await getServerSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  const { data } = await supabaseAdmin
    .from("ai_conversations")
    .select("id, user_id, organization_id, title")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { error: "Not found", status: 404 as const };
  if (data.user_id !== session.userId)
    return { error: "Forbidden", status: 403 as const };
  return { session, conversation: data };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await authorize(id);
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  const { data, error } = await supabaseAdmin
    .from("ai_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    conversation: r.conversation,
    messages: data ?? [],
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await authorize(id);
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  const body = await req.json().catch(() => ({}));
  const title =
    typeof body.title === "string"
      ? body.title.trim().slice(0, 200) || null
      : null;
  const { error } = await supabaseAdmin
    .from("ai_conversations")
    .update({ title })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await authorize(id);
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  const { error } = await supabaseAdmin
    .from("ai_conversations")
    .delete()
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
