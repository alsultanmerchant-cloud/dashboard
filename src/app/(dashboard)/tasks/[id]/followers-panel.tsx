"use client";

// =========================================================================
// Phase T3 — Followers panel for the task detail page.
// Followers are distinct from assignees: they get visibility on the task
// (via the 0023 RLS policy) without taking on a stage-exit role.
// Edit access is gated server-side; this component just hides the picker
// when the caller can't manage.
// =========================================================================

import { useState, useTransition } from "react";
import { Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { addFollowerAction, removeFollowerAction } from "./_actions";

export type FollowerRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  added_at: string;
};

export type FollowerCandidate = {
  user_id: string;
  full_name: string;
  job_title: string | null;
  avatar_url: string | null;
};

export function FollowersPanel({
  taskId,
  followers,
  candidates,
  canManage,
}: {
  taskId: string;
  followers: FollowerRow[];
  candidates: FollowerCandidate[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [pickedUserId, setPickedUserId] = useState("");
  const [pending, start] = useTransition();

  function add() {
    if (!pickedUserId) return;
    start(async () => {
      const res = await addFollowerAction({ taskId, userId: pickedUserId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تمت إضافة المتابع");
      setPickedUserId("");
      setPicking(false);
      router.refresh();
    });
  }

  function remove(userId: string) {
    start(async () => {
      const res = await removeFollowerAction({ taskId, userId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تمت إزالة المتابع");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {followers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          لا يوجد متابعون بعد. أضف من تريد إبقاءه على اطلاع دون إسناد دور تنفيذي.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {followers.map((f) => (
            <li
              key={f.user_id}
              className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] py-1 ps-1 pe-2"
            >
              <Avatar size="sm">
                {f.avatar_url ? <AvatarImage src={f.avatar_url} alt="" /> : null}
                <AvatarFallback>{f.full_name[0]}</AvatarFallback>
              </Avatar>
              <span className="text-xs font-medium">{f.full_name}</span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => remove(f.user_id)}
                  disabled={pending}
                  aria-label={`إزالة ${f.full_name} من المتابعين`}
                  className="text-muted-foreground hover:text-cc-red transition-colors disabled:opacity-50"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div>
          {!picking ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPicking(true)}
              disabled={candidates.length === 0}
            >
              <UserPlus className="size-3.5" />
              إضافة متابع
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={pickedUserId}
                onChange={(e) => setPickedUserId(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-card px-2 py-1 text-xs"
              >
                <option value="">اختر زميلاً…</option>
                {candidates.map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.full_name}
                    {c.job_title ? ` — ${c.job_title}` : ""}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                onClick={add}
                disabled={!pickedUserId || pending}
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                حفظ
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPicking(false);
                  setPickedUserId("");
                }}
                disabled={pending}
              >
                إلغاء
              </Button>
            </div>
          )}
          {!picking && candidates.length === 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              كل الزملاء النشطين متابعون بالفعل.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
