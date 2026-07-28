import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildCeoBriefData } from "@/lib/brief/data";
import { generateAndStoreCeoBrief } from "@/lib/ceo-brief-generate";
import { renderAllCards } from "@/lib/brief/cards";
import { phoneToChatId, sendImage, waConfigured } from "@/lib/wa/openwa-client";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// =========================================================================
// CEO morning brief — renders 3 PNG cards (executive scores / accountability
// / money) and sends them over the OpenWA gateway with an Arabic caption.
//
// Recipients come from CEO_BRIEF_RECIPIENTS (comma-separated phone numbers).
// Query params:
//   ?to=2012...   send ONLY to this number (test runs — never defaults to
//                 the full list by accident)
//   ?dry=1        render + return sizes, send nothing
// =========================================================================

const SEND_GAP_MS = 1500; // gateway rate limit is 60 req/min — stay polite

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function recipients(override: string | null): string[] {
  if (override) return [override];
  return (process.env.CEO_BRIEF_RECIPIENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "not configured" }, { status: 500 });
  // Vercel cron authenticates with `Authorization: Bearer <CRON_SECRET>`;
  // manual runs use x-cron-secret or ?secret.
  const provided =
    request.headers.get("x-cron-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const overrideTo = request.nextUrl.searchParams.get("to");
  const to = recipients(overrideTo);

  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", "rawasm-demo")
    .single();
  if (orgError || !org) return NextResponse.json({ error: "org not found" }, { status: 500 });

  // Refresh the on-dashboard CEO brief FIRST — it must never depend on the
  // WhatsApp leg. The old order returned 400/500 on missing recipients or an
  // unconfigured gateway before ever generating, which (combined with no
  // scheduler) left the dashboard serving a frozen brief for weeks.
  // Skipped on dry test runs to save credits.
  let dashboardBrief: "generated" | "failed" | "skipped(dry)" = "skipped(dry)";
  if (!dry) {
    try {
      await generateAndStoreCeoBrief(org.id, null);
      dashboardBrief = "generated";
    } catch (e) {
      dashboardBrief = "failed";
      console.error("[cron.ceo-brief] dashboard brief generation failed:", e);
    }
  }

  // WhatsApp leg is optional: report why it was skipped instead of erroring the
  // whole cron run.
  if (!dry && to.length === 0)
    return NextResponse.json({ ok: true, dashboardBrief, wa: "skipped (CEO_BRIEF_RECIPIENTS empty)" });
  if (!dry && !waConfigured())
    return NextResponse.json({ ok: true, dashboardBrief, wa: "skipped (WA gateway not configured)" });

  const brief = await buildCeoBriefData(org.id);
  const cards = await renderAllCards(brief);

  if (dry) {
    // Dev-only: drop the PNGs to /tmp so the cards can be eyeballed before
    // any real send.
    if (
      process.env.NODE_ENV !== "production" &&
      request.nextUrl.searchParams.get("save") === "1"
    ) {
      const { writeFile } = await import("node:fs/promises");
      await Promise.all(
        cards.map((c) => writeFile(`/tmp/ceo-brief-${c.name}.png`, c.png)),
      );
    }
    return NextResponse.json({
      ok: true,
      dry: true,
      caption: brief.caption,
      cards: cards.map((c) => ({ name: c.name, bytes: c.png.length })),
    });
  }

  // The gateway rejects bodies over ~100KB, so cards are uploaded to the
  // public `ceo-brief` bucket and sent by URL. Day-stamped path, upsert —
  // re-runs overwrite the same day's files instead of accumulating.
  const day = new Date().toISOString().slice(0, 10);
  const urls: Array<{ name: string; url: string }> = [];
  for (const card of cards) {
    const storagePath = `${day}/${card.name}.png`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("ceo-brief")
      .upload(storagePath, card.png, { contentType: "image/png", upsert: true });
    if (upErr)
      return NextResponse.json({ error: `upload ${card.name}: ${upErr.message}` }, { status: 500 });
    const { data: pub } = supabaseAdmin.storage.from("ceo-brief").getPublicUrl(storagePath);
    urls.push({ name: card.name, url: pub.publicUrl });
  }

  const results: Array<{ to: string; card: string; ok: boolean; error?: string }> = [];
  for (const phone of to) {
    const chatId = phoneToChatId(phone);
    for (let i = 0; i < urls.length; i++) {
      // Caption rides on the first card so the thread reads as one brief.
      const res = await sendImage(
        chatId,
        { url: urls[i].url },
        i === 0 ? brief.caption : undefined,
      );
      results.push({ to: phone, card: urls[i].name, ok: res.ok, error: res.error });
      await sleep(SEND_GAP_MS);
    }
  }

  const failed = results.filter((r) => !r.ok);
  await supabaseAdmin.from("ai_events").insert({
    organization_id: org.id,
    event_type: "NOTIFICATION_CREATED",
    entity_type: "ceo_brief",
    entity_id: org.id,
    payload: {
      kind: "ceo_whatsapp_brief",
      override_to: overrideTo,
      recipients: to,
      sent: results.length - failed.length,
      failed: failed.length,
      caption: brief.caption,
      results,
    },
    importance: failed.length > 0 ? "high" : "normal",
  });

  return NextResponse.json({ ok: failed.length === 0, dashboardBrief, results });
}
