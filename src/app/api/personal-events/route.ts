import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listPersonalEvents } from "@/lib/data/personal-events";

// GET   → list current user's personal events (org-scoped)
// POST  → create one ({ title, eventDate, eventTime?, note?, color? })
//
// DELETE/PATCH on a specific event live under /api/personal-events/[id].

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = await listPersonalEvents(session.orgId, session.userId);
  return NextResponse.json({ items });
}

const TIME_RX = /^[0-2]\d:[0-5]\d$/;

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: {
    title?: unknown;
    eventDate?: unknown;
    eventTime?: unknown;
    note?: unknown;
    color?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const title =
    typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const eventDate =
    typeof body.eventDate === "string" ? body.eventDate.trim() : "";
  const eventTime =
    typeof body.eventTime === "string" && body.eventTime.trim().length > 0
      ? body.eventTime.trim()
      : null;
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, 1000)
      : null;
  const colorRaw = typeof body.color === "number" ? body.color : 3;
  const color = Math.max(0, Math.min(11, Math.trunc(colorRaw)));

  if (!title) {
    return NextResponse.json({ error: "العنوان مطلوب" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return NextResponse.json(
      { error: "تاريخ غير صالح (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  if (eventTime && !TIME_RX.test(eventTime)) {
    return NextResponse.json(
      { error: "وقت غير صالح (HH:MM)" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("personal_events")
    .insert({
      organization_id: session.orgId,
      user_id: session.userId,
      title,
      event_date: eventDate,
      event_time: eventTime,
      note,
      color,
    })
    .select("id, title, event_date, event_time, note, color, created_at")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create event" },
      { status: 500 },
    );
  }
  return NextResponse.json({ event: data });
}
