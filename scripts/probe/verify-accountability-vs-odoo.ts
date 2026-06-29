// Audit: does the accountability data (Supabase mirror) match live Odoo?
// Checks (1) freshness, (2) per-task stage-history fidelity, (3) assignees,
// (4) stage + deadline — on a sample of accountability-relevant tasks.
import { OdooClient } from "@/lib/odoo/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ODOO_STAGE: Record<string, string> = {
  "in progress": "in_progress", "قيد التنفيذ": "in_progress",
  "specialist review": "specialist_review", "مراجعة المتخصص": "specialist_review",
  "manager review": "manager_review", "مراجعة المدير": "manager_review",
  "ready to send": "ready_to_send", "جاهزة للارسال": "ready_to_send", "جاهزة للإرسال": "ready_to_send",
  "sent to client": "sent_to_client", "أرسلت للعميل": "sent_to_client", "ارسلت للعميل": "sent_to_client",
  "client changes": "client_changes", "تعديلات العميل": "client_changes",
  "new": "new", "جديدة": "new", "done": "done", "مكتملة": "done",
};
const norm = (s: string) => ODOO_STAGE[(s || "").trim().toLowerCase()] ?? null;

const c = new OdooClient({
  url: process.env.ODOO_URL!, db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!, password: process.env.ODOO_PASSWORD!,
});
await c.authenticate();

// stage_id -> dashboard enum
const stages = await c.searchRead<{ id: number; name: string }>("project.task.type", [], ["id", "name"], { limit: 2000 });
const stageEnum = new Map<number, string | null>();
for (const s of stages) stageEnum.set(s.id, norm(s.name));

// ---- 1. FRESHNESS -------------------------------------------------------
const odooActive = await c.executeKw<number>("project.task", "search_count", [[["active", "=", true]]], {});
const latest = await c.searchRead<{ id: number; write_date: string }>("project.task", [["active", "=", true]], ["id", "write_date"], { limit: 1, order: "write_date desc" });
const { count: sbTasks } = await supabaseAdmin.from("tasks").select("id", { count: "exact", head: true }).eq("external_source", "odoo").is("archived_at", null);
console.log(JSON.stringify({ check: "freshness", odoo_active_tasks: odooActive, supabase_odoo_live_tasks: sbTasks, odoo_latest_write: latest[0]?.write_date }, null, 2));

// ---- pick a sample of accountability-relevant tasks --------------------
const today = new Date().toISOString().slice(0, 10);
const { data: sampleTasks } = await supabaseAdmin
  .from("tasks")
  .select("id, external_id, task_code, title, stage, planned_date")
  .eq("external_source", "odoo").is("archived_at", null)
  .or(`and(stage.not.in.(done,new),planned_date.lt.${today}),stage.eq.manager_review,stage.eq.specialist_review`)
  .limit(15);
const tasks = sampleTasks ?? [];
const extIds = tasks.map((t) => Number(t.external_id)).filter(Number.isFinite);

// Odoo task facts
const odooTasks = await c.searchRead<{ id: number; stage_id: [number, string] | false; date_deadline: string | false; user_ids: number[] }>(
  "project.task", [["id", "in", extIds]], ["id", "stage_id", "date_deadline", "user_ids"], { limit: 100 });
const odooTaskById = new Map(odooTasks.map((t) => [t.id, t]));

// Odoo stage history for the sample
const odooHist = await c.searchRead<{ task_id: [number, string] | false; stage_id: [number, string] | false; stage_in_date: string | false }>(
  "task.stage.time", [["task_id", "in", extIds]], ["task_id", "stage_id", "stage_in_date"], { limit: 5000, order: "task_id, stage_in_date" });
const odooHistByTask = new Map<number, string[]>();
for (const h of odooHist) {
  const tid = Array.isArray(h.task_id) ? h.task_id[0] : null;
  const sid = Array.isArray(h.stage_id) ? h.stage_id[0] : null;
  if (tid == null || sid == null) continue;
  const e = stageEnum.get(sid);
  if (!e) continue;
  const arr = odooHistByTask.get(tid) ?? [];
  arr.push(e);
  odooHistByTask.set(tid, arr);
}

// ---- 2/3/4. per-task comparison ---------------------------------------
const results: Record<string, unknown>[] = [];
for (const t of tasks) {
  const ext = Number(t.external_id);
  const ot = odooTaskById.get(ext);
  // Supabase stage history (workflow stages only)
  const { data: sbHist } = await supabaseAdmin
    .from("task_stage_history").select("to_stage, entered_at").eq("task_id", t.id).order("entered_at");
  const sbStages = (sbHist ?? []).map((h) => h.to_stage).filter((s) => s !== "new");
  const odStages = (odooHistByTask.get(ext) ?? []).filter((s) => s !== "new");
  // Supabase assignees (agent employee external ids)
  const { data: sbAsg } = await supabaseAdmin
    .from("task_assignees").select("role_type, employee:employee_profiles!task_assignees_employee_id_fkey(external_id)").eq("task_id", t.id);
  const sbAgentExt = new Set((sbAsg ?? []).filter((a) => a.role_type === "agent").map((a: { employee?: { external_id?: string } | null }) => a.employee?.external_id).filter(Boolean));
  const odUsers = new Set((ot?.user_ids ?? []).map(String));
  const odStageEnum = ot && Array.isArray(ot.stage_id) ? stageEnum.get(ot.stage_id[0]) : null;
  const odDeadline = ot && ot.date_deadline ? String(ot.date_deadline).slice(0, 10) : null;

  results.push({
    task: t.task_code,
    inOdoo: !!ot,
    stage_match: t.stage === odStageEnum,
    sb_stage: t.stage, odoo_stage: odStageEnum,
    deadline_match: (t.planned_date ?? null) === odDeadline,
    sb_deadline: t.planned_date, odoo_deadline: odDeadline,
    stageHist_countMatch: sbStages.length === odStages.length,
    sb_histN: sbStages.length, odoo_histN: odStages.length,
    stageHist_seqMatch: JSON.stringify(sbStages) === JSON.stringify(odStages),
    assignee_overlap: [...sbAgentExt].filter((x) => odUsers.has(x as string)).length,
    sb_agentN: sbAgentExt.size, odoo_userN: odUsers.size,
  });
}
console.log(JSON.stringify({ check: "per_task", n: results.length, results }, null, 2));

// summary
const ok = (k: string) => results.filter((r) => r[k] === true).length;
console.log(JSON.stringify({
  check: "SUMMARY", sample: results.length,
  inOdoo: results.filter((r) => r.inOdoo).length,
  stage_match: ok("stage_match"),
  deadline_match: ok("deadline_match"),
  stageHist_countMatch: ok("stageHist_countMatch"),
  stageHist_seqMatch: ok("stageHist_seqMatch"),
}, null, 2));
