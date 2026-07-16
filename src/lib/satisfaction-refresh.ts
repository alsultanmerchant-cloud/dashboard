import "server-only";
import { z } from "zod";
import { generateObject } from "ai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { aiModel } from "@/lib/ai-model";
import { buildClientTranscripts } from "@/lib/data/satisfaction";
import { resolveClientProjectIds } from "@/lib/data/satisfaction-identity";
import { getClientBriefRef } from "@/lib/satisfaction-brief";
import {
  classifyRecommendationLiveStatus,
  type RecommendationTaskState,
} from "@/lib/satisfaction-recommendation-status";
import { riyadhTodayIso } from "@/lib/tz";
import type { SatisfactionResult } from "@/lib/satisfaction-schema";

// ---- Status refresh ("تحديث") ---------------------------------------------
// A lightweight reconciliation pass between full re-analyses: feed the model
// the still-open findings of the CURRENT analysis (recommendations, risks,
// accountability complaints) + the WhatsApp messages that arrived SINCE that
// analysis ran + the live task table, and let it judge which findings are now
// resolved. Verdicts persist as the same append-only, issue-keyed ai_events
// overlay the manual "تأكيد أنها حُلّت" button writes — the frozen analysis
// snapshot is never mutated, and every AI closure is auditable/reversible
// exactly like a human one.

interface RefreshItem {
  id: number;
  kind: "recommendation" | "risk" | "accountability";
  index: number; // index within its source array
  issue: string; // the exact stored text — this is the overlay key
  context: string; // action / finding text that helps the model judge
}

export interface RefreshSummary {
  checked: number;
  resolved: Array<{ issue: string; kind: RefreshItem["kind"]; evidence: string }>;
  stillOpen: number;
  unclear: number;
  hadNewMessages: boolean;
  newMessageCount: number;
}

const VerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      id: z.number().int(),
      status: z.enum(["resolved", "still_open", "unclear"]),
      // One Arabic line quoting/pointing at the message or task change that
      // proves the verdict. Required for resolved; best-effort otherwise.
      evidence: z.string(),
    }),
  ),
});

const MAX_TRANSCRIPT_CHARS = 18_000;

function trimOldest(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return "…(الأقدم محذوف)\n" + text.slice(text.length - budget);
}

export async function refreshSatisfactionStatuses(
  orgId: string,
  clientId: string,
  actorUserId: string | null,
  analysisId?: string | null,
): Promise<RefreshSummary> {
  // 1) The analysis under review (the one the operator is looking at).
  let analysisQuery = supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("id, recommendations, risks, accountability, created_at")
    .eq("organization_id", orgId)
    .eq("client_id", clientId);
  analysisQuery = analysisId
    ? analysisQuery.eq("id", analysisId)
    : analysisQuery.eq("is_current", true);
  const { data: analysis, error: analysisError } = await analysisQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (analysisError) throw new Error(analysisError.message);
  if (!analysis) throw new Error("لا يوجد تحليل لهذا العميل بعد");

  const recommendations = (
    Array.isArray(analysis.recommendations) ? analysis.recommendations : []
  ) as SatisfactionResult["recommendations"];
  const risks = (Array.isArray(analysis.risks) ? analysis.risks : []) as string[];
  const accountability = (
    Array.isArray(analysis.accountability) ? analysis.accountability : []
  ) as SatisfactionResult["accountability"];

  // 2) Overlay + live task data (same sources the read side reconciles with).
  const [projectIds, manualEventsRes, brief] = await Promise.all([
    resolveClientProjectIds(orgId, clientId),
    supabaseAdmin
      .from("ai_events")
      .select("payload, created_at")
      .eq("organization_id", orgId)
      .eq("event_type", "SATISFACTION_RECOMMENDATION_STATUS_CHANGED")
      .eq("entity_type", "satisfaction_analysis")
      .eq("entity_id", analysis.id)
      .order("created_at", { ascending: true }),
    getClientBriefRef(orgId, clientId),
  ]);

  const latestStateByIssue = new Map<string, "resolved" | "cleared">();
  for (const event of manualEventsRes.data ?? []) {
    const payload = event.payload;
    if (!payload || Array.isArray(payload) || typeof payload !== "object") continue;
    const state = payload.state;
    const issue = payload.issue;
    if ((state !== "resolved" && state !== "cleared") || typeof issue !== "string") continue;
    latestStateByIssue.set(issue, state);
  }
  const alreadyResolved = (issue: string) => latestStateByIssue.get(issue) === "resolved";

  const tasksByCode = new Map<string, RecommendationTaskState>();
  let liveOverdueCount: number | null = null;
  const taskTableLines: string[] = [];
  if (projectIds.length > 0) {
    const { data: tasks } = await supabaseAdmin
      .from("tasks")
      .select("id, task_code, title, stage, planned_date, archived_at, updated_at")
      .eq("organization_id", orgId)
      .in("project_id", projectIds)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (tasks) {
      liveOverdueCount = 0;
      const todayIso = riyadhTodayIso();
      for (const row of tasks as Array<{
        id: string;
        task_code: string | null;
        title: string | null;
        stage: string | null;
        planned_date: string | null;
        archived_at: string | null;
        updated_at: string | null;
      }>) {
        const archived = Boolean(row.archived_at);
        const stage = row.stage ?? "new";
        if (!archived && stage !== "done" && !!row.planned_date && row.planned_date < todayIso)
          liveOverdueCount += 1;
        if (row.task_code) {
          tasksByCode.set(row.task_code.toUpperCase(), {
            id: row.id,
            taskCode: row.task_code,
            stage,
            archived,
          });
        }
        taskTableLines.push(
          `${row.task_code ?? "—"} | ${row.title ?? ""} | المرحلة: ${stage}${archived ? " (مؤرشفة)" : ""} | الاستحقاق: ${row.planned_date ?? "—"} | آخر تحديث: ${(row.updated_at ?? "").slice(0, 10)}`,
        );
      }
    }
  }

  // 3) The still-open findings — everything a resolved verdict could close.
  //    Machine-resolved items (task-based auto-close) are skipped: they are
  //    already closed on the page, no verdict needed.
  const checkedAt = new Date().toISOString();
  const items: RefreshItem[] = [];
  let nextId = 1;
  recommendations.forEach((recommendation, index) => {
    if (!recommendation || typeof recommendation.issue !== "string") return;
    if (alreadyResolved(recommendation.issue)) return;
    const live = classifyRecommendationLiveStatus({
      recommendation,
      recommendationIndex: index,
      tasksByCode,
      liveOverdueCount,
      hasBrief: Boolean(brief),
      checkedAt,
    });
    if (live.state === "resolved") return;
    items.push({
      id: nextId++,
      kind: "recommendation",
      index,
      issue: recommendation.issue,
      context: recommendation.action ?? "",
    });
  });
  risks.forEach((risk, index) => {
    if (typeof risk !== "string" || !risk.trim()) return;
    if (alreadyResolved(risk)) return;
    items.push({ id: nextId++, kind: "risk", index, issue: risk, context: "" });
  });
  accountability.forEach((row, index) => {
    if (!row || typeof row.complaint !== "string") return;
    if (alreadyResolved(row.complaint)) return;
    // Task-closed complaints are already reconciled deterministically.
    const codes = (row.taskCodes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean);
    const matched = codes
      .map((code) => tasksByCode.get(code))
      .filter((task): task is RecommendationTaskState => Boolean(task));
    if (
      codes.length > 0 &&
      matched.length === codes.length &&
      matched.every((task) => task.stage === "done")
    )
      return;
    items.push({
      id: nextId++,
      kind: "accountability",
      index,
      issue: row.complaint,
      context: [row.finding, row.evidence].filter(Boolean).join(" — "),
    });
  });

  // 4) Messages that arrived AFTER the analysis ran — the new evidence.
  const transcripts = await buildClientTranscripts(orgId, clientId, {
    sinceIso: analysis.created_at as string,
  });
  const newMessageCount = transcripts.clientMessages + transcripts.technicalMessages;
  const hadNewMessages = newMessageCount > 0;

  if (items.length === 0) {
    return {
      checked: 0,
      resolved: [],
      stillOpen: 0,
      unclear: 0,
      hadNewMessages,
      newMessageCount,
    };
  }

  const itemsBlock = items
    .map(
      (item) =>
        `#${item.id} [${item.kind}] ${item.issue}${item.context ? `\n   السياق: ${item.context}` : ""}`,
    )
    .join("\n");
  const messagesBlock = hadNewMessages
    ? [
        transcripts.client
          ? `— قروب العميل —\n${trimOldest(transcripts.client, MAX_TRANSCRIPT_CHARS)}`
          : "",
        transcripts.technical
          ? `— القروب التقني —\n${trimOldest(transcripts.technical, MAX_TRANSCRIPT_CHARS)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    : "(لا توجد رسائل جديدة منذ التحليل)";

  const prompt = `أنت مدقق حالات صارم في وكالة تسويق. أمامك نتائج تحليل رضا عميل سابق (تاريخه: ${(analysis.created_at as string).slice(0, 16).replace("T", " ")}) وقائمة بالمشاكل/التوصيات التي ما زالت مفتوحة فيه.

مهمتك: بناءً فقط على (أ) رسائل الواتساب التي وصلت بعد ذلك التحليل و(ب) جدول حالة المهام الحالي من نظام إدارة المشاريع، احكم على كل بند: هل حُلّ فعلاً، أم ما زال قائمًا، أم لا يوجد دليل كافٍ؟

قواعد صارمة:
- "resolved" فقط عند وجود دليل صريح على أن نفس النقطة عُولجت: رسالة تؤكد الحل/رضا العميل عن نفس النقطة تحديدًا، أو اكتمال مهمة تُعالج هذه المشكلة بالذات.
- اكتمال مهمة دورية/تقرير/"شهر العميل" لا يعني حل المشكلة — إنجاز مهمة روتينية أو انتهاء فترة ليس دليل حل.
- المشاكل المالية أو الخاصة بطرف العميل (مديونية، سداد، شحن رصيد، صلاحيات من العميل) لا تُغلق بإنجاز مهام داخلية؛ تحتاج دليلًا صريحًا من الرسائل على أنها عُولجت.
- غياب الشكوى ليس دليلاً على الحل — عند الشك اختر "unclear".
- "still_open" عندما يُظهر الدليل أن المشكلة ما زالت قائمة (تكرار الشكوى، المهمة ما زالت متعثرة…).
- لكل حكم اكتب سطر دليل واحد بالعربية يقتبس أو يشير للرسالة/المهمة التي بنيت عليها الحكم.
- أعد حكماً لكل بند من البنود المرقّمة، بنفس رقم البند (id).

البنود المفتوحة:
${itemsBlock}

جدول المهام الحالي (كود | عنوان | مرحلة | استحقاق | آخر تحديث):
${taskTableLines.slice(0, 120).join("\n") || "(لا توجد مهام)"}

الرسائل الجديدة منذ التحليل:
${messagesBlock}`;

  const { object } = await generateObject({
    model: aiModel("flagship"),
    maxRetries: 2,
    schema: VerdictSchema,
    prompt,
  });

  const itemById = new Map(items.map((item) => [item.id, item]));
  const resolved: RefreshSummary["resolved"] = [];
  let stillOpen = 0;
  let unclear = 0;
  for (const verdict of object.verdicts) {
    const item = itemById.get(verdict.id);
    if (!item) continue;
    if (verdict.status === "still_open") stillOpen += 1;
    if (verdict.status === "unclear") unclear += 1;
    if (verdict.status !== "resolved") continue;
    resolved.push({ issue: item.issue, kind: item.kind, evidence: verdict.evidence });
  }

  // 5) Persist AI closures as the standard overlay events. recommendationIndex
  //    is informational (the read side keys by issue text); risks/accountability
  //    get offset indices so the number never collides with a real rec index.
  if (resolved.length > 0) {
    const rows = resolved.map((entry) => {
      const item = items.find((i) => i.issue === entry.issue && i.kind === entry.kind)!;
      const recommendationIndex =
        item.kind === "recommendation"
          ? item.index
          : item.kind === "risk"
            ? recommendations.length + item.index
            : 200 + item.index;
      return {
        organization_id: orgId,
        actor_user_id: actorUserId,
        event_type: "SATISFACTION_RECOMMENDATION_STATUS_CHANGED",
        entity_type: "satisfaction_analysis",
        entity_id: analysis.id as string,
        importance: "normal",
        payload: {
          clientId,
          recommendationIndex,
          issue: entry.issue,
          state: "resolved",
          source: "ai_refresh",
          kind: entry.kind,
          evidence: entry.evidence,
        },
      };
    });
    const { error: insertError } = await supabaseAdmin.from("ai_events").insert(rows);
    if (insertError) throw new Error(insertError.message);
  }

  await logAudit({
    organizationId: orgId,
    actorUserId: actorUserId ?? undefined,
    action: "satisfaction.status_refresh",
    entityType: "satisfaction_analysis",
    entityId: analysis.id as string,
    metadata: {
      clientId,
      checked: items.length,
      resolved: resolved.map((entry) => entry.issue),
      stillOpen,
      unclear,
      newMessageCount,
    },
  });

  return {
    checked: items.length,
    resolved,
    stillOpen,
    unclear,
    hadNewMessages,
    newMessageCount,
  };
}
