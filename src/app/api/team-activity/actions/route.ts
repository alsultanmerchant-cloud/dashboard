import { getServerSession, hasPermission } from "@/lib/auth-server";
import { getEmployeeActionLog } from "@/lib/data/team-pulse";

export const runtime = "nodejs";

// Per-employee action breakdown (which tasks/projects the Rwasem actions were
// on) — powers the stacked drill-down sheet on نبض الفريق. Gated to reports.view.
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  if (!hasPermission(session, "reports.view")) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const url = new URL(request.url);
  const emp = url.searchParams.get("emp");
  const days = Number(url.searchParams.get("days") ?? "30");
  if (!emp) {
    return new Response(JSON.stringify({ error: "emp required" }), { status: 400 });
  }

  const rows = await getEmployeeActionLog(session.orgId, emp, Number.isFinite(days) ? days : 30);
  return Response.json({ rows });
}
