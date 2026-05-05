"use client";

import { useTransition } from "react";
import { Loader2, Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { addFollowerAction, removeFollowerAction } from "./_actions";

export function TaskFollowToggle({
  taskId,
  currentUserId,
  isFollowing,
}: {
  taskId: string;
  currentUserId: string;
  isFollowing: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const toggle = () => {
    start(async () => {
      const res = isFollowing
        ? await removeFollowerAction({ taskId, userId: currentUserId })
        : await addFollowerAction({ taskId, userId: currentUserId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(isFollowing ? "ألغيت المتابعة" : "تمت المتابعة");
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        isFollowing
          ? "border-cyan/40 bg-cyan/15 text-cyan"
          : "border-soft bg-card text-muted-foreground hover:text-foreground hover:bg-soft-1",
        pending && "opacity-70 cursor-wait",
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : isFollowing ? (
        <BellOff className="size-3.5" />
      ) : (
        <Bell className="size-3.5" />
      )}
      {isFollowing ? "متابِع" : "متابعة"}
    </button>
  );
}
