"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addTaskCommentAction } from "./_actions";

export function CommentComposer({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    start(async () => {
      const res = await addTaskCommentAction({ taskId, body: trimmed });
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
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-2xl border border-white/[0.05] bg-card p-3">
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
