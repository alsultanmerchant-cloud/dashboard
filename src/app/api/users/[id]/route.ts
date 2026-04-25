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
  const { name, email, org_id, allowed_pages, is_super_admin } = body;

  const profileUpdates: Record<string, unknown> = {};
  if (name !== undefined) profileUpdates.name = name;
  if (email !== undefined) profileUpdates.email = email;
  if (org_id !== undefined) profileUpdates.org_id = org_id;
  if (is_super_admin !== undefined) profileUpdates.is_super_admin = is_super_admin;

  // Update auth email if changed
  if (email) {
    await supabaseAdmin.auth.admin.updateUserById(id, { email });
  }

  // Update the user's role allowed_pages if provided
  if (allowed_pages) {
    // Get user's current role
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("role_id, roles(is_system)")
      .eq("id", id)
      .single();

    if (profile) {
      const role = profile.roles as unknown as { is_system: boolean } | null;
      if (role && !role.is_system) {
        // Update existing non-system role
        await supabaseAdmin
          .from("roles")
          .update({ allowed_pages, name: name || undefined, org_id: org_id || undefined })
          .eq("id", profile.role_id);
      } else {
        // System role — create a new personal role instead
        const { data: newRole } = await supabaseAdmin
          .from("roles")
          .insert({
            name: name || "مخصص",
            slug: `user_${id.slice(0, 8)}`,
            org_id: org_id || null,
            allowed_pages,
            is_system: false,
          })
          .select()
          .single();

        if (newRole) {
          profileUpdates.role_id = newRole.id;
        }
      }
    }
  }

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .update(profileUpdates)
    .eq("id", id)
    .select("*, roles(id, name, slug, allowed_pages), organizations(name, name_ar)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifySuperAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;

  // Prevent deleting yourself
  if (id === admin.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  // Get user's role before deleting (to clean up non-system roles)
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("role_id, roles(is_system)")
    .eq("id", id)
    .single();

  // Delete auth user (cascades to user_profiles)
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Clean up non-system role if no other users reference it
  if (profile) {
    const role = profile.roles as unknown as { is_system: boolean } | null;
    if (role && !role.is_system) {
      const { count } = await supabaseAdmin
        .from("user_profiles")
        .select("id", { count: "exact", head: true })
        .eq("role_id", profile.role_id);

      if (count === 0) {
        await supabaseAdmin.from("roles").delete().eq("id", profile.role_id);
      }
    }
  }

  return NextResponse.json({ success: true });
}
