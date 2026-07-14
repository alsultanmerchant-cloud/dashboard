import { getServerSession, hasPermission } from "@/lib/auth-server";
import { getEmployeePendingLateTasks } from "@/lib/data/team-pulse";

export const runtime = "nodejs";

// Per-employee current-stage SLA breaches. This powers the clickable number in
// the Team Pulse "مُعلقة" cell and uses the same ownership predicate as its
// cached count.
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "reports.view")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const employeeId = new URL(request.url).searchParams.get("emp");
  if (!employeeId) {
    return Response.json({ error: "emp required" }, { status: 400 });
  }

  const rows = await getEmployeePendingLateTasks(session.orgId, employeeId);
  return Response.json({ rows });
}
