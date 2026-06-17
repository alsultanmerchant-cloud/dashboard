"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName } from "ai";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  Wand2,
  MessageCircleQuestion,
  GraduationCap,
  Send,
  X,
  Loader2,
  Check,
  Database,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Selection = { text: string; field: string | null; context: string | null };
type Anchor = { top: number; left: number };

// AI SDK tool-UI part with an output payload once resolved.
type ToolPartOutput = {
  success?: boolean;
  field?: string;
  newText?: string;
  riskId?: string;
  error?: string;
};
type ToolBadgeStatus = "active" | "success" | "error";

// Dispatched on a successful inline brief edit so CeoBriefCard re-renders
// instantly without a re-fetch. The card listens for this event.
export const BRIEF_PATCHED_EVENT = "ceo-brief:patched";

// Dispatched when a risk/alert is dismissed so CeoBriefCard removes it instantly
// (the server already persisted both the removal and the durable suppression).
export const RISK_DISMISSED_EVENT = "ceo-brief:risk-dismissed";

/**
 * Global "Ask AI" popover for the whole dashboard. Watches text selections
 * inside the [data-dashboard-root] container, surfaces a button, and opens a
 * compact chat backed by /api/dashboard-assistant.
 *
 * - Correct → the AI edits the text in place ONLY when the selection is an
 *   editable CEO-brief field (data-brief-field); otherwise it records a lesson.
 * - Explain more / Teach → work on any selected text, grounded by the nearest
 *   section heading captured as context.
 */
export function DashboardSelectionAssistant({
  briefRunId = null,
}: {
  briefRunId?: string | null;
}) {
  const t = useTranslations("Executive.assistant");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // On the satisfaction page the selected client lives in ?client=<id>; passing
  // it lets the assistant ground answers on that client's analysis (e.g. the
  // brief-adherence breakdown behind the score).
  const clientId = searchParams.get("client");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [buttonAt, setButtonAt] = useState<Anchor | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Selection | null>(null);
  const appliedRef = useRef<Set<string>>(new Set());

  // Keep the per-request body callback reading the latest selection.
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/dashboard-assistant" }),
  });

  const isLoading = status === "streaming" || status === "submitted";

  const sendWithContext = useCallback(
    (text: string) => {
      const sel = selectionRef.current;
      sendMessage(
        { text },
        {
          body: {
            briefRunId,
            selection: sel?.text ?? null,
            field: sel?.field ?? null,
            context: sel?.context ?? null,
            page: pathname,
            clientId,
          },
        },
      );
    },
    [briefRunId, clientId, pathname, sendMessage],
  );

  // --- Capture selections anywhere inside the dashboard ----------------------
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        (panelRef.current && target && panelRef.current.contains(target)) ||
        (buttonRef.current && target && buttonRef.current.contains(target))
      ) {
        return;
      }
      window.setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        const root = document.querySelector("[data-dashboard-root]");
        if (
          !sel ||
          sel.isCollapsed ||
          !text ||
          !root ||
          !sel.anchorNode ||
          !root.contains(sel.anchorNode)
        ) {
          if (!open) {
            setButtonAt(null);
            setSelection(null);
          }
          return;
        }
        const startEl: HTMLElement | null =
          sel.anchorNode.nodeType === Node.TEXT_NODE
            ? sel.anchorNode.parentElement
            : (sel.anchorNode as HTMLElement);

        // Find an editable brief field (only the CEO brief tags these).
        let field: string | null = null;
        let el: HTMLElement | null = startEl;
        while (el && el !== root) {
          if (el.dataset?.briefField) {
            field = el.dataset.briefField;
            break;
          }
          el = el.parentElement;
        }

        const context = nearestHeading(startEl, root as HTMLElement);
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setSelection({ text, field, context });
        setButtonAt({ top: rect.bottom + 8, left: rect.left });
        setOpen(false);
      }, 0);
    };

    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [open]);

  // --- Apply successful brief edits (broadcast to the card) ------------------
  useEffect(() => {
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts ?? []) {
        if (!isToolUIPart(part)) continue;
        const toolName = getToolName(part);
        if (toolName !== "editBriefText" && toolName !== "dismissRisk") continue;
        if (part.state !== "output-available") continue;
        const id = part.toolCallId;
        if (!id || appliedRef.current.has(id)) continue;
        const out = part.output as ToolPartOutput | undefined;
        if (!out?.success) continue;
        if (toolName === "editBriefText" && out.field && typeof out.newText === "string") {
          appliedRef.current.add(id);
          window.dispatchEvent(
            new CustomEvent(BRIEF_PATCHED_EVENT, {
              detail: { field: out.field, newText: out.newText },
            }),
          );
        } else if (toolName === "dismissRisk" && out.riskId) {
          appliedRef.current.add(id);
          window.dispatchEvent(
            new CustomEvent(RISK_DISMISSED_EVENT, { detail: { riskId: out.riskId } }),
          );
        }
      }
    }
  }, [messages]);

  // --- Close on outside click / Escape ---------------------------------------
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (panelRef.current && target && !panelRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const openPanel = useCallback(() => {
    setMessages([]);
    appliedRef.current = new Set();
    setOpen(true);
  }, [setMessages]);

  const quickAction = useCallback(
    (kind: "correct" | "explain" | "teach") => {
      const sel = selectionRef.current;
      if (!sel) return;
      if (!open) openPanel();
      if (kind === "teach") {
        setInput(`لدي معلومة تصحّح هذا الجزء من لوحة القيادة: "${sel.text}". `);
        return;
      }
      const prompts = {
        correct: `راجع هذا النص من لوحة القيادة وصحّحه إن كان خاطئًا: "${sel.text}"`,
        explain: `اشرح لي هذا الجزء من لوحة القيادة بالتفصيل: "${sel.text}"`,
      } as const;
      sendWithContext(prompts[kind]);
    },
    [open, openPanel, sendWithContext],
  );

  const submit = useCallback(() => {
    const value = input.trim();
    if (!value || isLoading) return;
    if (!open) openPanel();
    sendWithContext(value);
    setInput("");
  }, [input, isLoading, open, openPanel, sendWithContext]);

  if (!buttonAt && !open) return null;

  return (
    <>
      {buttonAt && !open && selection && (
        <div
          ref={buttonRef}
          className="fixed z-50 flex items-center gap-1 rounded-xl border border-cyan/30 bg-card/95 p-1 shadow-lg backdrop-blur"
          style={{ top: buttonAt.top, insetInlineStart: buttonAt.left }}
        >
          <button
            type="button"
            onClick={openPanel}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-dim px-2.5 py-1.5 text-xs font-bold text-cyan transition-colors hover:bg-cyan/20"
          >
            <Sparkles className="size-3.5" />
            {t("askAi")}
          </button>
          <button
            type="button"
            onClick={() => quickAction("explain")}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-soft-2 hover:text-foreground"
            title={t("explainMore")}
          >
            <MessageCircleQuestion className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => quickAction("teach")}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-soft-2 hover:text-foreground"
            title={t("teach")}
          >
            <GraduationCap className="size-3.5" />
          </button>
        </div>
      )}

      {open && (
        <div
          ref={panelRef}
          className="fixed bottom-4 z-50 flex max-h-[70vh] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-soft bg-card shadow-2xl"
          style={{ insetInlineEnd: 16 }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-soft px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-cyan-dim text-cyan">
                <Sparkles className="size-3.5" />
              </div>
              <p className="text-xs font-bold">{t("title")}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-soft-2 hover:text-foreground"
              aria-label={t("close")}
            >
              <X className="size-4" />
            </button>
          </div>

          {selection && (
            <div className="border-b border-soft bg-soft-1/40 px-3.5 py-2.5">
              {selection.context && (
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {selection.context}
                </p>
              )}
              <p className="line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                “{selection.text}”
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selection.field && (
                  <QuickChip icon={Wand2} label={t("correct")} onClick={() => quickAction("correct")} />
                )}
                <QuickChip icon={MessageCircleQuestion} label={t("explainMore")} onClick={() => quickAction("explain")} />
                <QuickChip icon={GraduationCap} label={t("teach")} onClick={() => quickAction("teach")} />
              </div>
            </div>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
            {messages.length === 0 && (
              <p className="py-6 text-center text-[11px] text-muted-foreground">{t("selectHint")}</p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className="space-y-1.5">
                <p className="text-[10px] font-bold text-muted-foreground">
                  {msg.role === "user" ? t("you") : t("title")}
                </p>
                {msg.role === "user" ? (
                  <p className="rounded-xl bg-cyan/10 px-3 py-2 text-xs leading-6 text-foreground/90">
                    {textOf(msg)}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {(msg.parts ?? []).map((part, i) => {
                      if (isToolUIPart(part)) {
                        const output = "output" in part ? (part.output as ToolPartOutput | undefined) : undefined;
                        const errorText =
                          "errorText" in part && typeof part.errorText === "string"
                            ? part.errorText
                            : output?.error;
                        return (
                          <ToolBadge
                            key={i}
                            name={getToolName(part)}
                            status={toolBadgeStatus(part.state, output)}
                            errorText={errorText}
                            t={t}
                          />
                        );
                      }
                      if (part.type === "text" && part.text) {
                        return (
                          <p key={i} className="whitespace-pre-wrap rounded-xl bg-soft-1/60 px-3 py-2 text-xs leading-6 text-foreground/90">
                            {part.text}
                          </p>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t("thinking")}
              </div>
            )}
          </div>

          <div className="border-t border-soft p-2.5">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder={t("placeholder")}
                className="max-h-24 min-h-9 flex-1 resize-none rounded-xl border border-soft bg-soft-1/40 px-3 py-2 text-xs leading-5 outline-none focus:border-cyan/40"
              />
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim() || isLoading}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-cyan text-card transition-opacity disabled:opacity-40"
                aria-label={t("send")}
              >
                <Send className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The section heading the selection sits under: the last heading that appears
 * before the selection in document order (robust to nesting). Used to ground
 * "explain / teach" with which part of the dashboard the user is pointing at.
 */
function nearestHeading(start: HTMLElement | null, root: HTMLElement): string | null {
  if (!start) return null;
  const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,[role="heading"]'));
  let best: Element | null = null;
  for (const h of headings) {
    // headings are in document order; keep the last one that precedes `start`.
    if (h.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING) {
      best = h;
    } else {
      break;
    }
  }
  const text = best?.textContent?.trim();
  return text ? text.slice(0, 80) : null;
}

function QuickChip({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Wand2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-soft bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-cyan/35 hover:text-cyan"
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}

function ToolBadge({
  name,
  status,
  errorText,
  t,
}: {
  name: string;
  status: ToolBadgeStatus;
  errorText?: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const map: Record<
    string,
    { active: string; done: string; failed: string; icon: typeof Database }
  > = {
    editBriefText: { active: t("editing"), done: t("edited"), failed: t("editFailed"), icon: Wand2 },
    dismissRisk: {
      active: t("dismissing"),
      done: t("dismissed"),
      failed: t("dismissFailed"),
      icon: X,
    },
    saveLesson: {
      active: t("teaching"),
      done: t("taught"),
      failed: t("teachFailed"),
      icon: GraduationCap,
    },
  };
  const meta = map[name] ?? {
    active: t("reading"),
    done: t("read"),
    failed: t("readFailed"),
    icon: Database,
  };
  const Icon = status === "success" ? Check : status === "error" ? AlertCircle : meta.icon;
  const label =
    status === "success"
      ? meta.done
      : status === "error"
        ? `${meta.failed}${errorText ? `: ${shortError(errorText)}` : ""}`
        : meta.active;
  return (
    <div
      title={status === "error" ? errorText : undefined}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px]",
        status === "success"
          ? "border-cc-green/20 bg-cc-green/[0.06] text-cc-green"
          : status === "error"
            ? "border-cc-red/25 bg-red-dim/40 text-cc-red"
            : "border-cyan/15 bg-cyan/5 text-cyan",
      )}
    >
      <Icon className={cn("size-3 shrink-0", status === "active" && "animate-pulse")} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function toolBadgeStatus(state: string, output?: ToolPartOutput): ToolBadgeStatus {
  if (state === "output-error" || state === "output-denied") return "error";
  if (state === "output-available") return output?.success === false ? "error" : "success";
  return "active";
}

function shortError(error: string): string {
  return error.replace(/\s+/g, " ").trim().slice(0, 120);
}

function textOf(msg: { parts?: Array<{ type: string; text?: string }> }): string {
  return (msg.parts ?? [])
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("\n");
}
