// Sky Light task activity feed renderer.
// Server component — receives the unified TaskActivity[] from
// getTaskActivityFeed and renders each item with a kind-specific layout.
//
// Visual conventions match the PDF screenshots:
//   - stage changes: small colored chip with "from → to"
//   - assignee changes: avatar swap with role color
//   - notes: card with avatar + body, @mentions highlighted, URLs linkified

import Link from "next/link";
import sanitizeHtml from "sanitize-html";
import {
  ArrowLeftRight,
  GitCompareArrows,
  MessageSquare,
  Lock,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  TASK_STAGE_LABELS,
  TASK_STAGE_TONES,
  TASK_ROLE_LABELS,
  TASK_ROLE_TONES,
} from "@/lib/labels";
import { formatArabicDateTime } from "@/lib/utils-format";
import type { TaskActivity } from "@/lib/data/task-activity";

// Group activity items by calendar date (in the user's locale) so we can
// insert a header before each new day, mirroring Rwasem's "April 15, 2026"
// dividers.
function groupByDay(
  items: TaskActivity[],
): { date: string; key: string; items: TaskActivity[] }[] {
  const groups: { date: string; key: string; items: TaskActivity[] }[] = [];
  let currentKey: string | null = null;
  for (const item of items) {
    const d = new Date(item.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== currentKey) {
      groups.push({
        date: d.toLocaleDateString("ar-SA-u-nu-latn", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        key,
        items: [],
      });
      currentKey = key;
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
}

export function TaskActivityFeed({ items }: { items: TaskActivity[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-soft-2 bg-card/30 px-4 py-6 text-center">
        لا يوجد نشاط بعد. كن أول من يعلّق أو أسنِد المهمة لتظهر الحركات هنا.
      </p>
    );
  }

  const groups = groupByDay(items);

  return (
    <ol className="space-y-3">
      {groups.map((g) => (
        <li key={g.key} className="space-y-3">
          {/* Date divider — Rwasem-style "April 15, 2026" */}
          <div className="flex items-center gap-2 py-1">
            <div className="h-px flex-1 bg-soft" />
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
              {g.date}
            </span>
            <div className="h-px flex-1 bg-soft" />
          </div>
          <ol className="space-y-3">
            {g.items.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                {item.kind === "note" && <NoteRow item={item} />}
                {item.kind === "stage_change" && <StageRow item={item} />}
                {item.kind === "assignee_change" && <AssigneeRow item={item} />}
                {item.kind === "task_created" && <CreatedRow item={item} />}
                {item.kind === "odoo_message" && <OdooMessageRow item={item} />}
                {item.kind === "odoo_stage_change" && <OdooStageRow item={item} />}
                {item.kind === "odoo_field_change" && <OdooFieldRow item={item} />}
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

// ------- note -----------------------------------------------------------

// Tracking events synthesised by the importer always start with this exact
// prefix. They render as compact inline rows (no card, no internal/client
// pill) so they stay visually distinct from real user notes.
const TRACKING_EVENT_PREFIX = "<p><strong>";

function NoteRow({ item }: { item: Extract<TaskActivity, { kind: "note" }> }) {
  const isTrackingEvent = item.body.startsWith(TRACKING_EVENT_PREFIX);

  if (isTrackingEvent) {
    return (
      <div className="flex items-start gap-3 px-1 py-1">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-soft-2 bg-card text-muted-foreground">
          <ArrowLeftRight className="size-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className="font-medium text-muted-foreground">
              {item.actor?.name ?? "النظام"}
            </span>
            <span className="text-[11px] text-muted-foreground/70">
              {formatArabicDateTime(item.created_at)}
            </span>
          </div>
          <div
            className="mt-0.5 text-xs leading-relaxed break-words [&_p]:m-0 [&_strong]:font-medium [&_strong]:text-foreground"
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(item.body, {
                allowedTags: ["p","a","br","span","strong","em","b","i"],
                allowedAttributes: { "*": ["title","class"], a: ["href","target","rel"] },
                allowedClasses: { "*": ["text-cyan","text-muted-foreground","font-medium"] },
              }),
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar size="sm">
            {item.actor?.avatar && (
              <AvatarImage src={item.actor.avatar} alt={item.actor.name} />
            )}
            <AvatarFallback>{item.actor?.name?.[0] ?? "·"}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{item.actor?.name ?? "موظف"}</p>
                {!item.is_internal ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-cyan/30 bg-cyan-dim px-1.5 py-0.5 text-[10px] text-cyan">
                    <MessageSquare className="size-2.5" />
                    عميل
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-soft-2 bg-soft-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    <Lock className="size-2.5" />
                    داخلي
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {formatArabicDateTime(item.created_at)}
              </p>
            </div>
            {/* Odoo chatter bodies are HTML; locally-typed notes are plain text. */}
            {/<\/?(p|a|br|div|span|ul|ol|li|h[1-6]|img|strong|em|b|i)\b/i.test(item.body) ? (
              <div
                className="mt-1.5 text-sm leading-relaxed break-words [&_a]:text-cyan [&_a]:underline [&_p]:mt-2 [&_p:first-child]:mt-0 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ms-5 [&_ol]:ms-5"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(item.body, {
                    allowedTags: ["p","a","br","div","span","ul","ol","li","strong","em","b","i","h1","h2","h3","h4","h5","h6","blockquote","code","pre","hr","img"],
                    allowedAttributes: { "*": ["title","class"], a: ["href","target","rel"], img: ["src","alt"] },
                    allowedClasses: { "*": ["text-cyan","text-muted-foreground","font-medium"] },
                  }),
                }}
              />
            ) : (
              <p className="mt-1.5 text-sm whitespace-pre-wrap leading-relaxed break-words">
                {renderNoteBody(item.body)}
              </p>
            )}
            {item.mentions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {item.mentions.map((m) => (
                  <span
                    key={m.employee_id}
                    className="rounded-md bg-cyan-dim/70 px-1.5 py-0.5 text-[10px] text-cyan"
                  >
                    @{m.full_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Render a note body with @mentions chipped and URLs linkified.
// Order matters: split on URLs first, then on mentions inside the non-URL parts.
const URL_RE = /(https?:\/\/[^\s\u0600-\u06FF]+)/g;
const MENTION_RE = /(@[\p{L}\p{N}_]+)/gu;

function renderNoteBody(body: string) {
  const out: React.ReactNode[] = [];
  let key = 0;
  for (const part of body.split(URL_RE)) {
    if (URL_RE.test(part)) {
      out.push(
        <a
          key={`u${key++}`}
          href={part}
          target="_blank"
          rel="noreferrer noopener"
          className="text-cyan underline decoration-cyan/40 underline-offset-2 hover:decoration-cyan break-all"
          dir="ltr"
        >
          {prettyUrl(part)}
        </a>,
      );
      // reset regex internal state
      URL_RE.lastIndex = 0;
      continue;
    }
    URL_RE.lastIndex = 0;

    for (const seg of part.split(MENTION_RE)) {
      if (seg.startsWith("@")) {
        out.push(
          <span
            key={`m${key++}`}
            className="rounded-md bg-cyan-dim/70 px-1 py-0.5 text-cyan font-medium"
          >
            {seg}
          </span>,
        );
      } else if (seg.length > 0) {
        out.push(<span key={`t${key++}`}>{seg}</span>);
      }
    }
  }
  return out;
}

// Trim long URLs to a friendly label.
function prettyUrl(href: string): string {
  try {
    const u = new URL(href);
    const isDrive = /docs\.google\.com|drive\.google\.com/.test(u.hostname);
    const label = isDrive ? "Google Drive" : u.hostname.replace(/^www\./, "");
    const path = u.pathname.length > 1 ? u.pathname : "";
    const trimmed = (label + path).slice(0, 60);
    return trimmed + (label.length + path.length > 60 ? "…" : "");
  } catch {
    return href;
  }
}

// ------- stage change ---------------------------------------------------

function StageRow({ item }: { item: Extract<TaskActivity, { kind: "stage_change" }> }) {
  const dur = item.duration_seconds ? formatDuration(item.duration_seconds) : null;
  return (
    <div className="flex items-start gap-3 px-1">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-soft-2 bg-card text-muted-foreground">
        <ArrowLeftRight className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">
            {item.actor?.name ?? "النظام"}
          </span>
          <span className="text-muted-foreground">نقل المهمة من</span>
          {item.from_stage && (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                TASK_STAGE_TONES[item.from_stage],
              )}
            >
              {TASK_STAGE_LABELS[item.from_stage]}
            </span>
          )}
          <span className="text-muted-foreground">→</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
              TASK_STAGE_TONES[item.to_stage],
            )}
          >
            {TASK_STAGE_LABELS[item.to_stage]}
          </span>
          {dur && (
            <span className="text-[10px] text-muted-foreground">
              · بقيت {dur}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatArabicDateTime(item.created_at)}
        </p>
      </div>
    </div>
  );
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}ث`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}د`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}س`;
  return `${Math.floor(hours / 24)}ي`;
}

// ------- assignee change ------------------------------------------------

function AssigneeRow({
  item,
}: {
  item: Extract<TaskActivity, { kind: "assignee_change" }>;
}) {
  const action = !item.from_employee
    ? "عيَّن"
    : !item.to_employee
      ? "أخلى"
      : "غيَّر";
  const subject = item.to_employee ?? item.from_employee;
  return (
    <div className="flex items-start gap-3 px-1">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-soft-2 bg-card text-muted-foreground">
        <GitCompareArrows className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">
            {item.actor?.name ?? "النظام"}
          </span>
          <span className="text-muted-foreground">{action} خانة</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
              TASK_ROLE_TONES[item.role_type],
            )}
          >
            {TASK_ROLE_LABELS[item.role_type]}
          </span>
          {subject && (
            <>
              <span className="text-muted-foreground">إلى</span>
              <span className="font-medium">{subject.full_name}</span>
            </>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatArabicDateTime(item.created_at)}
        </p>
      </div>
    </div>
  );
}

// ------- task_created ---------------------------------------------------

function CreatedRow({
  item,
}: {
  item: Extract<TaskActivity, { kind: "task_created" }>;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-soft bg-soft-1/40 px-3 py-2">
      <Avatar size="sm" className="ring-1 ring-cyan/30">
        <AvatarFallback>
          <Sparkles className="size-3.5 text-cyan" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium">
            {item.actor?.name ?? "النظام"}
          </span>
          <span className="text-muted-foreground">أنشأ المهمة في مرحلة</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
              TASK_STAGE_TONES[item.initial_stage],
            )}
          >
            {TASK_STAGE_LABELS[item.initial_stage]}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatArabicDateTime(item.created_at)}
        </p>
      </div>
    </div>
  );
}

// ------- odoo_message ---------------------------------------------------
// Mirrors a chatter entry pulled live from Odoo's `mail.message` for the
// linked Odoo task. Body arrives as HTML — sanitize lightly (strip script /
// style / event-handler attrs) before injecting.

const ODOO_HTML_ALLOW = /<\/?(p|br|b|strong|i|em|u|a|ul|ol|li|span|div)(?:\s+[^>]*)?>/gi;

function sanitizeOdooHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/<(?!\/?(p|br|b|strong|i|em|u|a|ul|ol|li|span|div)\b)[^>]+>/gi, "");
}
void ODOO_HTML_ALLOW; // kept as a reference for the allow-list

// Highlight `@name` mentions inside the rendered HTML body. Wraps each
// run in a cyan pill so the chatter visually matches Rwasem's mention chips.
// Operates on text nodes only (won't touch attribute values or tag names).
function highlightMentions(html: string): string {
  return html.replace(
    /(>|^|\s)(@[؀-ۿA-Za-z][؀-ۿA-Za-z0-9._-]{0,40})/g,
    (_m, lead, mention) =>
      `${lead}<span class="inline-flex items-center rounded-full bg-cyan/15 px-1.5 py-0.5 text-[11px] font-medium text-cyan">${mention}</span>`,
  );
}

function attachmentIsImage(mime: string) {
  return mime.startsWith("image/");
}

function OdooMessageRow({
  item,
}: {
  item: Extract<TaskActivity, { kind: "odoo_message" }>;
}) {
  return (
    <Card className="border-violet-500/20 bg-violet-500/5">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar size="sm" className="ring-1 ring-violet-400/40">
            <AvatarFallback>{item.actor?.name?.[0] ?? "·"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-xs">
              <span className="font-medium">{item.actor?.name ?? "Odoo"}</span>
              <span
                className="inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-violet-300"
                title="مصدر Odoo (Rwasem)"
              >
                Odoo
              </span>
              <span className="text-[11px] text-muted-foreground">
                {formatArabicDateTime(item.created_at)}
              </span>
            </div>
            <div
              className="prose prose-invert prose-sm max-w-none text-sm leading-relaxed [&_a]:text-cyan [&_a]:underline-offset-2 [&_a:hover]:underline"
              dangerouslySetInnerHTML={{
                __html: highlightMentions(sanitizeOdooHtml(item.body_html)),
              }}
            />
            {item.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.attachments.map((att) => (
                  <a
                    key={att.id}
                    href={att.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center gap-2 rounded-lg border border-soft bg-card/60 p-2 pe-3 text-xs transition-colors hover:border-cyan/40 hover:bg-soft-1"
                    title={att.name}
                  >
                    <span
                      className={cn(
                        "inline-flex size-9 items-center justify-center rounded-md bg-soft-2 text-[10px] font-semibold uppercase",
                        attachmentIsImage(att.mimetype) && "text-cyan",
                      )}
                    >
                      {att.mimetype.split("/")[1]?.slice(0, 4) ?? "FILE"}
                    </span>
                    <span className="flex flex-col">
                      <span className="line-clamp-1 max-w-[14rem] font-medium group-hover:text-cyan">
                        {att.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {att.mimetype}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Stage transitions pulled from Odoo's mail.tracking.value. Uses the same
// visual language as native StageRow but tags the source as Odoo.
function OdooStageRow({
  item,
}: {
  item: Extract<TaskActivity, { kind: "odoo_stage_change" }>;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-soft bg-soft-1/40 px-3 py-2">
      <Avatar size="sm" className="ring-1 ring-violet-400/40">
        <AvatarFallback>
          <ArrowLeftRight className="size-3.5 text-violet-300" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium">{item.actor?.name ?? "Odoo"}</span>
          <span
            className="inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-violet-300"
            title="مصدر Odoo"
          >
            Odoo
          </span>
          <span className="text-muted-foreground">نقل المرحلة</span>
          {item.from_label && (
            <>
              <span className="rounded-full border border-soft bg-card px-2 py-0.5 text-[10px]">
                {item.from_label}
              </span>
              <ArrowLeftRight className="size-3 text-muted-foreground" />
            </>
          )}
          <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] font-medium text-cyan">
            {item.to_label}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatArabicDateTime(item.created_at)}
        </p>
      </div>
    </div>
  );
}

// Generic Odoo field tracking (anything that's not the stage). Renders as a
// compact "field: from → to" row.
function OdooFieldRow({
  item,
}: {
  item: Extract<TaskActivity, { kind: "odoo_field_change" }>;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-soft bg-soft-1/40 px-3 py-2">
      <Avatar size="sm" className="ring-1 ring-violet-400/40">
        <AvatarFallback>
          <GitCompareArrows className="size-3.5 text-violet-300" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium">{item.actor?.name ?? "Odoo"}</span>
          <span className="inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-violet-300">
            Odoo
          </span>
          <span className="text-muted-foreground">{item.field}</span>
          {item.from_label && (
            <span className="line-clamp-1 max-w-[16rem] rounded border border-soft bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {item.from_label}
            </span>
          )}
          {item.to_label && (
            <>
              <ArrowLeftRight className="size-3 text-muted-foreground" />
              <span className="line-clamp-1 max-w-[16rem] rounded border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
                {item.to_label}
              </span>
            </>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatArabicDateTime(item.created_at)}
        </p>
      </div>
    </div>
  );
}

// ------- helpers --------------------------------------------------------
// (Link is imported above so the file remains valid even if we add task
// links later. Suppress unused warning explicitly.)
void Link;
