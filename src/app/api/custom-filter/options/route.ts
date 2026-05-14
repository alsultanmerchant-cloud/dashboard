import { NextRequest, NextResponse } from "next/server";
import { getServerSession, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Generic relational autocomplete for the custom-filter dialog. The picker
// component calls this with `?model=<slug>&q=<text>&ids=<csv>` —
// returning either the matching records (for the open dropdown) or the
// already-selected records (so chips can render their labels on first paint
// without an extra round-trip).
//
// Each model is whitelisted here so a malformed `?model=` from the URL can't
// be used to read arbitrary tables.

type OptionRow = { id: string; label: string; sublabel?: string | null };

type ModelConfig = {
  table: string;
  permission: string;
  // Columns to search with ILIKE. First column is also the label.
  searchColumns: string[];
  // Column projected as the display sublabel (e.g. job title) — optional.
  sublabelColumn?: string;
};

const MODELS: Record<string, ModelConfig> = {
  employee: {
    table: "employee_profiles",
    permission: "projects.view",
    searchColumns: ["full_name"],
    sublabelColumn: "job_title",
  },
  client: {
    table: "clients",
    permission: "projects.view",
    searchColumns: ["name"],
    sublabelColumn: "contact_name",
  },
  service: {
    table: "services",
    permission: "projects.view",
    searchColumns: ["name", "slug"],
  },
  project: {
    table: "projects",
    permission: "projects.view",
    searchColumns: ["name"],
  },
};

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const modelSlug = request.nextUrl.searchParams.get("model") ?? "";
  const config = MODELS[modelSlug];
  if (!config) {
    return NextResponse.json({ error: `Unknown model: ${modelSlug}` }, { status: 400 });
  }
  if (!hasPermission(session, config.permission)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const idsParam = request.nextUrl.searchParams.get("ids")?.trim() ?? "";
  const idList = idsParam ? idsParam.split(",").filter(Boolean) : [];

  // First column is the label.
  const labelCol = config.searchColumns[0];
  // PostgREST aliasing syntax is `alias:column` (no spaces). Using
  // "column as alias" gets parsed as a literal column name.
  const select = [
    "id",
    `label:${labelCol}`,
    config.sublabelColumn ? `sublabel:${config.sublabelColumn}` : null,
  ]
    .filter(Boolean)
    .join(",");

  // If `ids` is provided, resolve those records (chip rehydration).
  if (idList.length > 0 && !q) {
    const { data, error } = await supabaseAdmin
      .from(config.table)
      .select(select)
      .eq("organization_id", session.orgId)
      .in("id", idList)
      .limit(idList.length);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ items: (data as unknown as OptionRow[]) ?? [] });
  }

  // Otherwise build a search query across `searchColumns`.
  let query = supabaseAdmin
    .from(config.table)
    .select(select)
    .eq("organization_id", session.orgId)
    .limit(10);

  if (q) {
    // PostgREST `or=` with multiple ilike conditions.
    const orClause = config.searchColumns
      .map((col) => `${col}.ilike.*${q.replace(/[*,()]/g, "")}*`)
      .join(",");
    query = query.or(orClause);
  }

  // Order by label for stable result lists.
  query = query.order(labelCol, { ascending: true, nullsFirst: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: (data as unknown as OptionRow[]) ?? [] });
}
