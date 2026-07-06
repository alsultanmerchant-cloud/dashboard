// Saudi Arabia runs on Asia/Riyadh (UTC+3, no DST), and the Rwasem/Odoo team
// reads every "today / deadline / overdue" boundary in Riyadh local time.
//
// Computing "today" from the raw UTC date (`new Date().toISOString().slice(0,10)`)
// lags a full day between 21:00–24:00 UTC — i.e. just after Riyadh midnight — so
// overdue counts under-report vs Rwasem (a task due "yesterday" still reads as
// not-yet-late). Always derive day-granular boundaries through this helper.

const RIYADH = "Asia/Riyadh";
const RIYADH_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

function parseIsoDate(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day };
}

/** Today's date in Asia/Riyadh as `YYYY-MM-DD`. */
export function riyadhTodayIso(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The Asia/Riyadh calendar date (`YYYY-MM-DD`) of a given instant. */
export function riyadhDateOf(instant: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

/** `YYYY-MM-DD` for `n` days before today, in Asia/Riyadh. */
export function riyadhDaysAgoIso(n: number): string {
  const today = riyadhTodayIso();
  const [y, m, d] = today.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d) - n * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}

/** UTC instant for the start of a Riyadh calendar day. */
export function riyadhStartOfDayUtcIso(isoDate: string): string {
  const { year, month, day } = parseIsoDate(isoDate);
  return new Date(Date.UTC(year, month - 1, day) - RIYADH_UTC_OFFSET_MS).toISOString();
}

/** Exclusive UTC instant immediately after a Riyadh calendar day. */
export function riyadhNextDayStartUtcIso(isoDate: string): string {
  const { year, month, day } = parseIsoDate(isoDate);
  return new Date(Date.UTC(year, month - 1, day + 1) - RIYADH_UTC_OFFSET_MS).toISOString();
}

/** Inclusive Riyadh date range expressed as UTC bounds for timestamptz queries. */
export function riyadhDateRangeUtcBounds(
  from: string,
  to: string,
): { start: string; endExclusive: string } {
  return {
    start: riyadhStartOfDayUtcIso(from),
    endExclusive: riyadhNextDayStartUtcIso(to),
  };
}
