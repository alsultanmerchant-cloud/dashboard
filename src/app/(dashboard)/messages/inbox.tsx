"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { relativeTimeAr } from "@/lib/utils-format";
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
}: {
  conversations: Conversation[];
}) {
  const [openWith, setOpenWith] = useState<Conversation | null>(null);
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
                      {relativeTimeAr(c.latestCreatedAt)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.latestBody ?? "(مرفق)"}
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
