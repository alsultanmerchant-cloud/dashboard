// Saudi Arabia runs on Asia/Riyadh (UTC+3, no DST), and the Rwasem/Odoo team
// reads every "today / deadline / overdue" boundary in Riyadh local time.
//
// Computing "today" from the raw UTC date (`new Date().toISOString().slice(0,10)`)
// lags a full day between 21:00–24:00 UTC — i.e. just after Riyadh midnight — so
// overdue counts under-report vs Rwasem (a task due "yesterday" still reads as
// not-yet-late). Always derive day-granular boundaries through this helper.

const RIYADH = "Asia/Riyadh";

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

/** `YYYY-MM-DD` for `n` days before today, in Asia/Riyadh. */
export function riyadhDaysAgoIso(n: number): string {
  const today = riyadhTodayIso();
  const [y, m, d] = today.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d) - n * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}
