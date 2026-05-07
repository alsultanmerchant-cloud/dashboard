import { NextResponse } from "next/server";
import { getServerSession, hasPermission } from "@/lib/auth-server";
import { listTaskFiltersForUser } from "@/app/(dashboard)/tasks/_filter_actions";

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "tasks.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const items = await listTaskFiltersForUser(session.orgId, session.userId);
  return NextResponse.json({ items });
}
