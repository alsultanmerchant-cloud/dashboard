"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Paperclip } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AttachmentsTab, type AttachmentRow } from "../../tasks/[id]/attachments-tab";
import { cn } from "@/lib/utils";

export function ProjectDocumentsPanel({ projectId }: { projectId: string }) {
  const tProject = useTranslations("ProjectDetailPage");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AttachmentRow[]>([]);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (loaded || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/attachments`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as { rows?: AttachmentRow[] };
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setLoaded(true);
    } catch (err) {
      console.error("[project documents] load failed", err);
      setError(tProject("attachmentsPanel.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full items-center justify-between rounded-xl border border-soft bg-soft-1/40 px-3 py-2 text-start transition-colors hover:bg-soft-1"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <Paperclip className="size-4 text-cyan" />
          {open
            ? tProject("attachmentsPanel.hide")
            : tProject("attachmentsPanel.show")}
        </span>
        <span className="text-muted-foreground">
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight
              className={cn("size-4", locale.startsWith("ar") && "rotate-180")}
            />
          )}
        </span>
      </button>

      {open && (
        <div className="rounded-xl border border-soft/70 bg-background p-3">
          {loading ? (
            <div className="text-sm text-muted-foreground">
              {tProject("loading.attachments")}
            </div>
          ) : error ? (
            <div className="text-sm text-cc-red">{error}</div>
          ) : (
            <AttachmentsTab rows={rows} showTaskColumn />
          )}
        </div>
      )}
    </div>
  );
}
