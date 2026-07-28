import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  querySlaLateRows,
  SLA_STAGE_LABEL,
} from "@/lib/data/ceo-brief-signals";
import { listOverdueInstallmentRows } from "@/lib/brief/data";
import { getSatisfactionRows, getAtRiskClients, isClientAtRisk } from "@/lib/data/satisfaction";
import { riyadhDaysAgoIso } from "@/lib/tz";

export const runtime = "nodejs";
export const maxDuration = 30;

// =========================================================================
// CEO brief — evidence breakdowns for the "التفاصيل" modal.
//
// Every number in the brief is code-computed; this route lists the ROWS behind
// each one, lazily, on modal open. Each kind reuses the exact producer of its
// headline number (querySlaLateRows / listOverdueInstallmentRows / the
// satisfaction at-risk predicate), so the count and its breakdown cannot
// diverge. Responses are a dumb generic table the client renders as-is —
// Arabic labels built here, same convention as the brief's risk metrics.
// =========================================================================

interface EvidenceRow {
  id: string;
  href: string | null;
  cells: string[];
}

interface EvidenceTable {
  columns: string[];
  rows: EvidenceRow[];
  note?: string;
}

const MAX_ROWS = 100;

const businessHours = (minutes: number) => `${Math.round(minutes / 60)} ساعة عمل`;

const capNote = (total: number) =>
  total > MAX_ROWS ? `يعرض أول ${MAX_ROWS} من ${total} صفًا` : undefined;

async function slaLateTable(
  orgId: string,
  opts: { projectId?: string; clientId?: string; newOnly?: boolean },
): Promise<EvidenceTable> {
  const all = await querySlaLateRows(orgId, opts);
  // "منذ الأمس" in the digest = breach younger than ~1 working day (480 business
  // minutes of excess) — same cutoff loadSlaLate uses for newToday.
  const rows = opts.newOnly ? all.filter((r) => r.excess_min <= 480) : all;
  return {
    columns: ["المهمة", "العميل", "المرحلة", "تجاوز المهلة بـ"],
    rows: rows.slice(0, MAX_ROWS).map((r) => ({
      id: r.task_id,
      href: `/tasks/${r.task_id}`,
      cells: [
        [r.task_code, r.title].filter(Boolean).join(" · ") || "مهمة",
        r.client_name ?? "—",
        SLA_STAGE_LABEL[r.stage] ?? r.stage,
        businessHours(r.excess_min),
      ],
    })),
    note: capNote(rows.length),
  };
}

async function overdueMoneyTable(orgId: string): Promise<EvidenceTable> {
  const rows = await listOverdueInstallmentRows(orgId);
  const fmt = (n: number) => `${Math.round(n).toLocaleString("en-US")} ريال`;
  return {
    columns: ["العميل", "العقد", "المبلغ", "استحقت في", "الحالة"],
    rows: rows.slice(0, MAX_ROWS).map((r, i) => ({
      id: `${r.contractId}-${i}`,
      href: r.contractId ? `/contracts/${r.contractId}` : null,
      cells: [
        r.clientName,
        r.contractCode ?? "—",
        fmt(r.amount),
        r.expectedDate ?? "—",
        r.collectedDate ? `حُصِّلت ${r.collectedDate} ✅` : "لم تُحصَّل",
      ],
    })),
    note: capNote(rows.length),
  };
}

async function clientChurnTable(orgId: string): Promise<EvidenceTable> {
  // Same population as the risk card: ACTIVE clients (live project) whose AI
  // satisfaction is negative or < 55 — getSatisfactionRows + isClientAtRisk.
  const [satRows, satRisk] = await Promise.all([
    getSatisfactionRows(orgId),
    getAtRiskClients(orgId).catch(() => []),
  ]);
  const riskTextById = new Map(satRisk.map((c) => [c.clientId, c.topRisk] as const));
  const atRisk = satRows
    .filter((r) => r.hasActiveProject && isClientAtRisk(r.satisfactionScore, r.sentiment))
    .sort((a, b) => (a.satisfactionScore ?? 100) - (b.satisfactionScore ?? 100));
  const sentimentAr: Record<string, string> = {
    negative: "سلبي",
    neutral: "محايد",
    positive: "إيجابي",
  };
  return {
    columns: ["العميل", "الرضا", "الانطباع", "أبرز خطر"],
    rows: atRisk.slice(0, MAX_ROWS).map((r) => ({
      id: r.clientId,
      href: `/satisfaction?client=${r.clientId}`,
      cells: [
        r.clientName,
        r.satisfactionScore != null ? `${r.satisfactionScore}/100` : "—",
        (r.sentiment && sentimentAr[r.sentiment]) ?? r.sentiment ?? "—",
        riskTextById.get(r.clientId) ?? "—",
      ],
    })),
    note: capNote(atRisk.length),
  };
}

async function doneTable(orgId: string): Promise<EvidenceTable> {
  const yesterday = riyadhDaysAgoIso(1);
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(
      "id, task_code, title, actual_done_date, project:projects!inner(client:clients(name))",
    )
    .eq("organization_id", orgId)
    .eq("stage", "done")
    .is("archived_at", null)
    .gte("actual_done_date", yesterday)
    .order("actual_done_date", { ascending: false })
    .limit(MAX_ROWS + 1);
  if (error) throw new Error(error.message);
  type Row = {
    id: string;
    task_code: string | null;
    title: string | null;
    actual_done_date: string | null;
    project:
      | { client: { name: string } | { name: string }[] | null }
      | { client: { name: string } | { name: string }[] | null }[]
      | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  return {
    columns: ["المهمة", "العميل", "أُنجزت في"],
    rows: rows.slice(0, MAX_ROWS).map((r) => {
      const p = Array.isArray(r.project) ? r.project[0] : r.project;
      const client = Array.isArray(p?.client) ? p?.client[0] : p?.client;
      return {
        id: r.id,
        href: `/tasks/${r.id}`,
        cells: [
          [r.task_code, r.title].filter(Boolean).join(" · ") || "مهمة",
          client?.name ?? "—",
          r.actual_done_date ?? "—",
        ],
      };
    }),
    note: rows.length > MAX_ROWS ? `يعرض أول ${MAX_ROWS} صف` : undefined,
  };
}

async function collectedTable(orgId: string): Promise<EvidenceTable> {
  const yesterday = riyadhDaysAgoIso(1);
  const { data, error } = await supabaseAdmin
    .from("installments")
    .select(
      "id, actual_amount, actual_date, contract:contracts!inner(id, contract_code, client:clients(name))",
    )
    .eq("organization_id", orgId)
    .gte("actual_date", yesterday)
    .gt("actual_amount", 0)
    .order("actual_amount", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new Error(error.message);
  type Row = {
    id: string;
    actual_amount: number | string | null;
    actual_date: string | null;
    contract:
      | { id: string; contract_code: string | null; client: { name: string } | { name: string }[] | null }
      | { id: string; contract_code: string | null; client: { name: string } | { name: string }[] | null }[]
      | null;
  };
  return {
    columns: ["العميل", "العقد", "المبلغ", "تاريخ التحصيل"],
    rows: ((data ?? []) as Row[]).map((r) => {
      const c = Array.isArray(r.contract) ? r.contract[0] : r.contract;
      const client = Array.isArray(c?.client) ? c?.client[0] : c?.client;
      return {
        id: r.id,
        href: c?.id ? `/contracts/${c.id}` : null,
        cells: [
          client?.name ?? "—",
          c?.contract_code ?? "—",
          `${Math.round(Number(r.actual_amount) || 0).toLocaleString("en-US")} ريال`,
          r.actual_date ?? "—",
        ],
      };
    }),
  };
}

async function complaintsTable(orgId: string): Promise<EvidenceTable> {
  // Mirrors the digest item's population: client-group complaints/escalations
  // from current satisfaction analyses within the last 2 days (Riyadh).
  const twoDaysAgo = riyadhDaysAgoIso(2);
  const { data, error } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("id, client_id, created_at, highlights, client:clients!inner(name)")
    .eq("organization_id", orgId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  type Highlight = { type?: string; audience?: string | null; text?: string; date?: string | null };
  type Row = {
    id: string;
    client_id: string;
    created_at: string;
    highlights: Highlight[] | null;
    client: { name: string } | { name: string }[] | null;
  };
  const rows: EvidenceRow[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    const client = Array.isArray(r.client) ? r.client[0] : r.client;
    for (const [i, h] of (r.highlights ?? []).entries()) {
      const text = (h.text ?? "").trim();
      const type = h.type ?? "request";
      const audience = h.audience ?? "client";
      const date = h.date ?? r.created_at.slice(0, 10);
      if (!text) continue;
      if (audience === "team") continue;
      if (type !== "complaint" && type !== "escalation") continue;
      if (date < twoDaysAgo) continue;
      rows.push({
        id: `${r.id}-${i}`,
        href: `/satisfaction?client=${r.client_id}`,
        cells: [client?.name ?? "—", text, date.slice(0, 10)],
      });
    }
  }
  rows.sort((a, b) => (b.cells[2] ?? "").localeCompare(a.cells[2] ?? ""));
  return { columns: ["العميل", "الملاحظة", "التاريخ"], rows: rows.slice(0, MAX_ROWS) };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.orgId;

  const kind = request.nextUrl.searchParams.get("kind") ?? "";
  const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined;
  const clientId = request.nextUrl.searchParams.get("clientId") ?? undefined;

  try {
    let table: EvidenceTable;
    switch (kind) {
      case "sla_late":
        table = await slaLateTable(orgId, { projectId, clientId });
        break;
      case "sla_late_new":
        table = await slaLateTable(orgId, { newOnly: true });
        break;
      case "overdue_money":
        table = await overdueMoneyTable(orgId);
        break;
      case "client_churn":
        table = await clientChurnTable(orgId);
        break;
      case "done":
        table = await doneTable(orgId);
        break;
      case "collected":
        table = await collectedTable(orgId);
        break;
      case "complaints":
        table = await complaintsTable(orgId);
        break;
      default:
        return NextResponse.json({ error: "نوع تفاصيل غير معروف" }, { status: 400 });
    }
    return NextResponse.json(table);
  } catch (e) {
    console.error(`[ceo-brief.evidence] ${kind} failed:`, e);
    return NextResponse.json({ error: "تعذّر تحميل التفاصيل" }, { status: 500 });
  }
}
