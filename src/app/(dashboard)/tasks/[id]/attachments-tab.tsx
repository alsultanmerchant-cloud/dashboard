"use client";

import { Paperclip, Download, Image as ImageIcon, FileText, FileVideo, File } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

export type AttachmentRow = {
  id: string;
  task_id: string;
  task_code: string | null;
  task_title: string | null;
  filename: string;
  mimetype: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  source_url: string | null;
  created_at: string;
};

// Sky Light feedback #14: a single "All Documents" panel that lists every
// attachment on a task (and, when shown from the project, across all the
// project's tasks). Mirrors Odoo `rwasem_document_management_project`'s
// smart-button behavior: aggregate count + clickable list with download.

function fileIcon(mime: string | null) {
  if (!mime) return File;
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return FileVideo;
  if (
    mime.includes("pdf") ||
    mime.includes("document") ||
    mime.includes("text") ||
    mime.includes("sheet")
  )
    return FileText;
  return File;
}

function humanSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsTab({
  rows,
  showTaskColumn = false,
}: {
  rows: AttachmentRow[];
  // Project view aggregates across tasks, so we surface the task column.
  showTaskColumn?: boolean;
}) {
  const t = useTranslations("TaskDetailPage.attachments");
  // Lazy-resolve a signed URL for a storage_path on demand. Signed URLs are
  // valid for 60s — long enough to click "Download" once.
  const [busy, setBusy] = useState<string | null>(null);

  const onDownload = async (row: AttachmentRow) => {
    if (row.source_url) {
      window.open(row.source_url, "_blank", "noopener");
      return;
    }
    if (!row.storage_path) return;
    setBusy(row.id);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from("attachments")
        .createSignedUrl(row.storage_path, 60);
      if (error || !data?.signedUrl) {
        console.error(error);
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener");
    } finally {
      setBusy(null);
    }
  };

  // Auto-resolve a hash anchor scroll target — wired so the smart-button
  // `documents` target focuses the panel even when it's already mounted.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#documents") {
      document.getElementById("documents-panel")?.scrollIntoView({ block: "start" });
    }
  }, []);

  if (rows.length === 0) {
    return (
      <div
        id="documents-panel"
        className="flex flex-col items-center gap-2 rounded-md border border-dashed border-soft px-3 py-8 text-center text-sm text-muted-foreground"
      >
        <Paperclip className="size-4 opacity-60" />
        <span>{t("empty")}</span>
      </div>
    );
  }

  return (
    <ul id="documents-panel" className="divide-y divide-soft/40">
      {rows.map((row) => {
        const Icon = fileIcon(row.mimetype);
        return (
          <li
            key={row.id}
            className="flex items-center gap-3 py-2 text-sm"
          >
            <Icon className="size-4 shrink-0 text-cyan" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" title={row.filename}>
                {row.filename}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{humanSize(row.size_bytes)}</span>
                <span>·</span>
                <span dir="ltr">{row.created_at.slice(0, 10)}</span>
                {showTaskColumn && row.task_code && (
                  <>
                    <span>·</span>
                    <span className="font-mono" dir="ltr">{row.task_code}</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDownload(row)}
              disabled={busy === row.id || (!row.storage_path && !row.source_url)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan/30 bg-cyan/10 px-2 py-1 text-[11px] font-medium text-cyan hover:bg-cyan/20 disabled:opacity-40"
            >
              <Download className="size-3" />
              {busy === row.id ? "..." : t("open")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
