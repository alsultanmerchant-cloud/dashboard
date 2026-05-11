import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { listMyActivities } from "@/lib/data/my-activities";

// Lightweight feed for the topbar calendar popover. Returns the same shape
// the /my-activities page consumes, scoped to the current employee. Cached
// at 60s on the edge because the popover refetches on every open anyway.
export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.employeeId) {
    return NextResponse.json({ items: [] });
  }
  const items = await listMyActivities(session.orgId, session.employeeId);
  return NextResponse.json({ items });
}
