import { NextResponse } from "next/server";
import { listLiveClients } from "@/lib/odoo/live";

export async function GET() {
  try {
    const clients = await listLiveClients();
    return NextResponse.json(clients);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
