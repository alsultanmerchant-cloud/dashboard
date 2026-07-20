import { getServerSession, hasPermission } from "@/lib/auth-server";
import { resolveRange } from "@/lib/dashboard-range";
import {
  generateAndStoreExecutiveReport,
  getCurrentExecutiveReport,
} from "@/lib/executive-report-generate";

export const runtime = "nodejs";
// Facts fan-out + four Gemini chapters — needs more headroom than the brief.
export const maxDuration = 120;

function rangeFrom(req: Request) {
  const sp = new URL(req.url).searchParams;
  return resolveRange({
    preset: sp.get("preset") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession();
    if (!session || !hasPermission(session, "reports.view")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const current = await getCurrentExecutiveReport(session.orgId, rangeFrom(req));
    return Response.json({ current });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "فشل تحميل التقرير" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session || !hasPermission(session, "reports.view")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const range = rangeFrom(req);
    const force = new URL(req.url).searchParams.get("force") === "1";
    if (!force) {
      // A report is a frozen period artifact — same period returns the same
      // run until the user explicitly regenerates.
      const cached = await getCurrentExecutiveReport(session.orgId, range);
      if (cached) return Response.json({ current: cached, cached: true });
    }
    const current = await generateAndStoreExecutiveReport(session.orgId, range, session.userId);
    return Response.json({ current });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "فشل توليد التقرير" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
