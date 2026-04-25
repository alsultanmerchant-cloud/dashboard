"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName } from "ai";
import { useRef, useEffect, useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useOrg } from "@/lib/org-context";

interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
}

const SUGGESTED_PROMPTS = [
  {
    icon: TrendingUp,
    label: "تحليل المبيعات",
    prompt: "حلل أداء المبيعات هالشهر وقارنه بالأشهر السابقة",
    color: "text-cyan",
    bg: "bg-cyan/10 hover:bg-cyan/20 border-cyan/20",
  },
  {
    icon: Users,
    label: "أداء الفريق",
    prompt: "مين أفضل موظف في الفريق ومين يحتاج دعم؟ أبي تفاصيل",
    color: "text-cc-green",
    bg: "bg-cc-green/10 hover:bg-cc-green/20 border-cc-green/20",
  },
  {
    icon: Headphones,
    label: "حالة الدعم الفني",
    prompt: "وش حالة تذاكر الدعم الفني؟ كم تذكرة عاجلة عندنا؟",
    color: "text-amber",
    bg: "bg-amber/10 hover:bg-amber/20 border-amber/20",
  },
  {
    icon: DollarSign,
    label: "التقرير المالي",
    prompt: "أعطني ملخص عن الوضع المالي للشركة مع ARR و MRR",
    color: "text-cc-purple",
    bg: "bg-cc-purple/10 hover:bg-cc-purple/20 border-cc-purple/20",
  },
  {
    icon: Target,
    label: "تحقيق الأهداف",
    prompt: "كيف أداءنا مقارنة بالأهداف المحددة؟ وش اللي ناقصنا؟",
    color: "text-pink",
    bg: "bg-pink/10 hover:bg-pink/20 border-pink/20",
  },
  {
    icon: BarChart3,
    label: "توقعات الربع القادم",
    prompt: "بناءً على البيانات الحالية، وش توقعاتك للربع القادم؟",
    color: "text-cc-blue",
    bg: "bg-cc-blue/10 hover:bg-cc-blue/20 border-cc-blue/20",
  },
];

export default function AgentPage() {
  const { orgId } = useOrg();
  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent",
      body: { orgId },
    }),
  });

  const isLoading = status === "streaming" || status === "submitted";

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);

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

  // Save conversation title from first user message
  useEffect(() => {
    if (messages.length === 1 && messages[0].role === "user" && !activeConversation) {
      const id = crypto.randomUUID();
      const firstMsg = messages[0].parts
        ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("") || "";
      const title = firstMsg.slice(0, 50) + (firstMsg.length > 50 ? "..." : "");
      setConversations((prev) => [{ id, title, createdAt: new Date() }, ...prev]);
      setActiveConversation(id);
    }
  }, [messages, activeConversation]);

  const submitMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    setInput("");
    await sendMessage({ text: text.trim() });
  };

  const handlePromptClick = (prompt: string) => {
    submitMessage(prompt);
  };

  const handleNewChat = () => {
    setMessages([]);
    setInput("");
    setActiveConversation(null);
    inputRef.current?.focus();
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

  return (
    <div className="flex gap-4 relative" style={{ height: "calc(100vh - 7rem)" }}>
      {/* Conversations Sidebar */}
      <div className="w-[240px] flex-shrink-0 cc-card rounded-xl flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border">
          <Button
            onClick={handleNewChat}
            variant="outline"
            className="w-full justify-start gap-2 text-xs border-cyan/30 text-cyan hover:bg-cyan/10"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            محادثة جديدة
          </Button>
        </div>
        <ScrollArea className="flex-1 p-2">
          {conversations.length === 0 ? (
            <div className="text-center py-8 px-3">
              <Bot className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-[11px] text-muted-foreground">لا توجد محادثات سابقة</p>
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setActiveConversation(conv.id)}
                  className={cn(
                    "w-full text-right px-3 py-2 rounded-lg text-xs transition-colors group flex items-center justify-between",
                    activeConversation === conv.id
                      ? "bg-cyan/10 text-cyan"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <span className="truncate flex-1">{conv.title}</span>
                  <Trash2
                    className="w-3 h-3 opacity-0 group-hover:opacity-50 hover:!opacity-100 flex-shrink-0 mr-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConversations((prev) => prev.filter((c) => c.id !== conv.id));
                      if (activeConversation === conv.id) handleNewChat();
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col cc-card rounded-xl overflow-hidden min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan to-cc-purple flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">المساعد الذكي</h3>
              <p className="text-[10px] text-muted-foreground">مستشار أعمال — مدعوم بـ Gemini AI</p>
            </div>
          </div>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNewChat}
              className="text-muted-foreground text-xs gap-1.5"
            >
              <RotateCcw className="w-3 h-3" />
              محادثة جديدة
            </Button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5" ref={scrollRef}>
          {messages.length === 0 ? (
            /* Empty State — Suggested Prompts */
            <div className="flex flex-col items-center justify-center h-full py-12">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan/20 to-cc-purple/20 flex items-center justify-center mb-5">
                <Sparkles className="w-8 h-8 text-cyan" />
              </div>
              <h2 className="text-lg font-bold text-foreground mb-1">مرحباً! أنا المساعد الذكي</h2>
              <p className="text-xs text-muted-foreground mb-8 max-w-md text-center">
                أقدر أساعدك في تحليل بيانات الشركة، متابعة الأداء، وتقديم توصيات عملية. اختر موضوع أو اكتب سؤالك.
              </p>

              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-2xl">
                {SUGGESTED_PROMPTS.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={i}
                      onClick={() => handlePromptClick(item.prompt)}
                      className={cn(
                        "flex items-start gap-3 p-3.5 rounded-xl border text-right transition-all",
                        item.bg
                      )}
                    >
                      <Icon className={cn("w-5 h-5 mt-0.5 flex-shrink-0", item.color)} />
                      <div>
                        <p className={cn("text-xs font-bold", item.color)}>{item.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                          {item.prompt}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Chat Messages */
            <div className="space-y-6 py-5">
              {messages.map((msg) => {
                const text = getMessageText(msg);
                return (
                  <div key={msg.id} className="flex gap-3">
                    {/* Avatar */}
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                        msg.role === "user"
                          ? "bg-cyan/15"
                          : "bg-gradient-to-br from-cyan/20 to-cc-purple/20"
                      )}
                    >
                      {msg.role === "user" ? (
                        <span className="text-xs font-bold text-cyan">م</span>
                      ) : (
                        <Bot className="w-4 h-4 text-cyan" />
                      )}
                    </div>

                    {/* Message Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-foreground">
                          {msg.role === "user" ? "أنت" : "المساعد الذكي"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date().toLocaleTimeString("ar-SA", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
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
                                      <p className="text-xs font-medium text-cyan">جاري البحث في الويب...</p>
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
                                    تم البحث في الويب
                                  </div>
                                );
                              }

                              if (name === "queryDatabase" && !isDone) {
                                return (
                                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-cc-purple/5 border border-cc-purple/15 animate-pulse">
                                    <Database className="w-4 h-4 text-cc-purple animate-pulse" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-cc-purple">جاري الاستعلام من قاعدة البيانات...</p>
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
                                    تم الاستعلام من قاعدة البيانات
                                  </div>
                                );
                              }

                              // Unknown tool — hide
                              return null;
                            }

                            // Text parts
                            if (part.type === "text" && part.text) {
                              return (
                                <div key={i} className="prose prose-invert prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-td:text-foreground/80 prose-th:text-foreground prose-li:text-foreground/90 [&_table]:w-full [&_table]:text-xs [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_td]:px-3 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-border [&_th]:border-b [&_th]:border-border [&_th]:text-right [&_td]:text-right text-sm leading-relaxed text-foreground/90">
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
                          className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3 h-3 text-cc-green" />
                              <span className="text-cc-green">تم النسخ</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              نسخ
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
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan/20 to-cc-purple/20 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-cyan" />
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-xs text-muted-foreground">يفكر</span>
                    <span className="w-1.5 h-1.5 bg-cyan rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-cyan rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-cyan rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Area — always visible */}
        <div className="flex-shrink-0 p-4 border-t border-border bg-card">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="اسأل عن المبيعات، الفريق، الدعم، المالية..."
                rows={1}
                className="w-full resize-none bg-muted/50 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground border border-border focus:border-cyan/50 focus:outline-none focus:ring-1 focus:ring-cyan/25 transition-colors"
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
              className="h-12 w-12 rounded-xl bg-gradient-to-br from-cyan to-cyan/80 hover:from-cyan/90 hover:to-cyan/70 text-background disabled:opacity-30"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-2">
            المساعد الذكي مدعوم بـ Gemini AI — الإجابات مبنية على بيانات الشركة الفعلية
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
                  <th key={i} className="bg-muted px-3 py-1.5 text-right font-bold border-b border-border">
                    {h.trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 border-b border-border text-right">
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
        <div key={i} className="flex gap-2 my-0.5 pr-2">
          <span className="text-cyan mt-1">•</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)/)!;
      elements.push(
        <div key={i} className="flex gap-2 my-0.5 pr-2">
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
