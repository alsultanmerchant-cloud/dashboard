"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Check, X, Loader2, Palette, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { setTaskCountsAction } from "./_counts_actions";

export function DesignCountsRow({
  taskId,
  initialDesignCount,
  initialRevisionCount,
  canEdit,
}: {
  taskId: string;
  initialDesignCount: number;
  initialRevisionCount: number;
  canEdit: boolean;
}) {
  const t = useTranslations("TaskDetailPage.designCounts");
  const [editing, setEditing] = useState(false);
  const [design, setDesign] = useState(initialDesignCount);
  const [revision, setRevision] = useState(initialRevisionCount);
  const [draftDesign, setDraftDesign] = useState(String(initialDesignCount));
  const [draftRevision, setDraftRevision] = useState(String(initialRevisionCount));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraftDesign(String(design));
    setDraftRevision(String(revision));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  function save() {
    const d = parseInt(draftDesign, 10);
    const r = parseInt(draftRevision, 10);
    if (Number.isNaN(d) || Number.isNaN(r) || d < 0 || r < 0) {
      setError(t("error"));
      return;
    }
    startTransition(async () => {
      const res = await setTaskCountsAction({
        taskId,
        designCount: d,
        revisionCount: r,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setDesign(d);
      setRevision(r);
      setEditing(false);
      setError(null);
    });
  }

  return (
    <div className="space-y-1.5 border-t border-soft/40 pt-2">
      <div className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Palette className="size-3.5" />
          {t("designCount")}
        </span>
        {editing ? (
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            className="h-7 w-20 text-sm"
            value={draftDesign}
            onChange={(e) => setDraftDesign(e.target.value)}
            disabled={pending}
            dir="ltr"
          />
        ) : (
          <span className="text-sm font-semibold tabular-nums">{design}</span>
        )}
        {!editing && canEdit && (
          <button
            type="button"
            onClick={startEdit}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("edit")}
            title={t("edit")}
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="size-3.5" />
          {t("revisionCount")}
        </span>
        {editing ? (
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            className="h-7 w-20 text-sm"
            value={draftRevision}
            onChange={(e) => setDraftRevision(e.target.value)}
            disabled={pending}
            dir="ltr"
          />
        ) : (
          <span className="text-sm font-semibold tabular-nums">{revision}</span>
        )}
        <span />
      </div>

      {editing && (
        <div className={cn("flex items-center justify-end gap-2 pt-1", error && "pt-0")}>
          {error && (
            <span className="me-auto text-[11px] text-cc-red">{error}</span>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={cancel}
            disabled={pending}
            className="h-7 gap-1"
          >
            <X className="size-3.5" /> {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={pending}
            className="h-7 gap-1"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {t("save")}
          </Button>
        </div>
      )}
    </div>
  );
}
