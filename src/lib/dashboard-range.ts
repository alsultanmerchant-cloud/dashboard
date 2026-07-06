// Dashboard date-range model — single source of truth for the CEO dashboard's
// global "between X and Y" window (Phase 2).
//
// Every windowed task-metric fetcher takes a DashboardRange so the number it
// shows is explicitly scoped to a declared period (the original ask: "this
// analysis runs on data between these dates"). Snapshot cards (overdue, WIP)
// are point-in-time and use range.to as their "as of" date.
//
// Pure module (no server-only / no React) so it can be imported by both the
// server page and the client picker.

import { riyadhDateOf } from "@/lib/tz";

export type RangePreset = "last_7" | "last_30" | "last_90" | "this_month" | "custom";

export interface DashboardRange {
  /** inclusive start, YYYY-MM-DD */
  from: string;
  /** inclusive end, YYYY-MM-DD (defaults to today) */
  to: string;
  preset: RangePreset;
  /** inclusive day count in [from, to] */
  days: number;
}

export const RANGE_PRESETS: { value: Exclude<RangePreset, "custom">; label: string }[] = [
  { value: "last_7", label: "Last 7 days" },
  { value: "last_30", label: "Last 30 days" },
  { value: "last_90", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
];

export const DEFAULT_PRESET: RangePreset = "last_30";

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function todayIso(now: Date): string {
  return riyadhDateOf(now);
}

function addDays(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return iso(d);
}

/** Inclusive day-span between two YYYY-MM-DD dates. */
export function daySpan(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function presetBounds(preset: Exclude<RangePreset, "custom">, now: Date): { from: string; to: string } {
  const to = todayIso(now);
  switch (preset) {
    case "last_7":
      return { from: addDays(to, -6), to };
    case "last_90":
      return { from: addDays(to, -89), to };
    case "this_month": {
      const first = `${to.slice(0, 7)}-01`;
      return { from: first, to };
    }
    case "last_30":
    default:
      return { from: addDays(to, -29), to };
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve a DashboardRange from URL search params. Accepts `?preset=` and/or
 * explicit `?from=&to=`. Invalid/absent input falls back to the default
 * preset. `now` is injectable for deterministic tests.
 */
export function resolveRange(
  params: { preset?: string; from?: string; to?: string } | undefined,
  now: Date = new Date(),
): DashboardRange {
  const rawPreset = params?.preset as RangePreset | undefined;
  const from = params?.from;
  const to = params?.to;

  // Explicit custom range wins when both dates are valid.
  if (rawPreset === "custom" || (from && to)) {
    if (from && to && DATE_RE.test(from) && DATE_RE.test(to) && from <= to) {
      return { from, to, preset: "custom", days: daySpan(from, to) };
    }
  }

  const preset: Exclude<RangePreset, "custom"> =
    rawPreset && rawPreset !== "custom" && RANGE_PRESETS.some((p) => p.value === rawPreset)
      ? (rawPreset as Exclude<RangePreset, "custom">)
      : (DEFAULT_PRESET as Exclude<RangePreset, "custom">);

  const bounds = presetBounds(preset, now);
  return { ...bounds, preset, days: daySpan(bounds.from, bounds.to) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jun 1" / "Jun 1, 2025" (year shown only when not the current year). */
export function fmtDay(isoDate: string, now: Date = new Date()): string {
  if (!DATE_RE.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return y === Number(riyadhDateOf(now).slice(0, 4)) ? base : `${base}, ${y}`;
}

/** Human label for a windowed card header, e.g. "Jun 1 – Jun 29". */
export function rangeLabel(range: DashboardRange, now: Date = new Date()): string {
  const preset = RANGE_PRESETS.find((p) => p.value === range.preset);
  if (preset) return preset.label;
  return `${fmtDay(range.from, now)} – ${fmtDay(range.to, now)}`;
}

/** Human label for a point-in-time (snapshot) card, e.g. "as of Jun 29". */
export function asOfLabel(range: DashboardRange, now: Date = new Date()): string {
  return `as of ${fmtDay(range.to, now)}`;
}

/** True when the range ends today — snapshot cards can use live values. */
export function endsToday(range: DashboardRange, now: Date = new Date()): boolean {
  return range.to === todayIso(now);
}
