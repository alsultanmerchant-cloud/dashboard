"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Send, MessageSquare, FileText, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { addTaskCommentAction } from "./_actions";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES = 10;

function sanitizeFilename(name: string): string {
  // Keep Arabic letters, latin alphanumerics, dot, dash, underscore. Replace
  // anything else with `_` so the storage key stays safe across S3-compatible
  // backends.
  return name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 200) || "file";
}

type PendingAttachment = {
  id: string;
  file: File;
};

type TaskStage = Database["public"]["Enums"]["task_stage"];
type CommentKind = Database["public"]["Enums"]["task_comment_kind"];
type ComposerMode = "message" | "note";

export type Mentionable = {
  id: string;
  name: string;
  jobTitle?: string | null;
  avatarUrl?: string | null;
};

// Inspect the textarea around the caret to see if the user is mid-mention.
// Returns the active query (chars after the trigger @) and the @ position
// in the body string, or null if not currently composing a mention.
function detectMention(
  body: string,
  caret: number,
): { query: string; atIndex: number } | null {
  if (caret <= 0) return null;
  // Walk back from caret to find an @ that isn't escaped and isn't preceded
  // by a non-whitespace char (so emails don't trigger).
  let i = caret - 1;
  while (i >= 0) {
    const ch = body[i];
    if (ch === "@") {
      const before = i === 0 ? " " : body[i - 1];
      if (/\s/.test(before) || i === 0) {
        const query = body.slice(i + 1, caret);
        // Stop if the user typed whitespace inside the query — mention ended.
        if (/\s/.test(query)) return null;
        return { query, atIndex: i };
      }
      return null;
    }
    if (/\s/.test(ch) || ch === "\n") return null;
    i--;
  }
  return null;
}

function fuzzyScore(name: string, query: string): number {
  if (!query) return 1;
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n.startsWith(q)) return 3;
  if (n.includes(q)) return 2;
  // Token start match (e.g. "ahmed" matches "Mohamed Ahmed")
  if (n.split(/\s+/).some((tok) => tok.startsWith(q))) return 2;
  return 0;
}

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
  mentionable = [],
}: {
  taskId: string;
  currentStage?: TaskStage;
  hasRequirements?: boolean;
  floating?: boolean;
  mentionable?: Mentionable[];
}) {
  const router = useRouter();
  const t = useTranslations("TaskDetailPage.composer");
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<ComposerMode>("note");
  const [composerHeight, setComposerHeight] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  // Mention dropdown state.
  const [mentionState, setMentionState] = useState<
    | { query: string; atIndex: number; activeIndex: number }
    | null
  >(null);
  const initialKind = useMemo(
    () => defaultKindFor(currentStage, hasRequirements),
    [currentStage, hasRequirements],
  );
  const [kind, setKind] = useState<CommentKind>(initialKind);
  const [pending, start] = useTransition();
  const kindOptions: { value: CommentKind; label: string }[] = [
    { value: "note", label: t("kinds.note") },
    { value: "requirements", label: t("kinds.requirements") },
    { value: "modification", label: t("kinds.modification") },
  ];
  const hasBody = body.trim().length > 0;
  const hasFiles = files.length > 0;
  const expanded = !floating || hovered || focusedWithin || hasBody || hasFiles;

  function addFiles(picked: FileList | File[] | null) {
    if (!picked) return;
    const list = Array.from(picked);
    if (list.length === 0) return;
    const accepted: PendingAttachment[] = [];
    for (const f of list) {
      if (files.length + accepted.length >= MAX_FILES) {
        toast.error(t("maxFiles", { count: MAX_FILES }));
        break;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast.error(t("fileTooLarge", { name: f.name }));
        continue;
      }
      accepted.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file: f });
    }
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  const mentionMatches = useMemo<Mentionable[]>(() => {
    if (!mentionState) return [];
    const q = mentionState.query.trim();
    // Empty query → show every mentionable employee (sorted alphabetically)
    // so the user can browse the full list before typing. The popup is
    // scrollable so we don't truncate.
    if (!q) {
      return [...mentionable].sort((a, b) => a.name.localeCompare(b.name));
    }
    return mentionable
      .map((m) => ({ m, s: fuzzyScore(m.name, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.m.name.localeCompare(b.m.name))
      .map((x) => x.m);
  }, [mentionState, mentionable]);

  // Keep activeIndex in range when the filter narrows the list.
  useEffect(() => {
    if (!mentionState) return;
    if (mentionState.activeIndex >= mentionMatches.length) {
      setMentionState((s) => (s ? { ...s, activeIndex: 0 } : s));
    }
  }, [mentionMatches.length, mentionState]);

  function updateBody(next: string, caret: number) {
    setBody(next);
    const detected = detectMention(next, caret);
    if (detected) {
      setMentionState((prev) =>
        prev && prev.atIndex === detected.atIndex
          ? { ...prev, query: detected.query }
          : { query: detected.query, atIndex: detected.atIndex, activeIndex: 0 },
      );
    } else {
      setMentionState(null);
    }
  }

  function insertMention(emp: Mentionable) {
    if (!mentionState) return;
    const before = body.slice(0, mentionState.atIndex);
    const caret = textareaRef.current?.selectionStart ?? body.length;
    const after = body.slice(caret);
    const insert = `@${emp.name} `;
    const next = `${before}${insert}${after}`;
    setBody(next);
    setMentionState(null);
    // Restore caret to right after inserted mention.
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = before.length + insert.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

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
      ? t("hints.requirements")
      : mode === "note" && kind === "modification" && currentStage === "client_changes"
        ? t("hints.modification")
        : null;

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0 && files.length === 0) return;
    const submitKind: CommentKind = mode === "message" ? "note" : kind;
    const isInternal = mode !== "message";
    start(async () => {
      let uploadedAttachments: {
        storage_path: string;
        filename: string;
        mimetype: string | null;
        size_bytes: number;
      }[] = [];

      if (files.length > 0) {
        setUploading(true);
        try {
          const supabase = createClient();
          const uploads = await Promise.all(
            files.map(async ({ file }) => {
              const safeName = sanitizeFilename(file.name);
              const path = `tasks/${taskId}/${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)}-${safeName}`;
              const { error: upErr } = await supabase.storage
                .from("attachments")
                .upload(path, file, {
                  cacheControl: "3600",
                  contentType: file.type || "application/octet-stream",
                  upsert: false,
                });
              if (upErr) throw new Error(`${file.name}: ${upErr.message}`);
              return {
                storage_path: path,
                filename: file.name,
                mimetype: file.type || null,
                size_bytes: file.size,
              };
            }),
          );
          uploadedAttachments = uploads;
        } catch (err) {
          setUploading(false);
          toast.error((err as Error).message || t("uploadFailed"));
          return;
        }
        setUploading(false);
      }

      const res = await addTaskCommentAction({
        taskId,
        body: trimmed.length > 0 ? trimmed : t("attachmentsOnly"),
        kind: submitKind,
        isInternal,
        attachments: uploadedAttachments,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.mentionsResolved > 0
          ? mode === "message"
            ? t("toasts.messageWithMentions", { count: res.mentionsResolved })
            : t("toasts.noteWithMentions", { count: res.mentionsResolved })
          : mode === "message"
            ? t("toasts.messageSent")
            : t("toasts.notePosted"),
      );
      setBody("");
      setFiles([]);
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
        "rounded-2xl border border-soft bg-card transition-[box-shadow,transform] duration-200",
        mentionState && mentionMatches.length > 0 ? "overflow-visible" : "overflow-hidden",
        floating && "shadow-[0_-10px_30px_rgba(0,0,0,0.08)]",
        floating && !expanded && "translate-y-1",
      )}
    >
      {/* Mode tabs — Rwasem-style: Send message / Log note */}
      <div className="flex items-center gap-0 border-b border-soft bg-soft-1/40 px-2">
        {(
          [
            { value: "message" as const, label: t("tabs.message"), icon: MessageSquare },
            { value: "note" as const, label: t("tabs.note"), icon: FileText },
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
              {kindOptions.map((opt) => {
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
        <div className="relative">
          <Textarea
            ref={textareaRef}
            rows={expanded ? 3 : 1}
            value={body}
            onChange={(e) =>
              updateBody(e.target.value, e.target.selectionStart ?? e.target.value.length)
            }
            onKeyDown={(e) => {
              // Mention navigation takes priority while open.
              if (mentionState && mentionMatches.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionState((s) =>
                    s ? { ...s, activeIndex: (s.activeIndex + 1) % mentionMatches.length } : s,
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionState((s) =>
                    s
                      ? {
                          ...s,
                          activeIndex:
                            (s.activeIndex - 1 + mentionMatches.length) % mentionMatches.length,
                        }
                      : s,
                  );
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  insertMention(mentionMatches[mentionState.activeIndex]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionState(null);
                  return;
                }
              }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
            onSelect={(e) => {
              // Re-evaluate on caret moves (e.g. arrow keys) so the dropdown
              // updates if the user navigates back into a mention.
              const ta = e.currentTarget;
              const detected = detectMention(ta.value, ta.selectionStart);
              if (!detected) {
                if (mentionState) setMentionState(null);
              } else if (
                !mentionState ||
                mentionState.atIndex !== detected.atIndex ||
                mentionState.query !== detected.query
              ) {
                setMentionState({
                  query: detected.query,
                  atIndex: detected.atIndex,
                  activeIndex: 0,
                });
              }
            }}
            className={cn(
              "transition-[min-height,height] duration-200",
              floating && !expanded && "min-h-0 resize-none overflow-hidden py-2",
            )}
            placeholder={
              mode === "message"
                ? t("placeholders.message")
                : t("placeholders.note")
            }
          />

          {mentionState && mentionMatches.length > 0 && (
            <div
              role="listbox"
              aria-label={t("mentionSuggestions")}
              className="absolute bottom-full start-0 mb-1 max-h-96 w-80 overflow-y-auto rounded-lg border border-soft-2 bg-popover shadow-lg z-50"
            >
              <div className="sticky top-0 border-b border-soft bg-popover/95 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
                {t("matches", { count: mentionMatches.length })}
                {mentionState.query ? ` ${t("forQuery", { query: mentionState.query })}` : ""}
              </div>
              {mentionMatches.map((emp, idx) => {
                const active = idx === mentionState.activeIndex;
                return (
                  <button
                    key={emp.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseDown={(e) => {
                      // mouseDown so the textarea doesn't lose focus first.
                      e.preventDefault();
                      insertMention(emp);
                    }}
                    onMouseEnter={() =>
                      setMentionState((s) => (s ? { ...s, activeIndex: idx } : s))
                    }
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-start text-xs transition-colors",
                      active ? "bg-cyan/15 text-foreground" : "hover:bg-muted",
                    )}
                  >
                    <Avatar size="sm" className="size-7">
                      {emp.avatarUrl && <AvatarImage src={emp.avatarUrl} alt={emp.name} />}
                      <AvatarFallback className="text-[10px]">
                        {emp.name.trim()[0] ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{emp.name}</span>
                      {emp.jobTitle && (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {emp.jobTitle}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {hasFiles && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span
                key={f.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-soft-2 bg-soft-1 px-2 py-0.5 text-[11px]"
                title={f.file.name}
              >
                <Paperclip className="size-3 text-muted-foreground" />
                <span className="max-w-[14rem] truncate">{f.file.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {(f.file.size / 1024).toFixed(0)}KB
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t("removeAttachment")}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            expanded ? "max-h-16 pt-2 opacity-100" : "max-h-0 pt-0 opacity-0",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending || uploading || files.length >= MAX_FILES}
                className="inline-flex items-center gap-1 rounded-full border border-soft-2 bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-cyan/30 hover:text-cyan disabled:opacity-50"
                aria-label={t("attachFiles")}
              >
                <Paperclip className="size-3.5" />
                {t("attach")}
              </button>
              <p className="text-[11px] text-muted-foreground">
                {t("shortcut")}
              </p>
            </div>
            <Button
              onClick={submit}
              disabled={pending || uploading || (!hasBody && !hasFiles)}
              size="sm"
            >
              {pending || uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {uploading
                ? t("uploading")
                : mode === "message"
                  ? t("send")
                  : t("post")}
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
        <div className="mx-auto w-full max-w-6xl">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background via-background/85 to-transparent" />
          <div className="pointer-events-auto relative">{composerCard}</div>
        </div>
      </div>
    </>
  );
}
