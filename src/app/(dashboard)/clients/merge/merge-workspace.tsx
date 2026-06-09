"use client";

// Client merge workbench. One row per unresolved sheet-client, showing its
// linked-data counts, a suggested Odoo match (with confidence), and a manual
// override picker. Confirm → merge re-points everything to the canonical
// client. Skip leaves it for later. A live progress counter shows how much of
// the duplicate backlog is cleared.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Check,
  FileSignature,
  FolderKanban,
  Loader2,
  MessagesSquare,
  Search,
  X,
} from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import type { MergeClient } from "@/lib/data/clients";
import { mergeClientsAction } from "./_actions";

export type SheetCandidate = {
  sheet: MergeClient;
  suggestion: MergeClient | null;
  score: number;
};

export function MergeWorkspace({
  candidates,
  odooOptions,
  odooById,
  canManage,
}: {
  candidates: SheetCandidate[];
  odooOptions: { value: string; label: string }[];
  odooById: Record<string, MergeClient>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set()); // merged this session
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (done.has(c.sheet.id) || skipped.has(c.sheet.id)) return false;
      if (!q) return true;
      return (
        c.sheet.name.toLowerCase().includes(q) ||
        (c.sheet.external_id ?? "").toLowerCase().includes(q) ||
        (c.suggestion?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [candidates, search, done, skipped]);

  const total = candidates.length;
  const cleared = done.size;

  return (
    <div className="space-y-3">
      {/* Progress + search */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-soft bg-card p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث باسم العميل أو الكود…"
            className="h-9 w-full rounded-lg border border-input bg-input ps-8 pe-3 text-sm outline-none focus:border-cyan/40"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          مدموج هذه الجلسة:{" "}
          <span className="font-medium text-emerald-300">{cleared}</span> · متبقٍ:{" "}
          <span className="font-medium text-foreground">{visible.length}</span> · إجمالي{" "}
          {total}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-soft-2 bg-soft-1/40 px-4 py-16 text-center text-sm text-muted-foreground">
          {search ? "لا نتائج مطابقة." : "🎉 لا يوجد عملاء مكررون متبقّون."}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((c) => (
            <MergeRow
              key={c.sheet.id}
              candidate={c}
              odooOptions={odooOptions}
              odooById={odooById}
              canManage={canManage}
              onMerged={() => {
                setDone((prev) => new Set(prev).add(c.sheet.id));
                router.refresh();
              }}
              onSkip={() => setSkipped((prev) => new Set(prev).add(c.sheet.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MergeRow({
  candidate,
  odooOptions,
  odooById,
  canManage,
  onMerged,
  onSkip,
}: {
  candidate: SheetCandidate;
  odooOptions: { value: string; label: string }[];
  odooById: Record<string, MergeClient>;
  canManage: boolean;
  onMerged: () => void;
  onSkip: () => void;
}) {
  const { sheet, suggestion, score } = candidate;
  const [targetId, setTargetId] = useState(suggestion?.id ?? "");
  const [pending, start] = useTransition();
  const target = targetId ? odooById[targetId] : null;

  const confidence =
    score >= 0.95 ? "عالية" : score >= 0.8 ? "جيدة" : score >= 0.6 ? "متوسطة" : "ضعيفة";
  const confTone =
    score >= 0.95
      ? "bg-emerald-500/15 text-emerald-300"
      : score >= 0.8
        ? "bg-sky-500/15 text-sky-300"
        : score >= 0.6
          ? "bg-amber-500/15 text-amber-300"
          : "bg-rose-500/15 text-rose-300";

  function merge() {
    if (!targetId) {
      toast.error("اختر العميل الرسمي أولًا");
      return;
    }
    start(async () => {
      const res = await mergeClientsAction({ sourceId: sheet.id, targetId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const m = res.moved;
      toast.success(
        `تم الدمج — عقود: ${m.contracts ?? 0}، جروبات: ${m.wa_group_links ?? 0}`,
      );
      onMerged();
    });
  }

  return (
    <div className="rounded-xl border border-soft bg-card p-3">
      <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr_auto]">
        {/* Sheet client (source) */}
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              نسخة الشيت
            </span>
            {sheet.external_id && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {sheet.external_id}
              </span>
            )}
          </div>
          <p className="truncate text-sm font-medium">{sheet.name}</p>
          <Counts c={sheet} />
        </div>

        {/* Arrow */}
        <ArrowLeftRight className="mx-auto size-4 shrink-0 text-muted-foreground" />

        {/* Odoo target picker */}
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-cyan-dim px-1.5 py-0.5 text-[10px] font-medium text-cyan">
              العميل الرسمي (Odoo)
            </span>
            {score > 0 && (
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", confTone)}>
                تطابق {confidence} {Math.round(score * 100)}%
              </span>
            )}
          </div>
          <SearchableSelect
            value={targetId}
            onValueChange={setTargetId}
            options={odooOptions}
            placeholder="اختر العميل الرسمي…"
            searchPlaceholder="ابحث…"
            emptyMessage="لا نتائج"
            ariaLabel="العميل الرسمي"
          />
          {target && <Counts c={target} />}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 justify-self-end">
          <button
            type="button"
            onClick={onSkip}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-soft px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
            تخطٍّ
          </button>
          {canManage && (
            <button
              type="button"
              onClick={merge}
              disabled={pending || !targetId}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan-dim px-3 text-xs font-medium text-cyan hover:bg-cyan-dim/80 disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              دمج
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Counts({ c }: { c: MergeClient }) {
  return (
    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <FileSignature className="size-3" />
        {c.contracts}
      </span>
      <span className="inline-flex items-center gap-1">
        <MessagesSquare className="size-3" />
        {c.groups}
      </span>
      <span className="inline-flex items-center gap-1">
        <FolderKanban className="size-3" />
        {c.projects}
      </span>
    </div>
  );
}
