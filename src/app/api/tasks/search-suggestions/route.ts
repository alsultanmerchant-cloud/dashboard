import { NextRequest, NextResponse } from "next/server";
import { getServerSession, hasPermission } from "@/lib/auth-server";
import { listTaskSearchSuggestions } from "@/lib/data/tasks";

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "tasks.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ items: [] });

  const items = await listTaskSearchSuggestions(session.orgId, query);
  return NextResponse.json({ items });
}
