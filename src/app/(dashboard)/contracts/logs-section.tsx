import {
  listSheetLogManagers,
  listSheetLogs,
  type SheetLogFilters,
} from "@/lib/data/contracts";
import { LogsView } from "./logs-view";

function param(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const value = searchParams[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function LogsSection({
  orgId,
  searchParams,
}: {
  orgId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const logType = param(searchParams, "logType");
  const from = param(searchParams, "from");
  const to = param(searchParams, "to");
  // `to` arrives as a bare YYYY-MM-DD (midnight). The data layer does
  // lte("log_time", to), so without this the selected end-day is fully
  // excluded. Extend to end-of-day for the query; the view keeps the raw
  // YYYY-MM-DD for the <input type="date"> value.
  const toForQuery = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to;
  const filters: SheetLogFilters = {
    logTypes: logType
      ? logType
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined,
    accountManager: param(searchParams, "am"),
    search: param(searchParams, "q"),
    from,
    to,
  };

  const [rows, managers] = await Promise.all([
    listSheetLogs(orgId, { ...filters, to: toForQuery }),
    listSheetLogManagers(orgId),
  ]);

  return <LogsView rows={rows} managers={managers} filters={filters} />;
}
