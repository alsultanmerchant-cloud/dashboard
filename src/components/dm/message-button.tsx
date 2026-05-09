"use client";

// Reusable trigger that opens a 1:1 DM dialog with the given employee.
// Renders as a small "💬" icon button — meant to live next to assignee
// chips on the task / project pages.

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DirectMessageDialog } from "./message-dialog";

export function MessageButton({
  employeeId,
  employeeName,
  contextTaskId,
  contextProjectId,
  className,
  size = "sm",
}: {
  employeeId: string;
  employeeName: string;
  contextTaskId?: string | null;
  contextProjectId?: string | null;
  className?: string;
  size?: "xs" | "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const sz = size === "xs" ? "size-5" : size === "md" ? "size-7" : "size-6";
  const iconSz = size === "xs" ? "size-3" : size === "md" ? "size-4" : "size-3.5";
  return (
    <>
      <button
        type="button"
        aria-label={`مراسلة ${employeeName}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-cyan/15 text-cyan transition-colors hover:bg-cyan/30 hover:text-cyan-foreground",
          sz,
          className,
        )}
      >
        <MessageCircle className={iconSz} />
      </button>
      {open && (
        <DirectMessageDialog
          recipientEmployeeId={employeeId}
          recipientName={employeeName}
          contextTaskId={contextTaskId ?? null}
          contextProjectId={contextProjectId ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
