import { NextRequest, NextResponse } from "next/server";
import { getServerSession, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decodeFilterFromUrl } from "@/lib/custom-filter/url-state";
import { compileFilterTree } from "@/lib/custom-filter/postgrest";
import { getTaskField } from "@/lib/custom-filter/tasks-fields";
import {
  BALANCEABLE_PARTITIONS,
  GLOBAL_BOARD_LIMIT,
  LIST_LIMIT,
  PROJECT_BOARD_LIMIT,
} from "@/lib/data/tasks";
import {
  buildTaskFiltersFromParams,
  type TaskQueryParams,
} from "@/app/(dashboard)/tasks/_filter_params";
import {
  loadTaskBoardPageForGlobalView,
  loadTasksPageForGlobalView,
} from "@/app/(dashboard)/tasks/_loaders";

function clampPositiveInt(raw: string | null, fallback: number, max: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(n)));
}

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "tasks.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const query: TaskQueryParams & {
    projectId?: string;
    odooProjectId?: string;
    cf?: string;
  } = {
    view: sp.get("view") ?? undefined,
    f: sp.get("f") ?? undefined,
    d: sp.get("d") ?? undefined,
    filter: sp.get("filter") ?? undefined,
    q: sp.get("q") ?? undefined,
    sf: sp.get("sf") ?? undefined,
    groupBy: sp.get("groupBy") ?? undefined,
    projectId: sp.get("projectId") ?? undefined,
    odooProjectId: sp.get("odooProjectId") ?? undefined,
    cf: sp.get("cf") ?? undefined,
  };

  let resolvedProjectId = query.projectId;
  if (!resolvedProjectId && query.odooProjectId) {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("external_source", "odoo")
      .eq("external_id", query.odooProjectId)
      .maybeSingle();
    resolvedProjectId = data?.id;
  }

  const built = buildTaskFiltersFromParams(query, {
    userId: session.userId,
    employeeId: session.employeeId,
    projectId: resolvedProjectId,
  });
  const filters = { ...built.filters };

  const customTree = decodeFilterFromUrl(query.cf);
  if (customTree) {
    const compiled = compileFilterTree(customTree, (name) =>
      getTaskField(name, (k) => k),
    );
    if (compiled) {
      const { data, error } = await supabaseAdmin
        .from("tasks")
        .select("id")
        .eq("organization_id", session.orgId)
        .limit(5000)
        .or(compiled.clause);
      filters.customFilterTaskIds = error
        ? []
        : (data ?? []).map((r) => r.id as string);
    }
  }

  const mode = sp.get("mode") === "board" ? "board" : "list";
  const offset = clampPositiveInt(sp.get("offset"), 0, 100000);
  const fallbackLimit = mode === "board"
    ? (resolvedProjectId ? PROJECT_BOARD_LIMIT : GLOBAL_BOARD_LIMIT)
    : LIST_LIMIT;
  // Board "load more" in balanced mode grows the per-bucket cap, so allow a
  // larger ceiling than the flat 500.
  const limit = clampPositiveInt(sp.get("limit"), fallbackLimit, mode === "board" ? 2000 : 500);

  if (mode === "board") {
    // Balanced kanban: client passes the whitelisted partition field + a growing
    // per-bucket cap; we re-fetch the newest N per column and the client replaces
    // its board with the result. Reject unknown fields (defends the RPC whitelist).
    const partitionField = sp.get("partitionBy");
    const partitionCfg =
      partitionField && BALANCEABLE_PARTITIONS[partitionField]
        ? {
            by: BALANCEABLE_PARTITIONS[partitionField].field,
            limit: clampPositiveInt(
              sp.get("partitionLimit"),
              BALANCEABLE_PARTITIONS[partitionField].perBucket,
              500,
            ),
          }
        : null;
    const bundle = await loadTaskBoardPageForGlobalView(session.orgId, filters, {
      limit,
      offset,
      partition: partitionCfg,
    });
    return NextResponse.json({
      items: bundle.rows,
      totalCount: bundle.totalCount,
      offset,
      nextOffset: offset + bundle.rows.length,
      hasMore: offset + bundle.rows.length < bundle.totalCount,
    });
  }

  const bundle = await loadTasksPageForGlobalView(session.orgId, filters, {
    limit,
    offset,
  });
  return NextResponse.json({
    items: bundle.rows,
    totalCount: bundle.totalCount,
    offset,
    nextOffset: offset + bundle.rows.length,
    hasMore: offset + bundle.rows.length < bundle.totalCount,
  });
}
