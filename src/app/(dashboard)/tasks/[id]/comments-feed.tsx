// Sky Light "Log Note" three-section comments feed.
// Splits task comments by kind:
//   - requirements → pinned section at top (specialist's brief)
//   - modification → grouped section (client revision requests)
//   - note         → chronological feed (with stage/assignee events)

import { Pin, RefreshCw } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { formatArabicDateTime } from "@/lib/utils-format";
import { TaskActivityFeed } from "../task-activity-feed";
import type { TaskActivity } from "@/lib/data/task-activity";

type NoteItem = Extract<TaskActivity, { kind: "note" }>;

export function CommentsFeed({ items }: { items: TaskActivity[] }) {
  const requirements: NoteItem[] = [];
  const modifications: NoteItem[] = [];
  const rest: TaskActivity[] = [];

  for (const item of items) {
    if (item.kind !== "note") {
      rest.push(item);
      continue;
    }
    if (item.comment_kind === "requirements") {
      requirements.push(item);
    } else if (item.comment_kind === "modification") {
      modifications.push(item);
    } else {
      rest.push(item);
    }
  }

  return (
    <div className="space-y-4">
      {requirements.length > 0 && (
        <Card className="border-cyan/20 bg-cyan/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-cyan">
              <Pin className="size-4" />
              <h3 className="text-sm font-semibold">متطلبات المهمة</h3>
            </div>
            <ul className="space-y-3">
              {requirements.map((c) => (
                <li key={c.id}>
                  <CommentRow item={c} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {modifications.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-warning">
              <RefreshCw className="size-4" />
              <h3 className="text-sm font-semibold">تعديلات العميل</h3>
            </div>
            <ol className="space-y-3">
              {modifications.map((c, i) => (
                <li key={c.id} className="space-y-1.5">
                  <p className="text-[11px] font-medium text-warning">
                    تعديل #{i + 1}
                  </p>
                  <CommentRow item={c} />
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <TaskActivityFeed items={rest} />
    </div>
  );
}

function CommentRow({ item }: { item: NoteItem }) {
  return (
    <div className="flex items-start gap-3">
      <Avatar size="sm">
        <AvatarFallback>{item.actor?.name?.[0] ?? "·"}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{item.actor?.name ?? "موظف"}</p>
          <p className="text-[11px] text-muted-foreground">
            {formatArabicDateTime(item.created_at)}
          </p>
        </div>
        <p className="mt-1 text-sm whitespace-pre-wrap leading-relaxed break-words">
          {item.body}
        </p>
      </div>
    </div>
  );
}
