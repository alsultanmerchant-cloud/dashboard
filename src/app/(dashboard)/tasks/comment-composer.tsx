"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Send, MessageSquare, FileText } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/supabase/types";
import { addTaskCommentAction } from "./_actions";

type TaskStage = Database["public"]["Enums"]["task_stage"];
type CommentKind = Database["public"]["Enums"]["task_comment_kind"];
type ComposerMode = "message" | "note";

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
  floating = false,
}: {
  taskId: string;
  currentStage?: TaskStage;
  hasRequirements?: boolean;
  floating?: boolean;
}) {
  const router = useRouter();
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<ComposerMode>("note");
  const [composerHeight, setComposerHeight] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const initialKind = useMemo(
    () => defaultKindFor(currentStage, hasRequirements),
    [currentStage, hasRequirements],
  );
  const [kind, setKind] = useState<CommentKind>(initialKind);
  const [pending, start] = useTransition();
  const hasBody = body.trim().length > 0;
  const expanded = !floating || hovered || focusedWithin || hasBody;

  useEffect(() => {
    if (!floating || !composerRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const node = composerRef.current;
    const updateHeight = () => {
      setComposerHeight(node.getBoundingClientRect().height);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [floating]);

  const hint =
    mode === "note" && kind === "requirements" && currentStage === "new" && !hasRequirements
      ? "اكتب متطلبات المهمة الأولية — ستُثبت في أعلى الخيط"
      : mode === "note" && kind === "modification" && currentStage === "client_changes"
        ? "سجل تعديلات العميل — ستظهر في قسم التعديلات"
        : null;

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    const submitKind: CommentKind = mode === "message" ? "note" : kind;
    const isInternal = mode !== "message";
    start(async () => {
      const res = await addTaskCommentAction({
        taskId,
        body: trimmed,
        kind: submitKind,
        isInternal,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.mentionsResolved > 0
          ? `${mode === "message" ? "أُرسلت الرسالة" : "نُشرت الملاحظة"} وأُشعر ${res.mentionsResolved} موظف`
          : mode === "message"
            ? "أُرسلت الرسالة"
            : "نُشرت الملاحظة",
      );
      setBody("");
      setKind(defaultKindFor(currentStage, hasRequirements));
      router.refresh();
    });
  }

  const composerCard = (
    <div
      ref={composerRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusedWithin(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocusedWithin(false);
        }
      }}
      className={cn(
        "overflow-hidden rounded-2xl border border-soft bg-card transition-[box-shadow,transform] duration-200",
        floating && "shadow-[0_-10px_30px_rgba(0,0,0,0.08)]",
        floating && !expanded && "translate-y-1",
      )}
    >
      {/* Mode tabs — Rwasem-style: Send message / Log note */}
      <div className="flex items-center gap-0 border-b border-soft bg-soft-1/40 px-2">
        {(
          [
            { value: "message" as const, label: "إرسال رسالة", icon: MessageSquare },
            { value: "note" as const, label: "ملاحظة داخلية", icon: FileText },
          ]
        ).map(({ value, label, icon: Icon }) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                "relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "text-cyan"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan" />
              )}
            </button>
          );
        })}
      </div>

      <div className="p-3">
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            expanded ? "mb-2 max-h-24 opacity-100" : "mb-0 max-h-0 opacity-0",
          )}
        >
          {mode === "note" && (
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
                        ? "border-cyan/40 bg-cyan/15 text-cyan"
                        : "border-soft-2 text-muted-foreground hover:bg-white/5",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            expanded && hint ? "mb-2 max-h-10 opacity-100" : "mb-0 max-h-0 opacity-0",
          )}
        >
          {hint && <p className="text-[11px] text-cyan/80">{hint}</p>}
        </div>
        <Textarea
          rows={expanded ? 3 : 1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          className={cn(
            "transition-[min-height,height] duration-200",
            floating && !expanded && "min-h-0 resize-none overflow-hidden py-2",
          )}
          placeholder={
            mode === "message"
              ? "اكتب رسالة للمتابعين… استخدم @الاسم للإشارة"
              : "اكتب ملاحظة داخلية… استخدم @الاسم للإشارة لزميل"
          }
        />
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            expanded ? "max-h-16 pt-2 opacity-100" : "max-h-0 pt-0 opacity-0",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              ⌘+Enter للإرسال السريع
            </p>
            <Button
              onClick={submit}
        disabled={pending || !hasBody}
              size="sm"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {mode === "message" ? "إرسال" : "نشر"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  if (!floating) return composerCard;

  return (
    <>
      <div
        aria-hidden="true"
        style={{ height: composerHeight ? composerHeight + 24 : 280 }}
      />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-4 sm:px-6">
        <div className="w-full max-w-4xl">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background via-background/85 to-transparent" />
          <div className="pointer-events-auto relative">{composerCard}</div>
        </div>
      </div>
    </>
  );
}
