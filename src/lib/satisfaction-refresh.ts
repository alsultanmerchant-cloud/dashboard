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
  extractRecommendationTaskCodes,
  foldResolutionOverlayEvents,
  type RecommendationTaskState,
} from "@/lib/satisfaction-recommendation-status";
import {
  autoResolveOpenQuestions,
  buildAnsweredQuestionsBlock,
  createOpenQuestions,
  getHumanResolvedIssues,
} from "@/lib/satisfaction-questions";
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
  taskCodes: string[]; // cited task codes (uppercased) — question rows reuse them
  responsibleName: string | null; // first accountable person (accountability rows)
}

export interface RefreshSummary {
  checked: number;
  resolved: Array<{
    issue: string;
    kind: RefreshItem["kind"];
    evidence: string;
    taskCode: string | null;
    quote: string | null;
  }>;
  stillOpen: number;
  unclear: number;
  downgraded: number;
  questionsCreated: number;
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
      // Machine-checkable citation for "resolved": a task code from the task
      // table (must be a DONE task) OR a quote copied VERBATIM from the new
      // messages. Verified server-side; an unverifiable "resolved" is
      // downgraded to "unclear". Null when not applicable.
      taskCode: z.string().nullable(),
      quote: z.string().nullable(),
      // For "unclear": one Arabic line asking exactly what is needed to judge.
      question: z.string().nullable().optional(),
    }),
  ),
});

// Final per-item status AFTER server-side verification (resolved verdicts with
// no verified citation are downgraded to unclear). The questions queue
// (Feature 3) persists the `unclear` entries of this list — keep the shape.
interface RefreshVerdictOutcome {
  item: RefreshItem;
  status: "resolved" | "still_open" | "unclear";
  evidence: string;
  taskCode: string | null; // verified done-task citation (resolved only)
  quote: string | null; // verified verbatim message quote (resolved only)
  question: string | null; // what the AI needs to know (unclear only)
  downgraded: boolean; // resolved verdict demoted for lack of verified citation
}

// Financial / client-side problems (debt, payments, balance top-ups…) can only
// close on explicit message evidence — a done internal task proves nothing
// about the client actually paying.
const FINANCIAL_ISSUE_RE = /مديون|سداد|دفع|فاتور|مدفوع|رصيد|شحن|مالي|تحويل|دفعة/;

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

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
  options?: { source?: string },
): Promise<RefreshSummary> {
  const source = options?.source ?? "ai_refresh";
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

  // 2) Overlay + live task data (same sources the read side reconciles with),
  //    plus the human-answered questions — ground-truth memory for the model.
  const [projectIds, manualEventsRes, brief, answeredMemoryBlock, humanResolvedIssues] =
    await Promise.all([
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
      buildAnsweredQuestionsBlock(orgId, clientId),
      getHumanResolvedIssues(orgId, clientId),
    ]);

  const latestStateByIssue = foldResolutionOverlayEvents(manualEventsRes.data ?? []);
  const alreadyResolved = (issue: string) =>
    latestStateByIssue.get(issue)?.state === "resolved";

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
  // Issues a human already answered `resolved` but that this (possibly rotated)
  // analysis still lists: force-close them against THIS analysis id so the read
  // side — which folds the overlay per current analysis — shows them closed.
  const forcedResolved: RefreshVerdictOutcome[] = [];
  // Issues closed deterministically this pass (recommendation went live-resolved,
  // or all cited tasks are done): their pending questions must auto-resolve too.
  const machineResolvedIssues: string[] = [];
  const HUMAN_ANSWER_EVIDENCE = "أكد فريق العمل سابقًا أن هذه النقطة عولجت.";
  const forceIfHumanResolved = (
    issue: string,
    kind: RefreshItem["kind"],
    index: number,
  ): boolean => {
    if (!humanResolvedIssues.has(issue)) return false;
    forcedResolved.push({
      item: { id: -1, kind, index, issue, context: "", taskCodes: [], responsibleName: null },
      status: "resolved",
      evidence: HUMAN_ANSWER_EVIDENCE,
      taskCode: null,
      quote: null,
      question: null,
      downgraded: false,
    });
    return true;
  };
  let nextId = 1;
  recommendations.forEach((recommendation, index) => {
    if (!recommendation || typeof recommendation.issue !== "string") return;
    if (alreadyResolved(recommendation.issue)) return;
    if (forceIfHumanResolved(recommendation.issue, "recommendation", index)) return;
    const live = classifyRecommendationLiveStatus({
      recommendation,
      recommendationIndex: index,
      tasksByCode,
      liveOverdueCount,
      hasBrief: Boolean(brief),
      checkedAt,
    });
    if (live.state === "resolved") {
      machineResolvedIssues.push(recommendation.issue);
      return;
    }
    items.push({
      id: nextId++,
      kind: "recommendation",
      index,
      issue: recommendation.issue,
      context: recommendation.action ?? "",
      taskCodes: extractRecommendationTaskCodes(recommendation),
      responsibleName: null,
    });
  });
  risks.forEach((risk, index) => {
    if (typeof risk !== "string" || !risk.trim()) return;
    if (alreadyResolved(risk)) return;
    if (forceIfHumanResolved(risk, "risk", index)) return;
    items.push({
      id: nextId++,
      kind: "risk",
      index,
      issue: risk,
      context: "",
      taskCodes: [],
      responsibleName: null,
    });
  });
  accountability.forEach((row, index) => {
    if (!row || typeof row.complaint !== "string") return;
    if (alreadyResolved(row.complaint)) return;
    if (forceIfHumanResolved(row.complaint, "accountability", index)) return;
    // Task-closed complaints are already reconciled deterministically.
    const codes = (row.taskCodes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean);
    const matched = codes
      .map((code) => tasksByCode.get(code))
      .filter((task): task is RecommendationTaskState => Boolean(task));
    if (
      codes.length > 0 &&
      matched.length === codes.length &&
      matched.every((task) => task.stage === "done")
    ) {
      machineResolvedIssues.push(row.complaint);
      return;
    }
    items.push({
      id: nextId++,
      kind: "accountability",
      index,
      issue: row.complaint,
      context: [row.finding, row.evidence].filter(Boolean).join(" — "),
      taskCodes: codes,
      responsibleName: row.responsible?.[0]?.name ?? null,
    });
  });

  // 4) Messages that arrived AFTER the analysis ran — the new evidence.
  const transcripts = await buildClientTranscripts(orgId, clientId, {
    sinceIso: analysis.created_at as string,
  });
  const newMessageCount = transcripts.clientMessages + transcripts.technicalMessages;
  const hadNewMessages = newMessageCount > 0;

  // Nothing to judge and nothing to close deterministically → done.
  if (items.length === 0 && forcedResolved.length === 0 && machineResolvedIssues.length === 0) {
    return {
      checked: 0,
      resolved: [],
      stillOpen: 0,
      unclear: 0,
      downgraded: 0,
      questionsCreated: 0,
      hadNewMessages,
      newMessageCount,
    };
  }

  // Only call the model when there are items it needs to judge; forced/machine
  // closures below persist without an AI verdict.
  const outcomes: RefreshVerdictOutcome[] = [];
  if (items.length > 0) {
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
- كل حكم "resolved" يجب أن يحمل استشهادًا قابلاً للتحقق آليًا: إما taskCode لمهمة مكتملة (المرحلة done) من جدول المهام أدناه، أو quote منسوخ حرفيًا — دون أي تعديل أو تلخيص — من الرسائل الجديدة أدناه (8 أحرف على الأقل). سنتحقق منه آليًا، وأي "resolved" بلا استشهاد صحيح سيُحوَّل إلى "unclear".
- اكتمال مهمة دورية/تقرير/"شهر العميل" لا يعني حل المشكلة — إنجاز مهمة روتينية أو انتهاء فترة ليس دليل حل.
- المشاكل المالية أو الخاصة بطرف العميل (مديونية، سداد، شحن رصيد، صلاحيات من العميل) لا تُغلق بإنجاز مهام داخلية؛ تحتاج quote صريحًا من الرسائل على أنها عُولجت — taskCode وحده لا يكفي هنا.
- غياب الشكوى ليس دليلاً على الحل — عند الشك اختر "unclear".
- إجابات فريق العمل الموثّقة (إن وُجدت أدناه) حقائق مؤكدة: بند أجاب عنه الفريق بأنه «ما زالت قائمة» لا يُحكم عليه بـ"resolved" إلا بدليل جديد تاريخه بعد تاريخ الإجابة، ولا تناقض أبدًا إجابة بشرية بأنه «تم الحل».
- عند "unclear" اكتب في question سطرًا واحدًا بالعربية يسأل فريق العمل تحديدًا عمّا تحتاج معرفته للحكم على هذا البند.
- "still_open" عندما يُظهر الدليل أن المشكلة ما زالت قائمة (تكرار الشكوى، المهمة ما زالت متعثرة…).
- لكل حكم اكتب سطر دليل واحد بالعربية يقتبس أو يشير للرسالة/المهمة التي بنيت عليها الحكم.
- ضع null في الحقول غير المنطبقة (taskCode/quote/question).
- أعد حكماً لكل بند من البنود المرقّمة، بنفس رقم البند (id).

البنود المفتوحة:
${itemsBlock}

جدول المهام الحالي (كود | عنوان | مرحلة | استحقاق | آخر تحديث):
${taskTableLines.slice(0, 120).join("\n") || "(لا توجد مهام)"}
${answeredMemoryBlock ? `\n${answeredMemoryBlock}\n` : ""}
الرسائل الجديدة منذ التحليل:
${messagesBlock}`;

    const { object } = await generateObject({
      model: aiModel("flagship"),
      maxRetries: 2,
      schema: VerdictSchema,
      prompt,
    });

    // 5) Server-side verification: a "resolved" verdict only sticks if its
    //    citation checks out against real data — a DONE task in the live table
    //    (archived+done still counts), or a verbatim quote from the new messages.
    //    Financial/client-side problems close only on a quote. An unverifiable
    //    "resolved" is downgraded to "unclear" (→ a question, not a false close).
    const newMessagesText = normalizeWhitespace(
      [transcripts.client, transcripts.technical].filter(Boolean).join("\n"),
    );
    const itemById = new Map(items.map((item) => [item.id, item]));
    for (const verdict of object.verdicts) {
      const item = itemById.get(verdict.id);
      if (!item) continue;
      if (verdict.status !== "resolved") {
        outcomes.push({
          item,
          status: verdict.status,
          evidence: verdict.evidence,
          taskCode: null,
          quote: null,
          question: verdict.status === "unclear" ? (verdict.question ?? null) : null,
          downgraded: false,
        });
        continue;
      }
      const citedTask = verdict.taskCode
        ? tasksByCode.get(verdict.taskCode.trim().toUpperCase())
        : undefined;
      const doneTaskCode = citedTask && citedTask.stage === "done" ? citedTask.taskCode : null;
      const normalizedQuote = verdict.quote ? normalizeWhitespace(verdict.quote) : "";
      const verifiedQuote =
        normalizedQuote.length >= 8 && newMessagesText.includes(normalizedQuote)
          ? normalizedQuote
          : null;
      const quoteRequired =
        FINANCIAL_ISSUE_RE.test(item.issue) || FINANCIAL_ISSUE_RE.test(item.context);
      const verified = quoteRequired
        ? Boolean(verifiedQuote)
        : Boolean(doneTaskCode || verifiedQuote);
      outcomes.push(
        verified
          ? {
              item,
              status: "resolved",
              evidence: verdict.evidence,
              taskCode: doneTaskCode,
              quote: verifiedQuote,
              question: null,
              downgraded: false,
            }
          : {
              item,
              status: "unclear",
              evidence: verdict.evidence,
              taskCode: null,
              quote: null,
              question: verdict.question ?? null,
              downgraded: true,
            },
      );
    }
  }

  const resolved: RefreshSummary["resolved"] = [];
  let stillOpen = 0;
  let unclear = 0;
  let downgraded = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "still_open") stillOpen += 1;
    if (outcome.status === "unclear") unclear += 1;
    if (outcome.downgraded) downgraded += 1;
    if (outcome.status !== "resolved") continue;
    resolved.push({
      issue: outcome.item.issue,
      kind: outcome.item.kind,
      evidence: outcome.evidence,
      taskCode: outcome.taskCode,
      quote: outcome.quote,
    });
  }
  // Team-answered issues this analysis still lists are closed too (no verdict).
  for (const outcome of forcedResolved) {
    resolved.push({
      issue: outcome.item.issue,
      kind: outcome.item.kind,
      evidence: outcome.evidence,
      taskCode: null,
      quote: null,
    });
  }

  // 6) Persist verified AI closures as the standard overlay events, citation
  //    included. recommendationIndex is informational (the read side keys by
  //    issue text); risks/accountability get offset indices so the number
  //    never collides with a real rec index. Forced (human-answered) closures
  //    persist through the same path so the read side folds them per analysis.
  const resolvedOutcomes = [
    ...outcomes.filter((outcome) => outcome.status === "resolved"),
    ...forcedResolved,
  ];
  if (resolvedOutcomes.length > 0) {
    const rows = resolvedOutcomes.map((outcome) => {
      const item = outcome.item;
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
          issue: item.issue,
          state: "resolved",
          source,
          kind: item.kind,
          evidence: outcome.evidence,
          taskCode: outcome.taskCode,
          quote: outcome.quote,
        },
      };
    });
    const { error: insertError } = await supabaseAdmin.from("ai_events").insert(rows);
    if (insertError) throw new Error(insertError.message);
  }

  // Every issue closed this pass — overlay closures (AI-verified + human-answered)
  // AND deterministic machine closures (a recommendation gone live-resolved, or a
  // complaint whose cited tasks are all done) — makes its pending question moot.
  const autoResolveIssues = [
    ...resolvedOutcomes.map((outcome) => outcome.item.issue),
    ...machineResolvedIssues,
  ];
  if (autoResolveIssues.length > 0) {
    await autoResolveOpenQuestions(orgId, clientId, autoResolveIssues);
  }

  // 7) Every unjudgeable item (including downgraded "resolved") becomes ONE
  //    open question for the team — the queue dedupes per issue and respects
  //    the 14-day re-ask cooldown after an answer.
  const questionsCreated = await createOpenQuestions(
    orgId,
    clientId,
    analysis.id as string,
    outcomes
      .filter((outcome) => outcome.status === "unclear")
      .map((outcome) => ({
        kind: outcome.item.kind,
        issue: outcome.item.issue,
        question: outcome.question,
        context: outcome.item.context || null,
        responsibleName: outcome.item.responsibleName,
        taskCodes: outcome.item.taskCodes,
      })),
  );

  await logAudit({
    organizationId: orgId,
    actorUserId: actorUserId ?? undefined,
    action: "satisfaction.status_refresh",
    entityType: "satisfaction_analysis",
    entityId: analysis.id as string,
    metadata: {
      clientId,
      source,
      checked: items.length,
      resolved: resolved.map((entry) => entry.issue),
      stillOpen,
      unclear,
      downgraded,
      questionsCreated,
      newMessageCount,
    },
  });

  return {
    checked: items.length,
    resolved,
    stillOpen,
    unclear,
    downgraded,
    questionsCreated,
    hadNewMessages,
    newMessageCount,
  };
}
