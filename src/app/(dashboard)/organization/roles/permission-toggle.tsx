"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toggleRolePermissionAction } from "./_actions";

export function PermissionToggle({
  roleId,
  permissionId,
  initialGranted,
  isOwnerRole,
  highlight,
}: {
  roleId: string;
  permissionId: string;
  initialGranted: boolean;
  isOwnerRole: boolean;
  highlight?: boolean;
}) {
  // Owner role bypasses role_permissions in code (auth-server.ts:isOwner).
  // Render it as always-on and not interactive.
  if (isOwnerRole) {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-cyan-dim text-cyan">
        <Check className="size-3.5" />
      </span>
    );
  }

  const [granted, setGranted] = useState(initialGranted);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    const next = !granted;
    setGranted(next); // optimistic
    startTransition(async () => {
      const res = await toggleRolePermissionAction({
        roleId,
        permissionId,
        grant: next,
      });
      if ("error" in res) {
        setGranted(!next); // revert
        setError(res.error);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={error ?? (granted ? "إلغاء الصلاحية" : "منح الصلاحية")}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-full transition-colors",
        granted
          ? highlight
            ? "bg-cyan-dim text-cyan ring-1 ring-cyan/30"
            : "bg-green-dim text-cc-green hover:bg-green-dim/80"
          : "bg-soft-2 text-muted-foreground/40 hover:bg-soft-2 hover:text-muted-foreground",
        pending && "opacity-60 cursor-wait",
        error && "ring-1 ring-cc-red",
      )}
      aria-pressed={granted}
      aria-label={granted ? "صلاحية ممنوحة، انقر للإلغاء" : "صلاحية غير ممنوحة، انقر للمنح"}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : granted ? (
        <Check className="size-3.5" />
      ) : (
        <span className="text-xs">—</span>
      )}
    </button>
  );
}
