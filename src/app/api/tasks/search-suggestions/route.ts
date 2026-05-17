import { NextRequest, NextResponse } from "next/server";
import { getServerSession, hasPermission } from "@/lib/auth-server";
import {
  listTaskSearchSuggestions,
  listTaskTitleSuggestions,
} from "@/lib/data/tasks";

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "tasks.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ tasks: [], items: [] });

  // Tasks first (the primary thing Gehad searches for — feedback #5), then
  // projects/stores as a secondary section. Both run in parallel; a failure
  // in either degrades to an empty list rather than failing the whole call.
  const [tasks, items] = await Promise.all([
    listTaskTitleSuggestions(session.orgId, query).catch(() => []),
    listTaskSearchSuggestions(session.orgId, query).catch(() => []),
  ]);

  return NextResponse.json({ tasks, items });
}
