import { getServerSession, hasPermission } from "@/lib/auth-server";
import { getEmployeeActiveProjects } from "@/lib/data/team-pulse";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "reports.view")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const employeeId = new URL(request.url).searchParams.get("emp");
  if (!employeeId) return Response.json({ error: "emp required" }, { status: 400 });

  const rows = await getEmployeeActiveProjects(session.orgId, employeeId);
  return Response.json({ rows });
}
