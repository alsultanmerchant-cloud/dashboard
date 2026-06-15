"use client";

// Client island — one taught-lesson row. Inline-edit instruction + kind,
// toggle active, delete. Calls server actions on commit.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Trash2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { KnowledgeAdminRow, KnowledgeKind } from "@/lib/data/ai-knowledge";
import {
  updateKnowledgeAction,
  toggleKnowledgeAction,
  deleteKnowledgeAction,
} from "./_actions";

const KINDS: KnowledgeKind[] = ["correction", "fact", "preference", "terminology"];

export function KnowledgeRow({ row }: { row: KnowledgeAdminRow }) {
  const router = useRouter();
  const t = useTranslations("AiKnowledge");
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState(row.instruction);
  const [kind, setKind] = useState<KnowledgeKind>(row.kind);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function save() {
    start(async () => {
      const res = await updateKnowledgeAction({ id: row.id, instruction: instruction.trim(), kind });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("saved"));
      setEditing(false);
      router.refresh();
    });
  }

  function toggleActive(next: boolean) {
    start(async () => {
      const res = await toggleKnowledgeAction({ id: row.id, isActive: next });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(next ? t("activated") : t("deactivated"));
      router.refresh();
    });
  }

  function remove() {
    start(async () => {
      const res = await deleteKnowledgeAction({ id: row.id });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("deleted"));
      router.refresh();
    });
  }

  const createdLabel = new Date(row.createdAt).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", {
    dateStyle: "medium",
  });

  return (
    <div className={cn("rounded-2xl border border-soft bg-card/40 p-4 sm:p-5", !row.isActive && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">{t(`kind.${row.kind}`)}</Badge>
          <Badge
            variant={row.isActive ? "default" : "secondary"}
            className={cn("text-[10px]", row.isActive ? "bg-green-dim text-cc-green" : "bg-soft-2 text-muted-foreground")}
          >
            {row.isActive ? t("active") : t("inactive")}
          </Badge>
          {row.sourceField && (
            <code dir="ltr" className="rounded bg-soft-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {row.sourceField}
            </code>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!editing && (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)} disabled={pending} className="h-8 gap-1.5 text-xs">
              <Pencil className="size-3.5" />
              {t("edit")}
            </Button>
          )}
          <ToggleSwitch checked={row.isActive} disabled={pending} onCheckedChange={toggleActive} />
        </div>
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-xl border border-soft bg-soft-1/40 px-3 py-2 text-sm leading-6 outline-none focus:border-cyan/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind((v as KnowledgeKind) ?? "correction")} disabled={pending}>
              <SelectTrigger className="min-w-40 bg-card/50 border-soft-2 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{t(`kind.${k}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={save} disabled={pending || instruction.trim().length < 3}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {t("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setInstruction(row.instruction); setKind(row.kind); }} disabled={pending}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-7 text-foreground/90">{row.instruction}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-soft pt-2 text-[11px] text-muted-foreground">
        <span>
          {row.authorName ? t("byAuthor", { name: row.authorName }) : t("byUnknown")} · {createdLabel}
        </span>
        {confirmDelete ? (
          <span className="flex items-center gap-1.5">
            <span>{t("confirmDelete")}</span>
            <Button size="sm" variant="destructive" onClick={remove} disabled={pending} className="h-7 text-[11px]">
              {pending && <Loader2 className="size-3 animate-spin" />}
              {t("confirmYes")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={pending} className="h-7 text-[11px]">
              {t("cancel")}
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-cc-red/80 transition-colors hover:bg-cc-red/10 hover:text-cc-red"
          >
            <Trash2 className="size-3.5" />
            {t("delete")}
          </button>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-[background-color,box-shadow]",
        "ring-1 ring-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "justify-end bg-cc-green/80" : "justify-start bg-soft-3/90",
      )}
    >
      <span className={cn("block size-5 rounded-full bg-white/95 shadow-[0_1px_3px_rgba(15,23,42,0.28)] transition-transform", checked ? "scale-100" : "scale-95")} />
    </button>
  );
}
