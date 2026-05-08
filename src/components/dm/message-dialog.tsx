"use client";

// Modal that loads the conversation between caller ↔ recipientEmployeeId,
// shows the last 50 messages, and lets the caller send a new message
// (text + up to 8 file attachments). On open, marks any incoming unread
// messages as read.

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  Loader2, Paperclip, Send, X, FileText,
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import {
  sendDirectMessageAction,
  listConversationAction,
  getDmAttachmentTicketAction,
  type ConversationMessage,
} from "@/app/(dashboard)/messages/_actions";

type StagedAttachment = {
  filename: string;
  mimetype: string | null;
  size_bytes: number | null;
  storage_path: string;
};

const browserSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

export function DirectMessageDialog({
  recipientEmployeeId,
  recipientName,
  contextTaskId,
  contextProjectId,
  onClose,
}: {
  recipientEmployeeId: string;
  recipientName: string;
  contextTaskId: string | null;
  contextProjectId: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [otherJobTitle, setOtherJobTitle] = useState<string | null>(null);
  const [otherAvatarUrl, setOtherAvatarUrl] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [pending, start] = useTransition();
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Initial load + after every successful send.
  const reload = async () => {
    setLoading(true);
    const res = await listConversationAction(recipientEmployeeId, 50);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setMessages(res.messages);
    setOtherJobTitle(res.otherJobTitle);
    setOtherAvatarUrl(res.otherAvatarUrl);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientEmployeeId]);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingFile(true);
    try {
      const remainingSlots = 8 - staged.length;
      const slice = Array.from(files).slice(0, remainingSlots);
      for (const f of slice) {
        const ticket = await getDmAttachmentTicketAction(f.name);
        if (!ticket.ok) {
          toast.error(ticket.error);
          continue;
        }
        const supa = browserSupabase();
        const { error: upErr } = await supa.storage
          .from("attachments")
          .uploadToSignedUrl(ticket.storage_path, ticket.signed_token, f, {
            contentType: f.type || undefined,
          });
        if (upErr) {
          toast.error(`تعذر رفع ${f.name}: ${upErr.message}`);
          continue;
        }
        setStaged((prev) => [
          ...prev,
          {
            filename: f.name,
            mimetype: f.type || null,
            size_bytes: f.size,
            storage_path: ticket.storage_path,
          },
        ]);
      }
    } finally {
      setUploadingFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed && staged.length === 0) return;
    start(async () => {
      const res = await sendDirectMessageAction({
        recipientEmployeeId,
        body: trimmed,
        contextTaskId,
        contextProjectId,
        attachments: staged,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setBody("");
      setStaged([]);
      await reload();
    });
  };

  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[640px] w-[min(100%,520px)] flex-col overflow-hidden rounded-2xl border border-soft bg-card shadow-2xl">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-soft bg-soft-1/30 px-4 py-3">
          {otherAvatarUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={otherAvatarUrl}
              alt={recipientName}
              className="size-9 rounded-full object-cover"
            />
          ) : (
            <span className="grid size-9 place-items-center rounded-full bg-cyan/20 text-sm font-semibold text-cyan">
              {recipientName.slice(0, 1)}
            </span>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight">{recipientName}</p>
            {otherJobTitle && (
              <p className="text-[11px] text-muted-foreground leading-tight">
                {otherJobTitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-soft-1 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="grid h-full place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">
              لا توجد رسائل بعد. ابدأ المحادثة بكتابة رسالة أدناه.
            </p>
          ) : (
            messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-soft bg-soft-1/30 p-3 space-y-2">
          {staged.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {staged.map((s, i) => (
                <span
                  key={s.storage_path}
                  className="inline-flex items-center gap-1 rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] text-cyan"
                >
                  <FileText className="size-3" />
                  <span className="truncate max-w-[140px]">{s.filename}</span>
                  <button
                    type="button"
                    aria-label={`إزالة ${s.filename}`}
                    onClick={() =>
                      setStaged((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="opacity-70 hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadingFile || staged.length >= 8}
              aria-label="إرفاق ملف"
              className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-soft-1 hover:text-foreground disabled:opacity-50"
            >
              {uploadingFile ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => onPickFiles(e.target.files)}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              placeholder="اكتب رسالة… (Cmd/Ctrl+Enter للإرسال)"
              className="min-w-0 flex-1 resize-none rounded-md border border-input bg-input px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <button
              type="button"
              onClick={submit}
              disabled={pending || (!body.trim() && staged.length === 0)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity",
                "disabled:opacity-50",
              )}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              إرسال
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MessageBubble({ message: m }: { message: ConversationMessage }) {
  const time = new Date(m.created_at).toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={cn("flex", m.is_mine ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3 py-1.5 text-sm",
          m.is_mine ? "bg-cyan-dim text-foreground" : "bg-soft-2 text-foreground",
        )}
      >
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        {m.attachments.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {m.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <FileText className="size-3" />
                <span className="truncate">{a.filename}</span>
                {a.size_bytes && (
                  <span className="opacity-70">
                    ({Math.round((a.size_bytes / 1024) * 10) / 10} KB)
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground/80" dir="ltr">
          {time}
          {m.is_mine && m.read_at && <span className="ms-1 text-cyan">مقروء</span>}
        </p>
      </div>
    </div>
  );
}
