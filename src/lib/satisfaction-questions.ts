import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getClientDisplayNameMap } from "@/lib/data/clients";

// ---- Questions queue ("أسئلة تحتاج إجابة") --------------------------------
// When the status-refresh pass can't judge a still-open finding (an `unclear`
// verdict, including a downgraded unverifiable "resolved"), it files ONE open
// question per (org, client, issue) here so a human can settle it. Answers are
// documented ground truth: outcome=resolved closes the issue everywhere via
// the standard overlay ai_event; outcome=still_open keeps it open and feeds
// the next AI passes. Rows live in `satisfaction_questions` (migration 0265),
// issue-keyed exactly like the resolution overlay.

export const FALLBACK_QUESTION =
  "هل ما زالت هذه المشكلة قائمة؟ لا يوجد دليل في الرسائل أو المهام على حلّها.";

// An answered issue stays quiet this long before the AI may re-ask about it.
const REASK_COOLDOWN_DAYS = 14;

export type SatisfactionQuestionKind =
  | "recommendation"
  | "risk"
  | "accountability"
  | "indicator";

export interface SatisfactionQuestionDraft {
  kind: SatisfactionQuestionKind;
  issue: string;
  question: string | null;
  context: string | null;
  responsibleName: string | null;
  taskCodes: string[];
}

interface QuestionDedupRow {
  issue: string;
  status: string;
  answered_at: string | null;
}

// Insert open questions for a client, skipping issues that (a) already have an
// open question or (b) were answered within the cooldown window. The caller is
// expected to have excluded overlay-resolved issues already (the refresh pass
// never builds items for them). Failures degrade to zero created — a question
// insert must never fail the refresh that produced it.
export async function createOpenQuestions(
  orgId: string,
  clientId: string,
  analysisId: string | null,
  drafts: SatisfactionQuestionDraft[],
): Promise<number> {
  const byIssue = new Map<string, SatisfactionQuestionDraft>();
  for (const draft of drafts) {
    if (draft.issue.trim() && !byIssue.has(draft.issue)) byIssue.set(draft.issue, draft);
  }
  if (byIssue.size === 0) return 0;

  // Issue texts are long Arabic sentences — filter in JS instead of an `in`
  // filter so no text ever needs PostgREST quoting.
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("satisfaction_questions")
    .select("issue, status, answered_at")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .in("status", ["open", "answered"]);
  if (existingError) {
    console.error("[satisfaction_questions_lookup_failed]", existingError.message);
    return 0;
  }
  const cooldownSinceIso = new Date(
    Date.now() - REASK_COOLDOWN_DAYS * 86_400_000,
  ).toISOString();
  const blocked = new Set<string>();
  for (const row of (existing ?? []) as QuestionDedupRow[]) {
    if (row.status === "open") blocked.add(row.issue);
    else if (row.answered_at && row.answered_at >= cooldownSinceIso) blocked.add(row.issue);
  }

  const rows = [...byIssue.values()]
    .filter((draft) => !blocked.has(draft.issue))
    .map((draft) => ({
      organization_id: orgId,
      client_id: clientId,
      analysis_id: analysisId,
      kind: draft.kind,
      issue: draft.issue,
      question: draft.question?.trim() || FALLBACK_QUESTION,
      context: draft.context?.trim() || null,
      responsible_name: draft.responsibleName,
      task_codes: draft.taskCodes,
    }));
  if (rows.length === 0) return 0;

  // Insert row-by-row: the partial unique index on md5(issue) can't be targeted
  // by a PostgREST upsert, and a single 23505 (a concurrent manual تحديث racing
  // the nightly cron on the same issue) would abort a batch INSERT and silently
  // drop every OTHER question in it. Per-row, a duplicate is an expected skip
  // and the rest still land; `created` counts only what actually inserted.
  let created = 0;
  for (const row of rows) {
    const { error: insertError } = await supabaseAdmin
      .from("satisfaction_questions")
      .insert(row);
    if (!insertError) {
      created += 1;
      continue;
    }
    // 23505 = a concurrent pass filed the same open question first — expected.
    if (insertError.code === "23505") continue;
    console.error("[satisfaction_questions_insert_failed]", insertError.message);
  }
  return created;
}

// Issues this client's team has answered as `resolved`. These are documented
// ground truth: a later analysis that still lists such an issue should be
// closed against it too (the read side folds the overlay per CURRENT analysis,
// so a fresh analysis needs its own event). Degrades to an empty set on error.
export async function getHumanResolvedIssues(
  orgId: string,
  clientId: string,
): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("satisfaction_questions")
    .select("issue, answer_outcome, status")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .eq("status", "answered")
    .eq("answer_outcome", "resolved");
  if (error) {
    console.error("[satisfaction_questions_resolved_lookup_failed]", error.message);
    return new Set();
  }
  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ issue: string }>) {
    if (row.issue?.trim()) out.add(row.issue);
  }
  return out;
}

// When an issue becomes overlay-resolved (AI refresh, manual button, human
// answer), its open questions are moot — close them as auto_resolved. Ids are
// resolved first so long issue texts never ride in a PostgREST filter.
export async function autoResolveOpenQuestions(
  orgId: string,
  clientId: string,
  issues: string[],
): Promise<void> {
  const wanted = new Set(issues.filter((issue) => issue.trim()));
  if (wanted.size === 0) return;
  const { data, error } = await supabaseAdmin
    .from("satisfaction_questions")
    .select("id, issue")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .eq("status", "open");
  if (error) {
    console.error("[satisfaction_questions_auto_resolve_failed]", error.message);
    return;
  }
  const ids = ((data ?? []) as Array<{ id: string; issue: string }>)
    .filter((row) => wanted.has(row.issue))
    .map((row) => row.id);
  if (ids.length === 0) return;
  const { error: updateError } = await supabaseAdmin
    .from("satisfaction_questions")
    .update({ status: "auto_resolved" })
    .in("id", ids);
  if (updateError) {
    console.error("[satisfaction_questions_auto_resolve_failed]", updateError.message);
  }
}

// ---- Answers as AI memory --------------------------------------------------

interface AnsweredMemoryRow {
  issue: string;
  question: string;
  answer: string | null;
  answer_outcome: "resolved" | "still_open" | null;
  answered_at: string | null;
}

// Human answers are documented ground truth for every later AI pass: both the
// status refresh and the full re-analysis inject this block so the model never
// contradicts what the team already settled. Mirrors buildKnowledgeBlock —
// returns "" when there is nothing to say, and degrades to "" on error so a
// memory lookup can never fail the analysis that asked for it.
export async function buildAnsweredQuestionsBlock(
  orgId: string,
  clientId: string,
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("satisfaction_questions")
    .select("issue, question, answer, answer_outcome, answered_at")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .eq("status", "answered")
    .order("answered_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[satisfaction_questions_memory_failed]", error.message);
    return "";
  }
  const rows = ((data ?? []) as AnsweredMemoryRow[]).filter(
    (row) => row.answer_outcome && row.answered_at,
  );
  if (rows.length === 0) return "";
  const lines = rows
    .map((row) => {
      const label = row.answer_outcome === "resolved" ? "تم الحل" : "ما زالت قائمة";
      return `[${(row.answered_at as string).slice(0, 10)}] بشأن: ${row.issue} — س: ${row.question} — ج: ${label}: ${row.answer ?? ""}`;
    })
    .join("\n");
  return `إجابات موثّقة من فريق العمل (تعامل معها كحقائق):
- بند أجاب عنه الفريق بأنه «ما زالت قائمة» لا يُعتبر محلولًا إلا بدليل جديد تاريخه بعد تاريخ الإجابة.
- لا تناقض أبدًا إجابة بشرية بأن المشكلة «تم الحل»، ولا تُعِد رصد نفس المشكلة إلا بدليل أحدث يناقضها صراحةً.
${lines}`;
}

// ---- Read side (page + GET API) -------------------------------------------

export interface SatisfactionQuestionTaskRef {
  code: string;
  id: string;
  title: string | null;
}

export interface SatisfactionQuestionRow {
  id: string;
  clientId: string;
  clientName: string;
  analysisId: string | null;
  kind: SatisfactionQuestionKind;
  issue: string;
  question: string;
  context: string | null;
  responsibleName: string | null;
  tasks: SatisfactionQuestionTaskRef[];
  status: "open" | "answered" | "auto_resolved" | "dismissed";
  answer: string | null;
  answerOutcome: "resolved" | "still_open" | null;
  answeredAt: string | null;
  createdAt: string;
}

export interface SatisfactionQuestionsData {
  open: SatisfactionQuestionRow[];
  answered: SatisfactionQuestionRow[];
}

interface QuestionDbRow {
  id: string;
  client_id: string;
  analysis_id: string | null;
  kind: SatisfactionQuestionKind;
  issue: string;
  question: string;
  context: string | null;
  responsible_name: string | null;
  task_codes: string[] | null;
  status: SatisfactionQuestionRow["status"];
  answer: string | null;
  answer_outcome: "resolved" | "still_open" | null;
  answered_at: string | null;
  created_at: string;
}

const QUESTION_COLUMNS =
  "id, client_id, analysis_id, kind, issue, question, context, responsible_name, task_codes, status, answer, answer_outcome, answered_at, created_at";

// Open questions plus the last 30 days of answered ones, with contract-book
// display names and task_codes resolved to real task rows for /tasks/[id] links.
export async function listSatisfactionQuestions(
  orgId: string,
): Promise<SatisfactionQuestionsData> {
  const answeredSinceIso = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [openRes, answeredRes, nameMap] = await Promise.all([
    supabaseAdmin
      .from("satisfaction_questions")
      .select(QUESTION_COLUMNS)
      .eq("organization_id", orgId)
      .eq("status", "open")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("satisfaction_questions")
      .select(QUESTION_COLUMNS)
      .eq("organization_id", orgId)
      .eq("status", "answered")
      .gte("answered_at", answeredSinceIso)
      .order("answered_at", { ascending: false }),
    getClientDisplayNameMap(orgId),
  ]);
  if (openRes.error) throw new Error(openRes.error.message);
  if (answeredRes.error) throw new Error(answeredRes.error.message);
  const openRows = (openRes.data ?? []) as QuestionDbRow[];
  const answeredRows = (answeredRes.data ?? []) as QuestionDbRow[];
  const all = [...openRows, ...answeredRows];

  // Merged sheet twins are absent from the display-name map — fall back to the
  // raw client row so a question never shows with no name.
  const missingNameIds = [
    ...new Set(all.map((row) => row.client_id).filter((id) => !nameMap.has(id))),
  ];
  const fallbackNames = new Map<string, string>();
  if (missingNameIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("clients")
      .select("id, name")
      .eq("organization_id", orgId)
      .in("id", missingNameIds);
    for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
      fallbackNames.set(row.id, row.name);
    }
  }

  const allCodes = [
    ...new Set(
      all.flatMap((row) => row.task_codes ?? []).map((code) => code.trim().toUpperCase()),
    ),
  ].filter(Boolean);
  const tasksByCode = new Map<string, SatisfactionQuestionTaskRef>();
  if (allCodes.length > 0) {
    const { data } = await supabaseAdmin
      .from("tasks")
      .select("id, task_code, title")
      .eq("organization_id", orgId)
      .in("task_code", allCodes);
    for (const row of (data ?? []) as Array<{
      id: string;
      task_code: string | null;
      title: string | null;
    }>) {
      if (row.task_code) {
        tasksByCode.set(row.task_code.toUpperCase(), {
          code: row.task_code,
          id: row.id,
          title: row.title,
        });
      }
    }
  }

  const toRow = (row: QuestionDbRow): SatisfactionQuestionRow => ({
    id: row.id,
    clientId: row.client_id,
    clientName: nameMap.get(row.client_id) ?? fallbackNames.get(row.client_id) ?? "—",
    analysisId: row.analysis_id,
    kind: row.kind,
    issue: row.issue,
    question: row.question,
    context: row.context,
    responsibleName: row.responsible_name,
    tasks: (row.task_codes ?? [])
      .map((code) => tasksByCode.get(code.trim().toUpperCase()))
      .filter((task): task is SatisfactionQuestionTaskRef => Boolean(task)),
    status: row.status,
    answer: row.answer,
    answerOutcome: row.answer_outcome,
    answeredAt: row.answered_at,
    createdAt: row.created_at,
  });

  return { open: openRows.map(toRow), answered: answeredRows.map(toRow) };
}
