"use client";

// =========================================================================
// Phase T3 — Followers panel for the task detail page.
// Followers are distinct from assignees: they get visibility on the task
// (via the 0023 RLS policy) without taking on a stage-exit role.
// Edit access is gated server-side; this component just hides the picker
// when the caller can't manage.
// =========================================================================

import { useState, useTransition, useEffect, useMemo, useRef } from "react";
import { Loader2, UserPlus, X, Search, Check } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addFollowerAction, removeFollowerAction } from "./_actions";

export type FollowerRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  added_at: string;
  /** Inherited from the project (project_members). Read-only on the task. */
  inherited?: boolean;
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
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const normalized = (s: string) => s.toLowerCase();
  const filtered = useMemo(() => {
    const q = normalized(query.trim());
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        normalized(c.full_name).includes(q) ||
        normalized(c.job_title ?? "").includes(q),
    );
  }, [candidates, query]);

  // Keep activeIndex valid as the filtered list changes.
  useEffect(() => {
    setActiveIndex((i) => Math.min(Math.max(0, i), Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Focus the search input when the popover opens, and close on outside click.
  useEffect(() => {
    if (!picking) return;
    inputRef.current?.focus();
    function onPointerDown(e: PointerEvent) {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) {
        setPicking(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [picking]);

  function add(userId: string) {
    setBusyUserId(userId);
    start(async () => {
      const res = await addFollowerAction({ taskId, userId });
      setBusyUserId(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تمت إضافة المتابع");
      // Stay open so the user can add more followers in one motion — closes
      // automatically when no candidates are left.
      setQuery("");
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

  function onKeyDown(e: React.KeyboardEvent) {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) add(target.user_id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPicking(false);
      setQuery("");
    }
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
              className={
                f.inherited
                  ? "flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan-dim/40 py-1 ps-1 pe-2"
                  : "flex items-center gap-2 rounded-full border border-soft-2 bg-soft-1 py-1 ps-1 pe-2"
              }
              title={f.inherited ? "متابع موروث من المشروع" : undefined}
            >
              <Avatar size="sm">
                {f.avatar_url ? <AvatarImage src={f.avatar_url} alt="" /> : null}
                <AvatarFallback>{f.full_name[0]}</AvatarFallback>
              </Avatar>
              <span className="text-xs font-medium">{f.full_name}</span>
              {f.inherited && (
                <span className="rounded-full bg-cyan/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
                  من المشروع
                </span>
              )}
              {canManage && !f.inherited && (
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
        <div className="relative" ref={popoverRef}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPicking((v) => !v)}
            disabled={candidates.length === 0}
            aria-haspopup="listbox"
            aria-expanded={picking}
          >
            <UserPlus className="size-3.5" />
            إضافة متابع
          </Button>
          {!picking && candidates.length === 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              كل الزملاء النشطين متابعون بالفعل.
            </p>
          )}
          {picking && (
            <div
              className="absolute z-30 mt-1.5 w-72 max-w-[90vw] overflow-hidden rounded-xl border border-soft bg-card shadow-2xl shadow-black/30"
              role="dialog"
              aria-label="اختر متابعًا"
            >
              <div className="flex items-center gap-2 border-b border-soft px-2.5 py-2">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="ابحث بالاسم أو الدور..."
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  aria-label="بحث المتابعين"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="مسح البحث"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              <ul
                role="listbox"
                aria-label="المتابعون المرشحون"
                className="max-h-64 overflow-y-auto py-1"
              >
                {filtered.length === 0 ? (
                  <li className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                    لا نتائج
                  </li>
                ) : (
                  filtered.map((c, idx) => {
                    const isBusy = busyUserId === c.user_id && pending;
                    const isActive = idx === activeIndex;
                    return (
                      <li key={c.user_id} role="option" aria-selected={isActive}>
                        <button
                          type="button"
                          disabled={pending}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => add(c.user_id)}
                          className={cn(
                            "flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-xs transition-colors disabled:opacity-60",
                            isActive
                              ? "bg-cyan-dim/60 text-foreground"
                              : "hover:bg-soft-2",
                          )}
                        >
                          <Avatar size="sm" className="shrink-0">
                            {c.avatar_url ? <AvatarImage src={c.avatar_url} alt="" /> : null}
                            <AvatarFallback className="text-[10px]">
                              {c.full_name[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{c.full_name}</div>
                            {c.job_title && (
                              <div className="truncate text-[10px] text-muted-foreground">
                                {c.job_title}
                              </div>
                            )}
                          </div>
                          {isBusy ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                          ) : (
                            <Check className="size-3.5 shrink-0 opacity-0 group-hover:opacity-100" />
                          )}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              <div className="flex items-center justify-between border-t border-soft px-2.5 py-1.5 text-[10px] text-muted-foreground">
                <span>{filtered.length} مرشح</span>
                <button
                  type="button"
                  onClick={() => {
                    setPicking(false);
                    setQuery("");
                  }}
                  className="hover:text-foreground"
                >
                  إغلاق (Esc)
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
