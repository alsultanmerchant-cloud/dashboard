import { NextResponse } from "next/server";
import { listLiveTasks } from "@/lib/odoo/live";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get("stage")?.split(",").filter(Boolean);
    const overdue = searchParams.get("overdue") === "1";
    const projectId = searchParams.get("projectId");

    const tasks = await listLiveTasks({
      stage,
      overdue,
      projectOdooId: projectId ? Number(projectId) : undefined,
    });
    return NextResponse.json(tasks);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
