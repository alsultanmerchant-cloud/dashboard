import { NextResponse } from "next/server";
import { listLiveEmployees } from "@/lib/odoo/live";

export async function GET() {
  try {
    const employees = await listLiveEmployees();
    return NextResponse.json(employees);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
