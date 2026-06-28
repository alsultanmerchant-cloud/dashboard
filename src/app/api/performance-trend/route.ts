import { getServerSession, hasPermission } from "@/lib/auth-server";
import { getEmployeeTrend } from "@/lib/data/performance-trend";

export const runtime = "nodejs";

// Trend series for one employee, powering the "قارن بالسابق" modal. Reads the
// frozen performance_snapshots cache (0216). Gated to reports.view — this is a
// management performance surface, same audience as نبض الفريق / المساءلة.
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  if (!hasPermission(session, "reports.view")) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const emp = new URL(request.url).searchParams.get("emp");
  if (!emp) {
    return new Response(JSON.stringify({ error: "emp required" }), { status: 400 });
  }

  const trend = await getEmployeeTrend(session.orgId, emp);
  if (!trend) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }
  return Response.json(trend);
}
