"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DirectMessageDialog } from "@/components/dm/message-dialog";

type Conversation = {
  otherEmployeeId: string;
  otherFullName: string;
  otherAvatarUrl: string | null;
  otherJobTitle: string | null;
  latestBody: string | null;
  latestCreatedAt: string;
  unread: number;
};

export function MessagesInbox({
  conversations,
  locale,
}: {
  conversations: Conversation[];
  locale: string;
}) {
  const t = useTranslations("MessagesPage");
  const [openWith, setOpenWith] = useState<Conversation | null>(null);
  const relativeFormatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  function relativeTime(value: string) {
    const diffSec = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) return relativeFormatter.format(diffSec, "second");
    if (abs < 3600) return relativeFormatter.format(Math.round(diffSec / 60), "minute");
    if (abs < 86400) return relativeFormatter.format(Math.round(diffSec / 3600), "hour");
    if (abs < 2592000) return relativeFormatter.format(Math.round(diffSec / 86400), "day");
    if (abs < 31536000) return relativeFormatter.format(Math.round(diffSec / 2592000), "month");
    return relativeFormatter.format(Math.round(diffSec / 31536000), "year");
  }
  return (
    <>
      <ul className="space-y-2">
        {conversations.map((c) => (
          <li key={c.otherEmployeeId}>
            <Card
              className={cn(
                "cursor-pointer transition-colors hover:bg-soft-1",
                c.unread > 0 && "border-cyan/40 bg-card",
              )}
            >
              <CardContent
                className="flex items-center gap-3 p-3"
                onClick={() => setOpenWith(c)}
              >
                {c.otherAvatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={c.otherAvatarUrl}
                    alt={c.otherFullName}
                    className="size-10 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid size-10 place-items-center rounded-full bg-cyan/20 text-sm font-semibold text-cyan">
                    {c.otherFullName.slice(0, 1)}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate text-sm font-semibold">{c.otherFullName}</p>
                    <span className="ms-auto text-[11px] tabular-nums text-muted-foreground">
                      {relativeTime(c.latestCreatedAt)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.latestBody ?? t("attachmentFallback")}
                  </p>
                </div>
                {c.unread > 0 && (
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-cc-red text-[11px] font-semibold text-white">
                    {c.unread}
                  </span>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      {openWith && (
        <DirectMessageDialog
          recipientEmployeeId={openWith.otherEmployeeId}
          recipientName={openWith.otherFullName}
          contextTaskId={null}
          contextProjectId={null}
          onClose={() => setOpenWith(null)}
        />
      )}
    </>
  );
}
