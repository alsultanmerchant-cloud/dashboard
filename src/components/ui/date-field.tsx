"use client";

// Controlled date field that ALWAYS displays as DD/MM/YYYY, regardless of the
// browser locale (native <input type="date"> follows the browser's UI language,
// which shows MM/DD/YYYY on en-US machines and doesn't match our sheets/Rawasm
// convention). Value in/out is ISO "YYYY-MM-DD" (or "" for empty). A calendar
// button opens the OS date picker for convenience; typing is masked to
// dd/mm/yyyy.

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

// Parse a "dd/mm/yyyy" string into an ISO date, validating the calendar day.
function displayToIso(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // Round-trip through Date to reject impossible days (e.g. 31/02).
  const dt = new Date(iso + "T00:00:00Z");
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== mo ||
    dt.getUTCDate() !== d
  )
    return null;
  return iso;
}

// Insert slashes as the user types digits: 0 → "", 2 → "dd", 4 → "dd/mm", etc.
function maskDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)];
  return parts.filter(Boolean).join("/");
}

export function DateField({
  value,
  onChange,
  min,
  max,
  className,
  "aria-label": ariaLabel,
}: {
  value: string; // ISO "YYYY-MM-DD" or ""
  onChange: (iso: string) => void; // "" when cleared/invalid
  min?: string;
  max?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = React.useState(() => isoToDisplay(value));
  const hiddenRef = React.useRef<HTMLInputElement>(null);

  // Keep the visible text in sync when the ISO value changes from outside
  // (preset buttons, clear, native picker), but don't fight the user mid-type.
  React.useEffect(() => {
    setText(isoToDisplay(value));
  }, [value]);

  const handleText = (raw: string) => {
    const masked = maskDigits(raw);
    setText(masked);
    const iso = displayToIso(masked);
    if (iso) onChange(iso);
    else if (masked === "") onChange("");
  };

  const openPicker = () => {
    const el = hiddenRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") el.showPicker();
    else el.focus();
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 focus-within:border-cyan",
        className,
      )}
    >
      <input
        type="text"
        inputMode="numeric"
        value={text}
        onChange={(e) => handleText(e.target.value)}
        onBlur={() => setText(isoToDisplay(value))}
        placeholder="يوم/شهر/سنة"
        aria-label={ariaLabel}
        className="w-[5.5rem] bg-transparent text-[11px] tabular-nums text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />
      <button
        type="button"
        onClick={openPicker}
        className="text-muted-foreground hover:text-cyan"
        aria-label="فتح التقويم"
        tabIndex={-1}
      >
        <CalendarDays className="size-3.5" />
      </button>
      {/* Hidden native input drives the OS calendar popup only. */}
      <input
        ref={hiddenRef}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </span>
  );
}
