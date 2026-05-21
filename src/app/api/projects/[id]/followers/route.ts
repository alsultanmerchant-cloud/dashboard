import { NextResponse } from "next/server";
import { requireSession, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
    .from("project_followers")
    .select("employee:employee_profiles ( id, full_name, avatar_url, job_title )")
    .eq("organization_id", session.orgId)
    .eq("project_id", projectId);

  if (error) {
    console.error("[project followers] load failed:", error.message);
    return new NextResponse("Failed to load followers", { status: 500 });
  }

  type EmployeeRow = {
    id: string;
    full_name: string;
    avatar_url: string | null;
    job_title: string | null;
  };
  const followers = ((data ?? []) as Array<{
    employee: EmployeeRow | EmployeeRow[] | null;
  }>)
    .map((row) => (Array.isArray(row.employee) ? row.employee[0] : row.employee))
    .filter((employee): employee is EmployeeRow => employee !== null);

  return NextResponse.json({ followers });
}
