"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/supabase/types";
import { addTaskCommentAction } from "./_actions";

type TaskStage = Database["public"]["Enums"]["task_stage"];
type CommentKind = Database["public"]["Enums"]["task_comment_kind"];

const KIND_OPTIONS: { value: CommentKind; label: string }[] = [
  { value: "note", label: "ملاحظة" },
  { value: "requirements", label: "متطلبات" },
  { value: "modification", label: "تعديل من العميل" },
];

function defaultKindFor(
  stage: TaskStage | undefined,
  hasRequirements: boolean,
): CommentKind {
  if (stage === "new" && !hasRequirements) return "requirements";
  if (stage === "client_changes") return "modification";
  return "note";
}

export function CommentComposer({
  taskId,
  currentStage,
  hasRequirements = false,
}: {
  taskId: string;
  currentStage?: TaskStage;
  hasRequirements?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const initialKind = useMemo(
    () => defaultKindFor(currentStage, hasRequirements),
    [currentStage, hasRequirements],
  );
  const [kind, setKind] = useState<CommentKind>(initialKind);
  const [pending, start] = useTransition();

  const hint =
    kind === "requirements" && currentStage === "new" && !hasRequirements
      ? "اكتب متطلبات المهمة الأولية — ستُثبت في أعلى الخيط"
      : kind === "modification" && currentStage === "client_changes"
        ? "سجل تعديلات العميل — ستظهر في قسم التعديلات"
        : null;

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    start(async () => {
      const res = await addTaskCommentAction({ taskId, body: trimmed, kind });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.mentionsResolved > 0
          ? `تم نشر التعليق وإشعار ${res.mentionsResolved} موظف`
          : "تم نشر التعليق",
      );
      setBody("");
      setKind(defaultKindFor(currentStage, hasRequirements));
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-2xl border border-white/[0.05] bg-card p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {KIND_OPTIONS.map((opt) => {
          const active = kind === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setKind(opt.value)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                active
                  ? "bg-cyan/15 text-cyan border-cyan/40"
                  : "border-white/10 text-muted-foreground hover:bg-white/5",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {hint && (
        <p className="text-[11px] text-cyan/80">{hint}</p>
      )}
      <Textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
        placeholder="اكتب تعليقًا… استخدم @الاسم للإشارة لزميل (مثل @السلطان)"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">⌘+Enter للإرسال السريع</p>
        <Button onClick={submit} disabled={pending || body.trim().length === 0} size="sm">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          نشر التعليق
        </Button>
      </div>
    </div>
  );
}
