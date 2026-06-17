import { ArrowRight } from "lucide-react";

// The sheet's Logs tab stores a human-readable `notes` blob whose shape depends
// on the event. Examples:
//   EDIT MODE OFF:  'Left EDIT -> new — 02 Jun 2026 15:28\n\nChanges:\n
//                    - Contract Type: "Edit" → "New"\n- Value of repeated services: "3500" → "0"'
//   EDIT MODE ON:   'Entered EDIT — 02 Jun 2026 15:26'
//   ON HOLD:        'Entered HOLD — Contract Type was: "New" — 20 May 2026 14:35\nNotes: "..."'
//   HOLD LIFTED:    'Left HOLD -> new — 25 May 2026 18:32\nContract Type was: "Hold"\nNotes: ""'
//   Close (Lost):   'فقد تم خصم 25% من المبلغ المدفوع'   (free-form comment)
//
// We parse it into structured pieces and render a clear diff UI. The transition
// prefix ("Left EDIT -> new") and inline date are intentionally dropped — the
// colored type badge and the timestamp already convey them.

export type SheetLogChange = { field: string; from: string; to: string };
export type SheetLogTransition = {
  direction: "entered" | "left";
  state: string;
  nextState: string | null;
};

export type ParsedSheetLogNote = {
  transition: SheetLogTransition | null;
  changes: SheetLogChange[];
  priorType: string | null; // "Contract Type was: X"
  comment: string | null; // free-form human note
};

const CHANGE_RE = /^-\s*(.+?):\s*"([\s\S]*?)"\s*→\s*"([\s\S]*?)"\s*$/gm;
const PRIOR_TYPE_RE = /Contract Type was:\s*"([^"]*)"/;
const NOTES_RE = /Notes:\s*"([\s\S]*?)"\s*$/m;
const TRANSITION_RE = /^(Entered|Left)\s/;
const TRANSITION_LINE_RE = /^(Entered|Left)\s+([A-Z]+)(?:\s*->\s*([^\s—]+))?/;

const FIELD_LABELS: Record<"ar" | "en", Record<string, string>> = {
  ar: {
    "Contract Type": "نوع العقد",
    "Value of repeated services": "قيمة الخدمات المتكررة",
    Start: "تاريخ البدء",
  },
  en: {
    "Contract Type": "Contract type",
    "Value of repeated services": "Recurring value",
    Start: "Start date",
  },
};

function fieldLabel(field: string, locale: string) {
  const key = locale === "ar" ? "ar" : "en";
  return FIELD_LABELS[key][field] ?? field;
}

export function parseSheetLogNote(
  notes: string | null | undefined,
): ParsedSheetLogNote {
  if (!notes || !notes.trim()) {
    return { transition: null, changes: [], priorType: null, comment: null };
  }
  const text = notes.replace(/\r/g, "");
  const transitionMatch = text.trim().match(TRANSITION_LINE_RE);
  const transition: SheetLogTransition | null = transitionMatch
    ? {
        direction: transitionMatch[1] === "Entered" ? "entered" : "left",
        state: transitionMatch[2],
        nextState: transitionMatch[3]?.trim() || null,
      }
    : null;

  const changes: SheetLogChange[] = [];
  CHANGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHANGE_RE.exec(text)) !== null) {
    changes.push({ field: m[1].trim(), from: m[2], to: m[3] });
  }

  const priorType = text.match(PRIOR_TYPE_RE)?.[1]?.trim() || null;
  const notesMatch = text.match(NOTES_RE);

  // If none of the structured markers are present, the whole blob is a
  // free-form human comment (e.g. an Arabic close reason).
  const isStructured =
    changes.length > 0 ||
    priorType !== null ||
    notesMatch !== null ||
    TRANSITION_RE.test(text.trim());

  const comment = isStructured
    ? notesMatch?.[1]?.trim() || null
    : text.trim() || null;

  return { transition, changes, priorType, comment };
}

export function SheetLogNote({
  notes,
  wasLabel = "Was",
  locale = "en",
  compact = false,
  emptyLabel,
  className = "",
}: {
  notes: string | null | undefined;
  wasLabel?: string;
  locale?: string;
  compact?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const { transition, changes, priorType, comment } = parseSheetLogNote(notes);
  if (changes.length === 0 && !priorType && !comment && !transition) {
    return emptyLabel ? (
      <span className={`text-sm text-muted-foreground ${className}`}>{emptyLabel}</span>
    ) : null;
  }
  const showTransition = transition && changes.length === 0 && !priorType && !comment;

  return (
    <div
      className={`space-y-2 rounded-lg border border-soft bg-background/45 p-2.5 ${compact ? "max-w-xl" : ""} ${className}`}
    >
      {showTransition && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">
            {transition.direction === "entered"
              ? locale === "ar"
                ? "دخول"
                : "Entered"
              : locale === "ar"
                ? "خروج"
                : "Left"}
          </span>
          <span className="rounded-md border border-soft bg-muted px-2 py-0.5 font-medium text-foreground [unicode-bidi:plaintext]">
            {transition.state}
          </span>
          {transition.nextState && (
            <>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground icon-flip-rtl" />
              <span className="rounded-md border border-soft bg-muted px-2 py-0.5 font-medium text-foreground [unicode-bidi:plaintext]">
                {transition.nextState}
              </span>
            </>
          )}
        </div>
      )}

      {changes.length > 0 && (
        <ul className="space-y-1.5">
          {changes.map((c, i) => (
            <li
              key={i}
              className="grid gap-1.5 text-xs sm:grid-cols-[minmax(8rem,11rem)_1fr] sm:items-center"
            >
              <span className="text-[11px] font-medium text-muted-foreground">
                {fieldLabel(c.field, locale)}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="max-w-full truncate rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-rose-700 line-through decoration-rose-500/50 [unicode-bidi:plaintext] dark:text-rose-200/90 dark:decoration-rose-400/40">
                  {c.from || "—"}
                </span>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground icon-flip-rtl" />
                <span className="max-w-full truncate rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 [unicode-bidi:plaintext] dark:text-emerald-200">
                  {c.to || "—"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {priorType && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{wasLabel}</span>
          <span className="rounded-md border border-soft bg-muted px-2 py-0.5 font-medium text-foreground/85 [unicode-bidi:plaintext]">
            {priorType}
          </span>
        </p>
      )}

      {comment && (
        <p className="rounded-md border border-soft bg-card/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground [unicode-bidi:plaintext] whitespace-pre-wrap break-words">
          {comment}
        </p>
      )}
    </div>
  );
}

// The sheet records a full contract-state snapshot on every log event. The
// `notes` blob only covers edits/holds; Close events carry their detail solely
// here. We render it verbatim (sheet field names, cleaned of stray whitespace)
// as a compact label/value grid so reviewing a contract shows what the sheet
// shows. Field order mirrors the sheet's columns; empty values are skipped.
const SNAPSHOT_FIELDS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Contract Status"], label: "Contract Status" },
  { keys: ["Contract Type"], label: "Contract Type" },
  { keys: ["Target"], label: "Target" },
  { keys: ["Package"], label: "Package" },
  { keys: ["payment status"], label: "Payment Status" },
  { keys: ["Contract Start Date"], label: "Start Date" },
  { keys: ["Expected End Date"], label: "Expected End" },
  { keys: ["Actual End Date"], label: "Actual End" },
  { keys: ["C.Duration (Months)"], label: "Duration (months)" },
  { keys: ["Actual paid value"], label: "Paid Value" },
  { keys: ["Next Contract Value"], label: "Next Contract Value" },
  { keys: ["Value of repeated services"], label: "Repeated Services" },
  { keys: ["Delays (working days)"], label: "Delay (working days)" },
];

const cleanKey = (k: string) => k.replace(/\s+/g, " ").trim();

export function SheetLogSnapshot({
  snapshot,
  title,
  className = "",
}: {
  snapshot: Record<string, unknown> | null | undefined;
  title: string;
  className?: string;
}) {
  if (!snapshot) return null;
  // Re-key with whitespace cleaned so messy sheet headers ("Delays\n (working
  // days)", " Value of repeated services") match our lookup labels.
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(snapshot)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) norm[cleanKey(k)] = s;
  }
  const rows = SNAPSHOT_FIELDS.map((f) => {
    const key = f.keys.map(cleanKey).find((k) => norm[k] != null);
    return key ? { label: f.label, value: norm[key] } : null;
  }).filter((r): r is { label: string; value: string } => r !== null);
  if (rows.length === 0) return null;

  return (
    <div className={`rounded-md border border-soft bg-soft-1/40 p-2.5 ${className}`}>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className="text-[10px] text-muted-foreground">{r.label}</dt>
            <dd className="truncate text-xs font-medium [unicode-bidi:plaintext]" title={r.value}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
