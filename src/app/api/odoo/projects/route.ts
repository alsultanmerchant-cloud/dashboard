import { NextResponse } from "next/server";
import { listLiveProjects } from "@/lib/odoo/live";

export async function GET() {
  try {
    const projects = await listLiveProjects();
    return NextResponse.json(projects);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
