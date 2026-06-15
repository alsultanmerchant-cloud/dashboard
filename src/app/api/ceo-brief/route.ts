import { getServerSession } from "@/lib/auth-server";
import {
  generateAndStoreCeoBrief,
  getCurrentCeoBrief,
  CEO_BRIEF_TTL_MS,
} from "@/lib/ceo-brief-generate";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const current = await getCurrentCeoBrief(session.orgId);
    return Response.json({ current });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "فشل تحميل الموجز" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const force = new URL(req.url).searchParams.get("force") === "1";
    if (!force) {
      const cached = await getCurrentCeoBrief(session.orgId);
      if (cached?.completedAt) {
        const age = Date.now() - new Date(cached.completedAt).getTime();
        if (age < CEO_BRIEF_TTL_MS) {
          return Response.json({ current: cached, cached: true });
        }
      }
    }

    const current = await generateAndStoreCeoBrief(session.orgId, session.userId);
    return Response.json({ current });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "فشل توليد الموجز" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
