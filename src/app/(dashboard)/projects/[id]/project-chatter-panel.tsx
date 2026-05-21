"use client";

// Inline project chatter section. Visually matches CommentRow from the
// task detail feed (avatar + name + datetime + sanitized HTML body) so
// operators see the same pattern everywhere. HTML is sanitized server-
// side in /api/projects/[id]/comments and arrives as body_html.
//
// A "Log a note" composer at the top lets operators with projects.manage
// add dashboard-local notes. New rows are saved to project_comments with
// is_internal=true / kind=note; they live alongside Odoo-imported rows
// but stay local (no writeback to Odoo).

import { useEffect, useState, useTransition } from "react";
import { History, Loader2, MessageSquare, Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

type Comment = {
  id: string;
  body_html: string;
  kind: "tracking" | "note";
  is_internal: boolean;
  created_at: string;
  author_name: string;
  author_avatar_url: string | null;
};

function formatDateTime(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale === "ar" ? "ar-SA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ProjectChatterPanel({
  projectId,
  canCompose = false,
}: {
  projectId: string;
  canCompose?: boolean;
}) {
  const t = useTranslations("ProjectDetailPage");
  const locale = useLocale();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Composer state.
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [composeError, setComposeError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/comments`, {
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { comments?: Comment[] };
      })
      .then((json) => {
        if (!alive) return;
        setComments(json.comments ?? []);
      })
      .catch((err) => {
        if (!alive) return;
        console.error("[project chatter] load failed", err);
        setError(t("loading.notes"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, t]);

  const submitNew = () => {
    const body = draft.trim();
    if (!body) return;
    startTransition(async () => {
      setComposeError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/comments`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { comment: Comment };
        setComments((prev) => [json.comment, ...prev]);
        setDraft("");
        setComposing(false);
      } catch (err) {
        console.error("[project chatter] post failed", err);
        setComposeError(t("loading.notes"));
      }
    });
  };

  const composer = canCompose ? (
    <div className="mb-3">
      {composing ? (
        <div className="space-y-2 rounded-xl border border-cyan/30 bg-cyan-dim/10 p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              locale.startsWith("ar")
                ? "اكتب ملاحظة على المشروع — قرارات، عوائق، تحديثات..."
                : "Log a note on this project — decisions, blockers, updates..."
            }
            rows={4}
            disabled={pending}
            className="w-full resize-y rounded-lg border border-soft bg-card px-3 py-2 text-sm outline-none focus:border-cyan/50"
            autoFocus
          />
          {composeError && (
            <p className="text-xs text-cc-red">{composeError}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setComposing(false);
                setDraft("");
                setComposeError(null);
              }}
              disabled={pending}
            >
              <X className="size-3.5" />
              {locale.startsWith("ar") ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submitNew}
              disabled={pending || !draft.trim()}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              {locale.startsWith("ar") ? "حفظ الملاحظة" : "Log note"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setComposing(true)}
        >
          <Plus className="size-3.5" />
          {locale.startsWith("ar") ? "تسجيل ملاحظة" : "Log a note"}
        </Button>
      )}
    </div>
  ) : null;

  if (loading) {
    return (
      <>
        {composer}
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      </>
    );
  }
  if (error) {
    return (
      <>
        {composer}
        <p className="py-2 text-sm text-cc-red">{error}</p>
      </>
    );
  }
  if (comments.length === 0) {
    return (
      <>
        {composer}
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <MessageSquare className="size-4 opacity-60" />
          <span>—</span>
        </div>
      </>
    );
  }

  return (
    <>
      {composer}
      <ul className="space-y-3">
        {comments.map((c) =>
          c.kind === "tracking" ? (
            <li
              key={c.id}
              className="flex items-start gap-3 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
            >
              <History className="size-3.5 shrink-0 translate-y-0.5 opacity-60" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium text-foreground/70">
                    {c.author_name}
                  </span>
                  <span className="text-[10px]">
                    {formatDateTime(c.created_at, locale)}
                  </span>
                </div>
                <div
                  className="mt-0.5 break-words text-[12px] leading-snug [&_p:first-child]:mt-0 [&_p]:mt-0.5 [&_strong]:font-medium [&_strong]:text-foreground/80"
                  dangerouslySetInnerHTML={{ __html: c.body_html }}
                />
              </div>
            </li>
          ) : (
            <li key={c.id} className="flex items-start gap-3">
              <Avatar size="sm">
                {c.author_avatar_url && (
                  <AvatarImage src={c.author_avatar_url} alt={c.author_name} />
                )}
                <AvatarFallback>{c.author_name?.[0] ?? "·"}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{c.author_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(c.created_at, locale)}
                  </p>
                </div>
                <div
                  className="mt-1 break-words text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:border-soft [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_ol]:list-decimal [&_ol]:ps-5 [&_p:first-child]:mt-0 [&_p]:mt-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:ps-5"
                  dangerouslySetInnerHTML={{ __html: c.body_html }}
                />
              </div>
            </li>
          ),
        )}
      </ul>
    </>
  );
}
