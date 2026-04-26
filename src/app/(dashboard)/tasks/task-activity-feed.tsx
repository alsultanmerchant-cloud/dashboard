// Sky Light task activity feed renderer.
// Server component — receives the unified TaskActivity[] from
// getTaskActivityFeed and renders each item with a kind-specific layout.
//
// Visual conventions match the PDF screenshots:
//   - stage changes: small colored chip with "from → to"
//   - assignee changes: avatar swap with role color
//   - notes: card with avatar + body, @mentions highlighted, URLs linkified

import Link from "next/link";
import {
  ArrowLeftRight,
  GitCompareArrows,
  MessageSquare,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  TASK_STAGE_LABELS,
  TASK_STAGE_TONES,
  TASK_ROLE_LABELS,
  TASK_ROLE_TONES,
} from "@/lib/labels";
import { formatArabicDateTime } from "@/lib/utils-format";
import type { TaskActivity } from "@/lib/data/task-activity";

export function TaskActivityFeed({ items }: { items: TaskActivity[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-white/10 bg-card/30 px-4 py-6 text-center">
        لا يوجد نشاط بعد. كن أول من يعلّق أو أسنِد المهمة لتظهر الحركات هنا.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`}>
          {item.kind === "note" && <NoteRow item={item} />}
          {item.kind === "stage_change" && <StageRow item={item} />}
          {item.kind === "assignee_change" && <AssigneeRow item={item} />}
        </li>
      ))}
    </ol>
  );
}

// ------- note -----------------------------------------------------------

function NoteRow({ item }: { item: Extract<TaskActivity, { kind: "note" }> }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar size="sm">
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
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    <Lock className="size-2.5" />
                    داخلي
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {formatArabicDateTime(item.created_at)}
              </p>
            </div>
            <p className="mt-1.5 text-sm whitespace-pre-wrap leading-relaxed break-words">
              {renderNoteBody(item.body)}
            </p>
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
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-card text-muted-foreground">
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
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-card text-muted-foreground">
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

// ------- helpers --------------------------------------------------------
// (Link is imported above so the file remains valid even if we add task
// links later. Suppress unused warning explicitly.)
void Link;
