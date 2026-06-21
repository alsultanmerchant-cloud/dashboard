"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName } from "ai";
import { useRef, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Bot,
  Send,
  Sparkles,
  RotateCcw,
  Copy,
  Check,
  TrendingUp,
  Users,
  Headphones,
  DollarSign,
  Target,
  BarChart3,
  MessageSquarePlus,
  Trash2,
  Globe,
  Database,
  PanelRightOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useOrg } from "@/lib/org-context";

interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
}

// Sky Light feedback #9: AI assistant chat history must survive navigation.
// We persist conversations + per-conversation messages to sessionStorage so
// switching pages (or briefly reloading) doesn't wipe the thread.
// Keys are namespaced under `mr-agent-*` to avoid colliding with other
// session state.
const STORAGE_KEYS = {
  conversations: "mr-agent-conversations",
  active: "mr-agent-active-conversation",
  messagesPrefix: "mr-agent-messages:",
} as const;

function readStorage<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — silently fail.
  }
}

const SUGGESTED_PROMPTS = [
  {
    icon: TrendingUp,
    key: "sales",
    color: "text-cyan",
    bg: "bg-cyan/10 hover:bg-cyan/20 border-cyan/20",
  },
  {
    icon: Users,
    key: "team",
    color: "text-cc-green",
    bg: "bg-cc-green/10 hover:bg-cc-green/20 border-cc-green/20",
  },
  {
    icon: Headphones,
    key: "support",
    color: "text-amber",
    bg: "bg-amber/10 hover:bg-amber/20 border-amber/20",
  },
  {
    icon: DollarSign,
    key: "finance",
    color: "text-cc-purple",
    bg: "bg-cc-purple/10 hover:bg-cc-purple/20 border-cc-purple/20",
  },
  {
    icon: Target,
    key: "targets",
    color: "text-pink",
    bg: "bg-pink/10 hover:bg-pink/20 border-pink/20",
  },
  {
    icon: BarChart3,
    key: "forecast",
    color: "text-cc-blue",
    bg: "bg-cc-blue/10 hover:bg-cc-blue/20 border-cc-blue/20",
  },
];

export default function AgentPage() {
  const { orgId } = useOrg();
  const locale = useLocale();
  const t = useTranslations("AIAgent");
  // §9.2: stash the active conversation id in a ref so the transport's
  // body callback (called per-send) always sees the latest value without
  // having to remount the chat. The chat's `body` accepts either an object
  // or a function — the function form runs at send time.
  const activeConversationRef = useRef<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent",
      body: () => ({
        orgId,
        conversationId: activeConversationRef.current,
        locale,
      }),
    }),
    onError: (err) => {
      console.error("AI chat error:", err);
      setChatError(
        err instanceof Error
          ? err.message
          : t("errors.connection"),
      );
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Detect a "silent finish": stream ended (status === 'ready') and the last
  // assistant message has only tool parts with no text. Gemini-3-flash sometimes
  // returns STOP after a tool call without follow-up text — without this the
  // user just sees query indicators and nothing else.
  useEffect(() => {
    if (status !== "ready" || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return;
    const hasText = last.parts?.some(
      (p) => p.type === "text" && (p as { text?: string }).text?.trim(),
    );
    const hasTools = last.parts?.some((p) => isToolUIPart(p));
    if (!hasText && hasTools) {
      setChatError(
        t("errors.silentFinish"),
      );
    }
  }, [status, messages, t]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Tracks whether we've already attempted to hydrate from sessionStorage.
  // Without this guard the persistence effect would clobber session data
  // with the empty initial useChat state on the very first render.
  const hydratedRef = useRef(false);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // §9.2: hydrate the conversation sidebar from the DB on first mount.
  // Falls back to sessionStorage (legacy) so users mid-thread aren't
  // wiped during the transition. Runs once per mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/agent/conversations");
        if (res.ok) {
          const data = (await res.json()) as {
            conversations: Array<{
              id: string;
              title: string | null;
              created_at: string;
              updated_at: string;
            }>;
          };
          if (!cancelled && data.conversations.length > 0) {
            setConversations(
              data.conversations.map((c) => ({
                id: c.id,
                title: c.title ?? t("untitledConversation"),
                createdAt: new Date(c.created_at),
              })),
            );
          }
        }
      } catch (e) {
        console.warn("Failed to hydrate conversations from DB:", e);
      }
      // Legacy sessionStorage fallback for active conversation + messages.
      // Once DB-backed conversation loading is wired into the sidebar, the
      // remaining sessionStorage layer can be removed.
      const savedActive = readStorage<string>(STORAGE_KEYS.active);
      if (savedActive && !cancelled) {
        setActiveConversation(savedActive);
        activeConversationRef.current = savedActive;
        const savedMessages = readStorage<typeof messages>(
          `${STORAGE_KEYS.messagesPrefix}${savedActive}`,
        );
        if (savedMessages && savedMessages.length > 0) {
          setMessages(savedMessages);
        }
      }
      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist conversations sidebar.
  useEffect(() => {
    if (!hydratedRef.current) return;
    writeStorage(STORAGE_KEYS.conversations, conversations);
  }, [conversations]);

  // Persist the currently active conversation id.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (activeConversation) {
      writeStorage(STORAGE_KEYS.active, activeConversation);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEYS.active);
    }
  }, [activeConversation]);

  // Persist messages for the active conversation. Skip while we haven't
  // hydrated yet, otherwise the empty initial useChat state would wipe
  // the saved messages before they're loaded.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (!activeConversation) return;
    if (messages.length === 0) return;
    writeStorage(`${STORAGE_KEYS.messagesPrefix}${activeConversation}`, messages);
  }, [messages, activeConversation]);

  // §9.2: on first user message, create a real DB-backed conversation
  // so the server can persist messages. activeConversationRef is updated
  // synchronously so the *next* sendMessage (within the same render) ships
  // the new id to the server. Note: the first user message itself was
  // already sent without a conversationId, but that's fine — the user
  // text is captured client-side by useChat, and subsequent persistence
  // (assistant turn + next user turn) does go through the DB. A future
  // refinement could batch-create the conversation pre-send.
  useEffect(() => {
    if (messages.length === 1 && messages[0].role === "user" && !activeConversation) {
      const firstMsg = messages[0].parts
        ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("") || "";
      const title = firstMsg.slice(0, 50) + (firstMsg.length > 50 ? "..." : "");
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch("/api/agent/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              conversation: { id: string; title: string | null; created_at: string };
            };
            if (cancelled) return;
            const id = data.conversation.id;
            activeConversationRef.current = id;
            setActiveConversation(id);
            setConversations((prev) => [
              {
                id,
                title: data.conversation.title ?? title,
                createdAt: new Date(data.conversation.created_at),
              },
              ...prev,
            ]);
          }
        } catch (e) {
          console.warn("Failed to create conversation in DB:", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [messages, activeConversation]);

  const submitMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    setChatError(null);
    setInput("");
    // §9.2: pre-create a DB-backed conversation so the *first* user message
    // (and its assistant reply) are persisted. Without this the first turn
    // ships without a conversationId and the server skips persistence.
    if (!activeConversationRef.current) {
      const title = text.trim().slice(0, 50) + (text.length > 50 ? "..." : "");
      try {
        const res = await fetch("/api/agent/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            conversation: { id: string; title: string | null; created_at: string };
          };
          const id = data.conversation.id;
          activeConversationRef.current = id;
          setActiveConversation(id);
          setConversations((prev) => [
            {
              id,
              title: data.conversation.title ?? title,
              createdAt: new Date(data.conversation.created_at),
            },
            ...prev,
          ]);
        }
      } catch (e) {
        console.warn("Failed to create conversation in DB:", e);
      }
    }
    await sendMessage({ text: text.trim() });
  };

  const handlePromptClick = (prompt: string) => {
    submitMessage(prompt);
  };

  const handleNewChat = () => {
    setMessages([]);
    setInput("");
    setActiveConversation(null);
    activeConversationRef.current = null;
    setHistoryOpen(false);
    inputRef.current?.focus();
  };

  const openConversation = async (id: string) => {
    // §9.2: load messages from the DB. Falls back to the legacy
    // sessionStorage cache if the DB call fails (so a flaky connection
    // doesn't lock the user out of their old chats).
    setActiveConversation(id);
    activeConversationRef.current = id;
    setHistoryOpen(false);
    try {
      const res = await fetch(`/api/agent/conversations/${id}`);
      if (res.ok) {
        const data = (await res.json()) as {
          messages: Array<{ id: string; role: string; content: unknown; created_at: string }>;
        };
        // Map DB rows back to the useChat message shape. content is the
        // full UIMessage we persisted in `route.ts` — assistant rows store
        // `{ type: "text", text }` and user rows store the original
        // message object. We re-wrap each into a single-part UIMessage.
        const mapped = data.messages.map((m) => {
          const c = m.content as
            | { type?: string; text?: string; parts?: unknown[]; role?: string }
            | null;
          if (c && Array.isArray(c.parts)) {
            // User messages were stored as the original UI message; reuse.
            return { id: m.id, role: m.role, parts: c.parts } as unknown as (typeof messages)[number];
          }
          // Assistant rows stored as { type: 'text', text }.
          const text =
            (c && typeof c.text === "string" ? c.text : "") || "";
          return {
            id: m.id,
            role: m.role,
            parts: [{ type: "text", text }],
          } as unknown as (typeof messages)[number];
        });
        setMessages(mapped);
        inputRef.current?.focus();
        return;
      }
    } catch (e) {
      console.warn("Failed to load conversation from DB:", e);
    }
    // Fallback to sessionStorage.
    const saved = readStorage<typeof messages>(`${STORAGE_KEYS.messagesPrefix}${id}`);
    setMessages(saved ?? []);
    inputRef.current?.focus();
  };

  const deleteConversation = async (id: string) => {
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(`${STORAGE_KEYS.messagesPrefix}${id}`);
      } catch {
        // ignore
      }
    }
    // Best-effort DB delete — fire-and-forget. Cascade removes messages.
    fetch(`/api/agent/conversations/${id}`, { method: "DELETE" }).catch(() => {
      // ignore
    });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversation === id) handleNewChat();
  };

  const copyText = async (content: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(content);
        return true;
      } catch {
        // Fall through to the DOM-based copy path when clipboard access is denied.
      }
    }

    if (typeof document === "undefined") return false;

    const textArea = document.createElement("textarea");
    textArea.value = content;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    textArea.style.opacity = "0";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(textArea);
    }
  };

  const copyMessage = async (id: string, content: string) => {
    const didCopy = await copyText(content);
    if (!didCopy) return;
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitMessage(input);
    }
  };

  const getMessageText = (msg: typeof messages[number]): string => {
    if ("content" in msg && typeof msg.content === "string") return msg.content;
    return (
      msg.parts
        ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("") || ""
    );
  };

  const conversationsList = (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="p-3 border-b border-border">
        <Button
          onClick={handleNewChat}
          variant="outline"
          className="w-full gap-2 border-cyan/30 text-xs text-cyan hover:bg-cyan/10 rtl:justify-end ltr:justify-start"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          {t("newConversation")}
        </Button>
      </div>
      <ScrollArea className="flex-1 p-2">
        {conversations.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <Bot className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-[11px] text-muted-foreground">{t("noConversations")}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => openConversation(conv.id)}
                className={cn(
                  "group flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-xs transition-colors",
                  activeConversation === conv.id
                    ? "bg-cyan/10 text-cyan"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <span className="flex-1 truncate">{conv.title}</span>
                <Trash2
                  className="mx-1 h-3 w-3 flex-shrink-0 opacity-0 group-hover:opacity-50 hover:!opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );

  return (
    <div
      className="relative flex h-[calc(100dvh-11.5rem)] min-h-[34rem] flex-col gap-4 lg:h-[calc(100vh-7rem)] lg:min-h-0 lg:flex-row rtl:lg:flex-row-reverse"
    >
      {/* Desktop conversations rail */}
      <div className="hidden w-[240px] flex-shrink-0 overflow-hidden rounded-xl cc-card lg:flex lg:flex-col">
        {conversationsList}
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side={locale === "ar" ? "right" : "left"}
          className="w-[88vw] max-w-[360px] border-border bg-card p-0 sm:w-[360px]"
        >
          <SheetHeader className="border-b border-border">
            <SheetTitle>{t("conversations")}</SheetTitle>
            <SheetDescription>
              {t("historyDescription")}
            </SheetDescription>
          </SheetHeader>
          {conversationsList}
        </SheetContent>
      </Sheet>

      {/* Main Chat Area */}
      <div className="flex min-h-[70vh] flex-1 flex-col overflow-hidden rounded-xl cc-card lg:min-h-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5 rtl:flex-row-reverse">
          <div className="flex min-w-0 items-center gap-3 rtl:flex-row-reverse">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan to-cc-purple">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 text-start">
              <div className="mb-1 flex flex-wrap items-center gap-2 rtl:flex-row-reverse">
                <span className="rounded-full border border-cyan/20 bg-cyan/10 px-2 py-0.5 text-[10px] font-semibold text-cyan">
                  AI Copilot
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t("poweredByCompanyData")}
                </span>
              </div>
              <h3 className="truncate text-sm font-bold text-foreground sm:text-base">
                {t("title")}
              </h3>
              <p className="text-[10px] text-muted-foreground sm:text-[11px]">
                {t("subtitle")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rtl:flex-row-reverse">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHistoryOpen(true)}
              className="lg:hidden rounded-xl bg-soft-2 hover:bg-soft-2"
              aria-label={t("openConversations")}
            >
              <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
            </Button>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNewChat}
                className="gap-1.5 text-xs text-muted-foreground"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="hidden sm:inline">{t("newConversation")}</span>
                <span className="sm:hidden">{t("newShort")}</span>
              </Button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5" ref={scrollRef}>
          {messages.length === 0 ? (
            /* Empty State — Suggested Prompts */
            <div className="flex h-full flex-col items-center justify-center py-8 sm:py-12">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan/20 to-cc-purple/20 sm:h-16 sm:w-16">
                <Sparkles className="w-8 h-8 text-cyan" />
              </div>
              <h2 className="mb-1 text-center text-lg font-bold text-foreground">
                {t("empty.title")}
              </h2>
              <p className="mb-6 max-w-md text-center text-xs leading-6 text-muted-foreground sm:mb-8">
                {t("empty.description")}
              </p>

            <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {SUGGESTED_PROMPTS.map((item) => {
                const Icon = item.icon;
                const prompt = t(`prompts.${item.key}.prompt`);
                return (
                  <button
                    key={item.key}
                    onClick={() => handlePromptClick(prompt)}
                    className={cn(
                        "flex items-start gap-3 rounded-xl border p-3.5 text-start transition-all",
                        item.bg
                      )}
                    >
                      <Icon className={cn("w-5 h-5 mt-0.5 flex-shrink-0", item.color)} />
                      <div>
                        <p className={cn("text-xs font-bold", item.color)}>{t(`prompts.${item.key}.label`)}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                          {prompt}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Chat Messages */
            <div className="space-y-5 py-4 sm:space-y-6 sm:py-5">
              {messages.map((msg) => {
                const text = getMessageText(msg);
                return (
                  <div key={msg.id} className="flex gap-2.5 sm:gap-3 rtl:flex-row-reverse">
                    {/* Avatar */}
                    <div
                      className={cn(
                        "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
                        msg.role === "user"
                          ? "bg-cyan/15"
                          : "bg-gradient-to-br from-cyan/20 to-cc-purple/20"
                      )}
                    >
                      {msg.role === "user" ? (
                        <span className="text-xs font-bold text-cyan">{t("userInitial")}</span>
                      ) : (
                        <Bot className="w-4 h-4 text-cyan" />
                      )}
                    </div>

                    {/* Message Content */}
                    <div className="flex-1 min-w-0 text-start">
                      <div className="mb-1 flex items-center gap-2 rtl:flex-row-reverse">
                        <span className="text-xs font-bold text-foreground">
                          {msg.role === "user" ? t("you") : t("title")}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date().toLocaleTimeString(
                            locale === "ar" ? "ar-SA-u-nu-latn" : "en-US",
                            {
                            hour: "2-digit",
                            minute: "2-digit",
                            },
                          )}
                        </span>
                      </div>

                      {/* Render parts in order for assistant messages */}
                      {msg.role === "assistant" ? (
                        <div className="space-y-2">
                          {msg.parts?.map((part, i) => {
                            // Tool invocation parts — show tool-specific skeletons
                            if (isToolUIPart(part)) {
                              const name = getToolName(part);
                              const isDone = part.state === "output-available" || part.state === "output-error";

                              if (name === "webSearch" && !isDone) {
                                return (
                                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-cyan/5 border border-cyan/15 animate-pulse">
                                    <Globe className="w-4 h-4 text-cyan animate-spin" style={{ animationDuration: "2s" }} />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-cyan">{t("tools.webSearching")}</p>
                                      <div className="flex gap-2 mt-1.5">
                                        <div className="h-2 w-24 bg-cyan/10 rounded-full" />
                                        <div className="h-2 w-16 bg-cyan/10 rounded-full" />
                                        <div className="h-2 w-20 bg-cyan/10 rounded-full" />
                                      </div>
                                    </div>
                                  </div>
                                );
                              }

                              if (name === "webSearch" && isDone) {
                                return (
                                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan/5 border border-cyan/10 text-[11px] text-cyan/70">
                                    <Globe className="w-3 h-3" />
                                    {t("tools.webSearched")}
                                  </div>
                                );
                              }

                              if (name === "queryDatabase" && !isDone) {
                                return (
                                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-cc-purple/5 border border-cc-purple/15 animate-pulse">
                                    <Database className="w-4 h-4 text-cc-purple animate-pulse" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-cc-purple">{t("tools.databaseQuerying")}</p>
                                      <div className="flex gap-2 mt-1.5">
                                        <div className="h-2 w-20 bg-cc-purple/10 rounded-full" />
                                        <div className="h-2 w-28 bg-cc-purple/10 rounded-full" />
                                        <div className="h-2 w-14 bg-cc-purple/10 rounded-full" />
                                      </div>
                                    </div>
                                  </div>
                                );
                              }

                              if (name === "queryDatabase" && isDone) {
                                return (
                                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cc-purple/5 border border-cc-purple/10 text-[11px] text-cc-purple/70">
                                    <Database className="w-3 h-3" />
                                    {t("tools.databaseQueried")}
                                  </div>
                                );
                              }

                              // Generic skeleton/done for any other tool
                              // (odoo*, dashboard*, etc.). Without this they
                              // render nothing while the model is waiting,
                              // making it look stuck.
                              const labelKeyMap: Record<string, string> = {
                                odooListProjects: "odooProjects",
                                odooGetProject: "odooProject",
                                odooListClients: "odooClients",
                                odooGetClient: "odooClient",
                                odooListTasks: "odooTasks",
                                odooGetTask: "odooTask",
                                odooGetTaskMessages: "taskMessages",
                                odooListEmployees: "odooEmployees",
                                odooGetEmployee: "odooEmployee",
                                dashboardGetTaskTimeline: "taskTimeline",
                                dashboardGetProjectStageActivity: "projectActivity",
                              };
                              const labelKey = labelKeyMap[name];
                              const label = labelKey ? t(`tools.labels.${labelKey}`) : name;
                              if (!isDone) {
                                return (
                                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-cc-blue/5 border border-cc-blue/15 animate-pulse">
                                    <Database className="w-4 h-4 text-cc-blue animate-pulse" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-cc-blue">{t("tools.fetching", { label })}</p>
                                      <div className="flex gap-2 mt-1.5">
                                        <div className="h-2 w-20 bg-cc-blue/10 rounded-full" />
                                        <div className="h-2 w-28 bg-cc-blue/10 rounded-full" />
                                        <div className="h-2 w-14 bg-cc-blue/10 rounded-full" />
                                      </div>
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cc-blue/5 border border-cc-blue/10 text-[11px] text-cc-blue/70">
                                  <Database className="w-3 h-3" />
                                  {t("tools.fetched", { label })}
                                </div>
                              );
                            }

                            // Text parts
                            if (part.type === "text" && part.text) {
                              return (
                                <div key={i} className="prose prose-invert prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-td:text-foreground/80 prose-th:text-foreground prose-li:text-foreground/90 [&_table]:w-full [&_table]:text-xs [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_td]:px-3 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-border [&_th]:border-b [&_th]:border-border [&_th]:text-start [&_td]:text-start text-sm leading-relaxed text-foreground/90">
                                  <MessageContent content={part.text} />
                                </div>
                              );
                            }

                            return null;
                          })}
                        </div>
                      ) : (
                        <div className="text-sm leading-relaxed text-foreground">
                          <p>{text}</p>
                        </div>
                      )}

                      {/* Copy button for assistant messages */}
                      {msg.role === "assistant" && text && (
                        <button
                          onClick={() => copyMessage(msg.id, text)}
                          className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground rtl:flex-row-reverse"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3 h-3 text-cc-green" />
                              <span className="text-cc-green">{t("copied")}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              {t("copy")}
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Generic loading — only when no assistant message exists yet */}
              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-3 rtl:flex-row-reverse">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan/20 to-cc-purple/20 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-cyan" />
                  </div>
                  <div className="flex items-center gap-2 pt-2 rtl:flex-row-reverse">
                    <span className="text-xs text-muted-foreground">{t("thinking")}</span>
                    <span className="w-1.5 h-1.5 bg-cyan rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-cyan rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-cyan rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {chatError && (
          <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 sm:mx-4">
            <span className="font-semibold">⚠️</span>
            <div className="flex-1 text-start">{chatError}</div>
            <button
              type="button"
              onClick={() => setChatError(null)}
              className="text-red-600/70 hover:text-red-600"
              aria-label={t("close")}
            >
              ×
            </button>
          </div>
        )}

        {/* Input Area — always visible */}
        <div className="sticky bottom-0 z-10 flex-shrink-0 border-t border-border bg-card/95 p-3 backdrop-blur-sm sm:p-4">
          <div className="flex items-end gap-2 sm:gap-3 rtl:flex-row-reverse">
            <div className="relative flex-1">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("placeholder")}
                rows={1}
                className="w-full resize-none rounded-xl border border-border bg-muted/50 px-3.5 py-3 text-start text-sm text-foreground transition-colors placeholder:text-muted-foreground focus:border-cyan/50 focus:outline-none focus:ring-1 focus:ring-cyan/25"
                style={{ minHeight: "48px", maxHeight: "120px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "48px";
                  target.style.height = Math.min(target.scrollHeight, 120) + "px";
                }}
              />
            </div>
            <Button
              type="button"
              onClick={() => submitMessage(input)}
              disabled={!input.trim() || isLoading}
              className="h-12 w-12 rounded-xl bg-gradient-to-br from-cyan to-cyan/80 text-background hover:from-cyan/90 hover:to-cyan/70 disabled:opacity-30"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            {t("footer")}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Simple markdown renderer for assistant messages */
function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
  let tableHeaders: string[] = [];

  const flushTable = () => {
    if (tableHeaders.length > 0) {
      elements.push(
        <div key={`table-${elements.length}`} className="overflow-x-auto my-3">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                {tableHeaders.map((h, i) => (
                  <th key={i} className="bg-muted px-3 py-1.5 text-start font-bold border-b border-border">
                    {h.trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 border-b border-border text-start">
                      {cell.trim()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    inTable = false;
    tableRows = [];
    tableHeaders = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Table detection
    if (line.includes("|") && line.trim().startsWith("|")) {
      const cells = line.split("|").filter((c) => c.trim() !== "");
      if (!inTable) {
        inTable = true;
        tableHeaders = cells;
      } else if (cells.every((c) => /^[-:]+$/.test(c.trim()))) {
        continue;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (line.startsWith("### ")) {
      elements.push(
        <h4 key={i} className="text-sm font-bold text-foreground mt-4 mb-2">
          {formatInline(line.slice(4))}
        </h4>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h3 key={i} className="text-base font-bold text-foreground mt-4 mb-2">
          {formatInline(line.slice(3))}
        </h3>
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h2 key={i} className="text-lg font-bold text-foreground mt-4 mb-2">
          {formatInline(line.slice(2))}
        </h2>
      );
    } else if (line.trim() === "---" || line.trim() === "***") {
      elements.push(<hr key={i} className="border-border my-3" />);
    } else if (line.match(/^[-*]\s/)) {
      elements.push(
        <div key={i} className="flex gap-2 my-0.5 px-2">
          <span className="text-cyan mt-1">•</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)/)!;
      elements.push(
        <div key={i} className="flex gap-2 my-0.5 px-2">
          <span className="text-cyan font-bold min-w-[1.2rem]">{match[1]}.</span>
          <span>{formatInline(match[2])}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(
        <p key={i} className="my-0.5">
          {formatInline(line)}
        </p>
      );
    }
  }

  if (inTable) flushTable();

  return <>{elements}</>;
}

function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`(.+?)`/);

    const matches = [
      boldMatch ? { type: "bold", index: boldMatch.index!, match: boldMatch } : null,
      codeMatch ? { type: "code", index: codeMatch.index!, match: codeMatch } : null,
    ]
      .filter(Boolean)
      .sort((a, b) => a!.index - b!.index);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const first = matches[0]!;
    if (first.index > 0) {
      parts.push(remaining.slice(0, first.index));
    }

    if (first.type === "bold") {
      parts.push(
        <strong key={key++} className="font-bold text-foreground">
          {first.match[1]}
        </strong>
      );
    } else if (first.type === "code") {
      parts.push(
        <code key={key++} className="px-1 py-0.5 bg-muted rounded text-cyan text-[11px]">
          {first.match[1]}
        </code>
      );
    }

    remaining = remaining.slice(first.index + first.match[0].length);
  }

  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}
