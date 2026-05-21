"use client";

// Lists attachments aggregated across the project's tasks (mirrors Odoo's
// rwasem_document_management_project "All Documents" smart button) and
// opens a nested StackedSheet to preview each file. Rendered inside a
// StackedSheet on the project page — no internal collapse button.

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Download,
  File,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Paperclip,
} from "lucide-react";

import { StackedSheet } from "@/components/ui/stacked-sheet";
import { createClient } from "@/lib/supabase/client";
import type { AttachmentRow } from "../../tasks/[id]/attachments-tab";

function fileIcon(mime: string | null) {
  if (!mime) return File;
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return FileVideo;
  if (
    mime.includes("pdf") ||
    mime.includes("document") ||
    mime.includes("text") ||
    mime.includes("sheet")
  ) {
    return FileText;
  }
  return File;
}

function humanSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectDocumentsPanel({ projectId }: { projectId: string }) {
  const tProject = useTranslations("ProjectDetailPage");
  const tAttach = useTranslations("TaskDetailPage.attachments");
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [preview, setPreview] = useState<AttachmentRow | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/attachments`, {
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { rows?: AttachmentRow[] };
      })
      .then((json) => {
        if (!alive) return;
        setRows(Array.isArray(json.rows) ? json.rows : []);
      })
      .catch((err) => {
        if (!alive) return;
        console.error("[project documents] load failed", err);
        setError(tProject("attachmentsPanel.error"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, tProject]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {tProject("loading.attachments")}
      </div>
    );
  }
  if (error) {
    return <div className="py-6 text-sm text-cc-red">{error}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-soft px-3 py-10 text-center text-sm text-muted-foreground">
        <Paperclip className="size-4 opacity-60" />
        <span>{tAttach("empty")}</span>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-soft/40 rounded-xl border border-border bg-card">
        {rows.map((row) => {
          const Icon = fileIcon(row.mimetype);
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setPreview(row)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-start text-sm transition-colors hover:bg-muted/40"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium" title={row.filename}>
                    {row.filename}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{humanSize(row.size_bytes)}</span>
                    <span>·</span>
                    <span dir="ltr">{row.created_at.slice(0, 10)}</span>
                    {row.task_code && (
                      <>
                        <span>·</span>
                        <span className="font-mono" dir="ltr">
                          {row.task_code}
                        </span>
                      </>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <AttachmentPreviewSheet
        open={preview != null}
        row={preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        locale={locale}
        labels={{
          download: tAttach("open"),
        }}
      />
    </>
  );
}

function AttachmentPreviewSheet({
  open,
  row,
  onOpenChange,
  locale,
  labels,
}: {
  open: boolean;
  row: AttachmentRow | null;
  onOpenChange: (open: boolean) => void;
  locale: string;
  labels: { download: string };
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!open || !row) {
      setSignedUrl(null);
      return;
    }
    if (row.source_url) {
      setSignedUrl(row.source_url);
      return;
    }
    if (!row.storage_path) return;
    let alive = true;
    setResolving(true);
    const supabase = createClient();
    supabase.storage
      .from("attachments")
      .createSignedUrl(row.storage_path, 300)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data?.signedUrl) {
          console.error(error);
          return;
        }
        setSignedUrl(data.signedUrl);
      })
      .finally(() => {
        if (alive) setResolving(false);
      });
    return () => {
      alive = false;
    };
  }, [open, row]);

  if (!row) {
    return (
      <StackedSheet
        open={open}
        onOpenChange={onOpenChange}
        title=""
        heightFraction={0.5}
      >
        <div />
      </StackedSheet>
    );
  }

  const isImage = row.mimetype?.startsWith("image/");
  const isPdf = row.mimetype?.includes("pdf");

  return (
    <StackedSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row.filename}
      description={`${humanSize(row.size_bytes)} · ${row.created_at.slice(0, 10)}${
        row.task_code ? ` · ${row.task_code}` : ""
      }`}
      heightFraction={0.82}
      footer={
        signedUrl ? (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="size-4" />
            {labels.download}
          </a>
        ) : null
      }
    >
      <div className="flex h-full min-h-[20rem] items-center justify-center" dir={locale.startsWith("ar") ? "rtl" : "ltr"}>
        {resolving || !signedUrl ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signedUrl}
            alt={row.filename}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        ) : isPdf ? (
          <iframe
            src={signedUrl}
            title={row.filename}
            className="size-full rounded-lg border border-border bg-white"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <File className="size-10 opacity-60" />
            <span>{row.filename}</span>
            <span className="text-[11px]">{row.mimetype ?? ""}</span>
          </div>
        )}
      </div>
    </StackedSheet>
  );
}

