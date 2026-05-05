// Date / number formatters scoped to the agency app.
//
// IMPORTANT: All numbers in this app are rendered with **Latin digits (0-9)**
// regardless of UI language, per product decision. We achieve that by appending
// the Unicode `-u-nu-latn` extension to whatever locale is in use — Arabic
// month names + Latin digits, English month names + Latin digits.

/**
 * Force Latin digits on any locale tag. Pass a BCP-47 locale (e.g. `ar`,
 * `ar-SA`, `en`, `en-US`) and get back the same locale with `-u-nu-latn`
 * appended (or merged) so `Intl.*Format` emits 0-9 instead of ٠-٩.
 */
export function intlLocale(locale: string): string {
  // Already has a `-u-nu-…` numbering subtag → trust the caller.
  if (/-u-.*nu-/.test(locale)) return locale;
  // Already has a `-u-` extension → just append `nu-latn`.
  if (locale.includes("-u-")) return `${locale}-nu-latn`;
  return `${locale}-u-nu-latn`;
}

/**
 * Format a number with Latin digits using the given UI locale's grouping.
 * If you want a hard-coded locale (e.g. always Arabic month names), pass it.
 */
export function formatNumber(
  value: number,
  locale: string = "en-US",
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

export function formatArabicDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(intlLocale("ar-SA"), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export function formatArabicDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(intlLocale("ar-SA"), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatArabicShortDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(intlLocale("ar-SA"), {
    month: "short",
    day: "numeric",
  }).format(d);
}

export function relativeTimeAr(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale("ar-SA"), { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), "month");
  return rtf.format(Math.round(diffSec / 31536000), "year");
}

export function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().setHours(0, 0, 0, 0));
}
