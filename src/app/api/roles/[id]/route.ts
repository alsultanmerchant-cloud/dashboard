import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function verifySuperAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();

  return profile?.is_super_admin ? user : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifySuperAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();

  // Block editing system roles
  const { data: existing } = await supabaseAdmin
    .from("roles")
    .select("is_system")
    .eq("id", id)
    .single();

  if (existing?.is_system) {
    return NextResponse.json({ error: "Cannot edit system roles" }, { status: 400 });
  }

  const { name, slug, org_id, allowed_pages } = body;
  const { data, error } = await supabaseAdmin
    .from("roles")
    .update({ name, slug, org_id: org_id || null, allowed_pages })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifySuperAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;

  // Block deleting system roles
  const { data: existing } = await supabaseAdmin
    .from("roles")
    .select("is_system")
    .eq("id", id)
    .single();

  if (existing?.is_system) {
    return NextResponse.json({ error: "Cannot delete system roles" }, { status: 400 });
  }

  // Check if any users are assigned to this role
  const { count } = await supabaseAdmin
    .from("user_profiles")
    .select("id", { count: "exact", head: true })
    .eq("role_id", id);

  if (count && count > 0) {
    return NextResponse.json({ error: "Cannot delete role with assigned users" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("roles").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
