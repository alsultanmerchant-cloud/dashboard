"use client";

// Project tags — Sky Light feedback. Surfaces the existing project_tags
// table (already populated from Odoo with HOLD / Urgent / LOST / …) and
// lets the operator attach, detach, create, or recolor a tag inline on
// the project detail page. Tag definitions are org-wide; assignments are
// per-project.

import { useMemo, useRef, useState, useTransition, useEffect } from "react";
import { Plus, X, Loader2, Tag as TagIcon, Search, Check, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  attachExistingTagAction,
  createOrAttachTagAction,
  detachTagAction,
  updateTagAction,
} from "./_tag_actions";

// Mirror the Odoo color palette in project-card.tsx so chip colors match
// across the list view and the detail panel.
const ODOO_COLORS = [
  "#9c9c9c", "#d44d4d", "#dfb700", "#3597d3", "#5b8a72", "#9b59b6",
  "#e63946", "#2a9d8f", "#264653", "#f4a261", "#28a745", "#5241c3",
];
function colorFor(i: number): string {
  return ODOO_COLORS[i % ODOO_COLORS.length] ?? ODOO_COLORS[0];
}

export type TagOption = { id: string; name: string; color: number };

export function ProjectTagsPanel({
  projectId,
  attached,
  candidates,
  canManage,
}: {
  projectId: string;
  attached: TagOption[];
  candidates: TagOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyTagId, setBusyTagId] = useState<string | null>(null);

  // Add-tag popover state
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [newColor, setNewColor] = useState(11);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Edit (rename/recolor) popover state
  const [editing, setEditing] = useState<TagOption | null>(null);

  const attachedIds = useMemo(() => new Set(attached.map((a) => a.id)), [attached]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((c) => !attachedIds.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [candidates, attachedIds, query]);

  // Exact-match flag — used to decide whether "Create" should appear at the
  // top of the suggestion list when there's no existing tag with this name.
  const hasExactMatch = useMemo(
    () =>
      candidates.some(
        (c) => c.name.toLowerCase() === query.trim().toLowerCase(),
      ),
    [candidates, query],
  );

  useEffect(() => {
    if (!adding) return;
    inputRef.current?.focus();
    function onDocClick(e: MouseEvent) {
      if (!popoverRef.current?.contains(e.target as Node)) {
        setAdding(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [adding]);

  function attachExisting(tag: TagOption) {
    setBusyTagId(tag.id);
    start(async () => {
      const res = await attachExistingTagAction({ projectId, tagId: tag.id });
      setBusyTagId(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`أُضيف الوسم «${tag.name}»`);
      setAdding(false);
      setQuery("");
      router.refresh();
    });
  }

  function createAndAttach() {
    const name = query.trim();
    if (!name) return;
    setBusyTagId("__new__");
    start(async () => {
      const res = await createOrAttachTagAction({ projectId, name, color: newColor });
      setBusyTagId(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`أُنشئ الوسم «${name}»`);
      setAdding(false);
      setQuery("");
      router.refresh();
    });
  }

  function detach(tag: TagOption) {
    setBusyTagId(tag.id);
    start(async () => {
      const res = await detachTagAction({ projectId, tagId: tag.id });
      setBusyTagId(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`أُزيل الوسم «${tag.name}»`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {attached.length === 0 && !canManage && (
          <p className="text-xs text-muted-foreground">لا توجد وسوم.</p>
        )}
        {attached.map((tag) => {
          const bg = colorFor(tag.color);
          return (
            <span
              key={tag.id}
              className="group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-white"
              style={{ backgroundColor: bg }}
            >
              <span>{tag.name}</span>
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(tag)}
                    className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/20 group-hover:opacity-80"
                    aria-label="تعديل الوسم"
                    title="تعديل"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => detach(tag)}
                    disabled={pending && busyTagId === tag.id}
                    className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/20 group-hover:opacity-80 disabled:opacity-50"
                    aria-label="إزالة الوسم"
                    title="إزالة"
                  >
                    {pending && busyTagId === tag.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <X className="size-3" />
                    )}
                  </button>
                </>
              )}
            </span>
          );
        })}

        {canManage && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-cyan/40 hover:text-cyan transition-colors"
            aria-label="إضافة وسم"
          >
            <Plus className="size-3" />
            إضافة وسم
          </button>
        )}
      </div>

      {adding && (
        <div
          ref={popoverRef}
          className="relative max-w-md rounded-xl border border-border bg-card p-3 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.min(filtered.length, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length > 0 && activeIndex < filtered.length) {
                    attachExisting(filtered[activeIndex]);
                  } else if (query.trim() && !hasExactMatch) {
                    createAndAttach();
                  }
                } else if (e.key === "Escape") {
                  setAdding(false);
                  setQuery("");
                }
              }}
              placeholder="ابحث أو اكتب اسم وسم جديد"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </div>

          <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 && !query.trim() && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                ابدأ بالكتابة لإضافة وسم جديد، أو اختر من الوسوم الموجودة.
              </p>
            )}
            {filtered.map((tag, idx) => {
              const bg = colorFor(tag.color);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => attachExisting(tag)}
                  disabled={pending}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-start text-sm transition-colors",
                    idx === activeIndex ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="size-3 rounded-full"
                      style={{ backgroundColor: bg }}
                    />
                    {tag.name}
                  </span>
                  {pending && busyTagId === tag.id && (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  )}
                </button>
              );
            })}

            {query.trim() && !hasExactMatch && (
              <div className="mt-1 border-t border-soft/40 pt-2">
                <div className="mb-1 flex items-center justify-between gap-2 px-1">
                  <span className="text-[11px] text-muted-foreground">
                    اللون
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {ODOO_COLORS.map((c, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setNewColor(idx)}
                        className={cn(
                          "size-4 rounded-full ring-2 transition-all",
                          newColor === idx ? "ring-foreground/40" : "ring-transparent",
                        )}
                        style={{ backgroundColor: c }}
                        aria-label={`اللون ${idx}`}
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={createAndAttach}
                  disabled={pending}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-start text-sm transition-colors hover:bg-muted/60",
                    activeIndex === filtered.length && "bg-muted",
                  )}
                  onMouseEnter={() => setActiveIndex(filtered.length)}
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="size-3 rounded-full"
                      style={{ backgroundColor: colorFor(newColor) }}
                    />
                    إنشاء وسم «{query.trim()}»
                  </span>
                  {pending && busyTagId === "__new__" ? (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  ) : (
                    <Check className="size-3 text-cyan" />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {editing && (
        <EditTagDialog
          tag={editing}
          projectId={projectId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EditTagDialog({
  tag,
  projectId,
  onClose,
}: {
  tag: TagOption;
  projectId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await updateTagAction({ projectId, tagId: tag.id, name: name.trim(), color });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم تحديث الوسم");
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <TagIcon className="size-4 text-cyan" />
          تعديل الوسم
        </div>
        <label className="mb-1 block text-xs text-muted-foreground">الاسم</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan/40"
        />
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">اللون</span>
          <div className="flex flex-wrap items-center gap-1">
            {ODOO_COLORS.map((c, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setColor(idx)}
                className={cn(
                  "size-5 rounded-full ring-2 transition-all",
                  color === idx ? "ring-foreground/40" : "ring-transparent",
                )}
                style={{ backgroundColor: c }}
                aria-label={`اللون ${idx}`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan/90 disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3 animate-spin" />}
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}
