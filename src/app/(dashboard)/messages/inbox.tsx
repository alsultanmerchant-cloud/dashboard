"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@supabase/supabase-js";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  FileText,
  Loader2,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getDmAttachmentTicketAction,
  listConversationAction,
  sendDirectMessageAction,
  type ConversationMessage,
} from "./_actions";

type Conversation = {
  otherEmployeeId: string;
  otherFullName: string;
  otherAvatarUrl: string | null;
  otherJobTitle: string | null;
  latestBody: string | null;
  latestCreatedAt: string;
  unread: number;
};

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

function firstLetter(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

function formatAttachmentSize(sizeBytes: number | null) {
  if (!sizeBytes) return null;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${Math.round(kb * 10) / 10} KB`;
  return `${Math.round((kb / 1024) * 10) / 10} MB`;
}

function MessageBubble({ message, locale }: { message: ConversationMessage; locale: string }) {
  const time = new Date(message.created_at).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={cn("flex", message.is_mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-[22px] px-4 py-3 text-sm shadow-sm sm:max-w-[78%]",
          message.is_mine
            ? "rounded-br-md bg-cyan-dim text-foreground"
            : "rounded-bl-md border border-soft bg-card text-foreground",
        )}
      >
        {message.body && <p className="whitespace-pre-wrap break-words leading-6">{message.body}</p>}
        {message.attachments.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {message.attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex items-center gap-2 rounded-2xl border border-soft bg-background/60 px-3 py-2 text-xs"
              >
                <FileText className="size-3.5 shrink-0 text-cyan" />
                <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
                {attachment.size_bytes ? (
                  <span className="shrink-0 text-muted-foreground">
                    {formatAttachmentSize(attachment.size_bytes)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] tabular-nums text-muted-foreground/80" dir="ltr">
          {time}
          {message.is_mine && message.read_at && <span className="ms-1 text-cyan">مقروء</span>}
        </p>
      </div>
    </div>
  );
}

export function MessagesInbox({
  conversations: initialConversations,
  locale,
}: {
  conversations: Conversation[];
  locale: string;
}) {
  const t = useTranslations("MessagesPage");
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState(initialConversations[0]?.otherEmployeeId ?? null);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [body, setBody] = useState("");
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConversations(initialConversations);
    setSelectedId((current) => current ?? initialConversations[0]?.otherEmployeeId ?? null);
  }, [initialConversations]);

  const relativeFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
    [locale],
  );

  function relativeTime(value: string) {
    const diffSec = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) return relativeFormatter.format(diffSec, "second");
    if (abs < 3600) return relativeFormatter.format(Math.round(diffSec / 60), "minute");
    if (abs < 86400) return relativeFormatter.format(Math.round(diffSec / 3600), "hour");
    if (abs < 2592000) return relativeFormatter.format(Math.round(diffSec / 86400), "day");
    if (abs < 31536000) return relativeFormatter.format(Math.round(diffSec / 2592000), "month");
    return relativeFormatter.format(Math.round(diffSec / 31536000), "year");
  }

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conversation) =>
      `${conversation.otherFullName} ${conversation.otherJobTitle ?? ""} ${conversation.latestBody ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [conversations, search]);

  useEffect(() => {
    if (!selectedId && filteredConversations[0]) {
      setSelectedId(filteredConversations[0].otherEmployeeId);
    }
  }, [filteredConversations, selectedId]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.otherEmployeeId === selectedId) ?? null,
    [conversations, selectedId],
  );

  async function loadConversation(recipientEmployeeId: string, before?: string) {
    setError(null);
    if (before) setLoadingOlder(true);
    else setLoadingThread(true);

    const previousScrollHeight = scrollRef.current?.scrollHeight ?? 0;
    const result = await listConversationAction(recipientEmployeeId, 50, before);

    if (before) setLoadingOlder(false);
    else setLoadingThread(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setHasMore(result.hasMore);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.otherEmployeeId === recipientEmployeeId
          ? {
              ...conversation,
              unread: 0,
              otherAvatarUrl: result.otherAvatarUrl,
              otherJobTitle: result.otherJobTitle,
              otherFullName: result.otherFullName,
            }
          : conversation,
      ),
    );

    if (before) {
      setMessages((current) => [...result.messages, ...current]);
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight - previousScrollHeight;
      });
    } else {
      setMessages(result.messages);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    }
  }

  useEffect(() => {
    if (!selectedConversation) return;
    void loadConversation(selectedConversation.otherEmployeeId);
    setBody("");
    setStaged([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversation?.otherEmployeeId]);

  const unreadCount = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);

  async function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingFile(true);
    try {
      const remainingSlots = 8 - staged.length;
      const slice = Array.from(files).slice(0, remainingSlots);
      for (const file of slice) {
        const ticket = await getDmAttachmentTicketAction(file.name);
        if (!ticket.ok) {
          setError(ticket.error);
          continue;
        }
        const supabase = browserSupabase();
        const { error: uploadError } = await supabase.storage
          .from("attachments")
          .uploadToSignedUrl(ticket.storage_path, ticket.signed_token, file, {
            contentType: file.type || undefined,
          });
        if (uploadError) {
          setError(`${t("uploadFailedPrefix")} ${file.name}: ${uploadError.message}`);
          continue;
        }
        setStaged((current) => [
          ...current,
          {
            filename: file.name,
            mimetype: file.type || null,
            size_bytes: file.size,
            storage_path: ticket.storage_path,
          },
        ]);
      }
    } finally {
      setUploadingFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function submit() {
    if (!selectedConversation) return;
    const trimmed = body.trim();
    if (!trimmed && staged.length === 0) return;

    startTransition(async () => {
      const result = await sendDirectMessageAction({
        recipientEmployeeId: selectedConversation.otherEmployeeId,
        body: trimmed,
        contextTaskId: null,
        contextProjectId: null,
        attachments: staged,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const sentAt = new Date().toISOString();
      setConversations((current) => {
        const updated = current.map((conversation) =>
          conversation.otherEmployeeId === selectedConversation.otherEmployeeId
            ? {
                ...conversation,
                latestBody: trimmed || t("attachmentFallback"),
                latestCreatedAt: sentAt,
              }
            : conversation,
        );
        updated.sort((a, b) => (a.latestCreatedAt < b.latestCreatedAt ? 1 : -1));
        return [...updated];
      });
      setBody("");
      setStaged([]);
      await loadConversation(selectedConversation.otherEmployeeId);
    });
  }

  const showRailOnMobile = !selectedConversation;
  const showThreadOnMobile = Boolean(selectedConversation);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-[28px] border border-soft bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,251,252,0.92))] shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)]">
      <div className="grid h-full min-h-[640px] flex-1 md:grid-cols-[340px_minmax(0,1fr)]">
        <aside
          className={cn(
            "min-h-0 border-e border-soft bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.08),transparent_38%),linear-gradient(180deg,rgba(244,250,251,0.98),rgba(255,255,255,0.94))]",
            showRailOnMobile ? "block" : "hidden md:block",
          )}
        >
          <div className="border-b border-soft px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-cyan/80">
                  {t("railLabel")}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">{t("title")}</h2>
              </div>
              <div className="rounded-2xl border border-cyan/20 bg-cyan-dim px-3 py-1.5 text-end">
                <p className="text-[10px] uppercase tracking-[0.18em] text-cyan/80">
                  {t("unread")}
                </p>
                <p className="text-sm font-semibold text-cyan">{unreadCount}</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-soft bg-background/80 px-3 py-2 shadow-sm">
              <label className="flex items-center gap-2">
                <Search className="size-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
            <span>{t("conversationCount", { count: filteredConversations.length })}</span>
            {search.trim() ? <span>{t("filtered")}</span> : null}
          </div>

          <div className="h-[calc(100%-168px)] min-h-0 space-y-1 overflow-y-auto px-2 pb-3 md:h-[calc(100%-128px)]">
            {filteredConversations.map((conversation) => {
              const active = selectedConversation?.otherEmployeeId === conversation.otherEmployeeId;
              return (
                <button
                  key={conversation.otherEmployeeId}
                  type="button"
                  onClick={() => setSelectedId(conversation.otherEmployeeId)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-start transition-colors",
                    active
                      ? "bg-foreground text-background shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                      : "hover:bg-card/80",
                  )}
                >
                  <Avatar size="lg" className="size-12 shrink-0">
                    <AvatarImage src={conversation.otherAvatarUrl ?? undefined} alt={conversation.otherFullName} />
                    <AvatarFallback className={cn(active ? "bg-white/12 text-white" : "bg-cyan/15 text-cyan")}>
                      {firstLetter(conversation.otherFullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-sm font-semibold", active ? "text-white" : "text-foreground")}>
                          {conversation.otherFullName}
                        </p>
                        {conversation.otherJobTitle ? (
                          <p className={cn("truncate text-[11px]", active ? "text-white/60" : "text-muted-foreground")}>
                            {conversation.otherJobTitle}
                          </p>
                        ) : null}
                      </div>
                      <span className={cn("shrink-0 text-[11px] tabular-nums", active ? "text-white/60" : "text-muted-foreground")}>
                        {relativeTime(conversation.latestCreatedAt)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <p className={cn("min-w-0 flex-1 truncate text-xs", active ? "text-white/72" : "text-muted-foreground")}>
                        {conversation.latestBody ?? t("attachmentFallback")}
                      </p>
                      {conversation.unread > 0 ? (
                        <span className="grid min-w-6 place-items-center rounded-full bg-cc-red px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {conversation.unread}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}

            {filteredConversations.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto grid size-14 place-items-center rounded-full bg-cyan/10 text-cyan">
                  <Search className="size-5" />
                </div>
                <p className="mt-4 text-sm font-medium">{t("noMatchesTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("noMatchesDescription")}</p>
              </div>
            ) : null}
          </div>
        </aside>

        <section className={cn("min-h-0 min-w-0 bg-[linear-gradient(180deg,rgba(247,250,252,0.82),rgba(255,255,255,0.98))]", showThreadOnMobile ? "block" : "hidden md:block")}>
          {selectedConversation ? (
            <div className="flex h-full min-h-0 flex-col">
              <header className="border-b border-soft bg-background/75 px-4 py-4 backdrop-blur">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="grid size-10 place-items-center rounded-full border border-soft bg-card text-muted-foreground transition-colors hover:text-foreground md:hidden"
                    aria-label={t("backToInbox")}
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                  <Avatar size="lg" className="size-11">
                    <AvatarImage src={selectedConversation.otherAvatarUrl ?? undefined} alt={selectedConversation.otherFullName} />
                    <AvatarFallback className="bg-cyan/15 text-cyan">
                      {firstLetter(selectedConversation.otherFullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-semibold tracking-tight">
                        {selectedConversation.otherFullName}
                      </h3>
                      <span className="rounded-full border border-cyan/20 bg-cyan/10 px-2 py-0.5 text-[11px] font-medium text-cyan">
                        {t("directMessage")}
                      </span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {selectedConversation.otherJobTitle || t("privateThread")}
                    </p>
                  </div>
                </div>
              </header>

              <div className="border-b border-soft bg-background/70 px-4 py-3 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>{t("latestReply", { time: relativeTime(selectedConversation.latestCreatedAt) })}</span>
                  <span>{t("messageCount", { count: messages.length })}</span>
                </div>
              </div>

              <div
                ref={scrollRef}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.06),transparent_30%),linear-gradient(180deg,rgba(247,250,252,0.5),rgba(255,255,255,0.95))] px-4 py-5"
              >
                {loadingThread ? (
                  <div className="grid h-full min-h-[320px] place-items-center text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                ) : error ? (
                  <div className="grid h-full min-h-[320px] place-items-center">
                    <Card className="w-full max-w-md border-amber/30 bg-amber/10">
                      <CardContent className="p-5 text-center">
                        <p className="text-sm font-medium text-amber">{t("threadLoadErrorTitle")}</p>
                        <p className="mt-1 text-xs text-amber/80">{error}</p>
                      </CardContent>
                    </Card>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="grid h-full min-h-[320px] place-items-center">
                    <div className="max-w-sm text-center">
                      <div className="mx-auto grid size-16 place-items-center rounded-full bg-cyan/10 text-cyan">
                        <MessageCircle className="size-6" />
                      </div>
                      <p className="mt-4 text-base font-semibold">{t("emptyThreadTitle")}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{t("emptyThreadDescription")}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {hasMore ? (
                      <div className="flex justify-center pb-1">
                        <button
                          type="button"
                          onClick={() => void loadConversation(selectedConversation.otherEmployeeId, messages[0]?.created_at)}
                          disabled={loadingOlder}
                          className="inline-flex items-center gap-2 rounded-full border border-soft bg-background/90 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50"
                        >
                          {loadingOlder ? <Loader2 className="size-3.5 animate-spin" /> : null}
                          {t("loadOlder")}
                        </button>
                      </div>
                    ) : null}
                    {messages.map((message) => (
                      <MessageBubble key={message.id} message={message} locale={locale} />
                    ))}
                  </>
                )}
              </div>

              <div className="border-t border-soft bg-background/88 p-4 backdrop-blur">
                {staged.length > 0 ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {staged.map((attachment, index) => (
                      <span
                        key={attachment.storage_path}
                        className="inline-flex items-center gap-1.5 rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs text-cyan"
                      >
                        <FileText className="size-3.5" />
                        <span className="max-w-[180px] truncate">{attachment.filename}</span>
                        <button
                          type="button"
                          onClick={() => setStaged((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                          aria-label={`${t("removeAttachment")} ${attachment.filename}`}
                          className="opacity-70 transition-opacity hover:opacity-100"
                        >
                          <X className="size-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="flex items-end gap-3 rounded-[26px] border border-soft bg-card/90 p-3 shadow-sm">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploadingFile || staged.length >= 8}
                    className="grid size-11 shrink-0 place-items-center rounded-full border border-soft bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    aria-label={t("attachFile")}
                  >
                    {uploadingFile ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => void onPickFiles(event.target.files)}
                  />
                  <div className="min-w-0 flex-1">
                    <textarea
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          submit();
                        }
                      }}
                      rows={2}
                      placeholder={t("composerPlaceholder")}
                      className="min-h-12 w-full resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("composerHint")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={pending || (!body.trim() && staged.length === 0)}
                    className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity disabled:opacity-50"
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    <span className="hidden sm:inline">{t("send")}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid h-full min-h-0 place-items-center px-6">
              <div className="max-w-md text-center">
                <div className="mx-auto grid size-20 place-items-center rounded-full bg-cyan/10 text-cyan">
                  <MessageCircle className="size-8" />
                </div>
                <h3 className="mt-5 text-2xl font-semibold tracking-tight">{t("selectConversationTitle")}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t("selectConversationDescription")}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
