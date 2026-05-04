"use server";

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { requirePermission } from "@/lib/auth-server";
import { getCEOWeeklyDigest } from "@/lib/data/reports";
import { logAiEvent } from "@/lib/audit";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

/**
 * "اختصر لي تقرير الأسبوع" — Gemini summary grounded ONLY on the four
 * reporting views (composed by getCEOWeeklyDigest). No tool calls,
 * no DB exploration; the model receives the JSON payload and returns
 * a tight Arabic executive summary.
 */
export async function summarizeWeekAction(): Promise<
  | { ok: true; summary: string }
  | { ok: false; error: string }
> {
  try {
    const session = await requirePermission("reports.view");
    const payload = await getCEOWeeklyDigest(session.orgId);

    const prompt = `أنت محلّل عمليات داخل وكالة "Sky Light". لديك ملخّص JSON واحد لأداء الأسبوع، اكتب موجزًا تنفيذيًا قصيرًا للمدير التنفيذي:

- باللغة العربية، 5–7 جمل، نبرة مهنية مباشرة، بدون قوائم نقطية ولا رموز تعبيرية.
- ابدأ بأهم رقم (إيرادات/تأخر/مخالفات) ثم انتقل للمخاطر، ثم اقترح إجراءً واحدًا للأسبوع المقبل.
- لا تُكرّر أرقامًا غير موجودة في JSON.

البيانات:
${JSON.stringify(payload, null, 2)}`;

    const r = await generateText({
      model: google("gemini-3-flash-preview"),
      prompt,
    });

    await logAiEvent({
      organizationId: session.orgId,
      actorUserId: session.userId,
      eventType: "WEEKLY_DIGEST_SUMMARIZED",
      entityType: "weekly_digest",
      payload: { iso_week: payload.iso_week, iso_year: payload.iso_year },
      importance: "low",
    });

    return { ok: true, summary: r.text };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
