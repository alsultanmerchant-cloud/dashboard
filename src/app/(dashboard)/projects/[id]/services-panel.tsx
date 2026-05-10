"use client";

// Sky Light feedback #12: editable multi-package selection on the project
// detail page. Replaces the read-only chip strip — same visual layout, but
// each chip carries a remove button and a searchable "Add package" combobox
// is appended at the end. Backed by attach/detach server actions in
// _service_actions.ts.

import { useMemo, useRef, useState, useTransition, useEffect } from "react";
import { Plus, X, Loader2, Check, Search } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ServiceBadge } from "@/components/status-badges";
import { cn } from "@/lib/utils";
import {
  attachProjectServiceAction,
  detachProjectServiceAction,
} from "./_service_actions";

export type ServiceLink = {
  id: string;
  service_id: string;
  service: { id: string; name: string; slug: string };
};

export type ServiceCandidate = {
  id: string;
  name: string;
  slug: string;
};

export function ProjectServicesPanel({
  projectId,
  attached,
  candidates,
  canManage,
}: {
  projectId: string;
  attached: ServiceLink[];
  candidates: ServiceCandidate[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const attachedIds = useMemo(
    () => new Set(attached.map((a) => a.service_id)),
    [attached],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((c) => !attachedIds.has(c.id))
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q),
      );
  }, [candidates, attachedIds, query]);

  useEffect(() => {
    setActiveIndex((i) => Math.min(Math.max(0, i), Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!adding) return;
    inputRef.current?.focus();
    function onPointerDown(e: PointerEvent) {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) {
        setAdding(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [adding]);

  function attach(serviceId: string) {
    setBusyServiceId(serviceId);
    start(async () => {
      const res = await attachProjectServiceAction({ projectId, serviceId });
      setBusyServiceId(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تمت إضافة الباقة");
      setQuery("");
      router.refresh();
    });
  }

  function detach(serviceId: string, serviceName: string) {
    if (!window.confirm(`إزالة باقة «${serviceName}» من المشروع؟`)) return;
    setBusyServiceId(serviceId);
    start(async () => {
      const res = await detachProjectServiceAction({ projectId, serviceId });
      setBusyServiceId(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تمت الإزالة");
      router.refresh();
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) attach(target.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setAdding(false);
      setQuery("");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {attached.length === 0 && !canManage && (
        <p className="text-sm text-muted-foreground">لا توجد باقات مرتبطة بعد.</p>
      )}
      {attached.map((ps) => {
        const s = ps.service;
        const isBusy = busyServiceId === s.id && pending;
        return (
          <span
            key={ps.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-soft bg-soft-1 ps-1 pe-2 py-1"
          >
            <ServiceBadge slug={s.slug} name={s.name} />
            {canManage && (
              <button
                type="button"
                onClick={() => detach(ps.service_id, s.name)}
                disabled={pending}
                aria-label={`إزالة ${s.name}`}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-cc-red/10 hover:text-cc-red transition-colors disabled:opacity-50"
              >
                {isBusy ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <X className="size-3" />
                )}
              </button>
            )}
          </span>
        );
      })}

      {canManage && (
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            disabled={candidates.length === 0 || candidates.length === attached.length}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-dashed border-soft px-2.5 py-1 text-xs",
              "text-muted-foreground hover:text-foreground hover:border-cyan/40 hover:bg-cyan-dim/30 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
            aria-haspopup="listbox"
            aria-expanded={adding}
          >
            <Plus className="size-3" />
            إضافة باقة
          </button>

          {adding && (
            <div
              className="absolute z-30 mt-1.5 w-72 max-w-[90vw] overflow-hidden rounded-xl border border-soft bg-card shadow-2xl shadow-black/30"
              role="dialog"
              aria-label="اختر باقة"
            >
              <div className="flex items-center gap-2 border-b border-soft px-2.5 py-2">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="ابحث عن باقة..."
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
              <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <li className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                    لا نتائج
                  </li>
                ) : (
                  filtered.map((c, idx) => {
                    const isActive = idx === activeIndex;
                    return (
                      <li key={c.id} role="option" aria-selected={isActive}>
                        <button
                          type="button"
                          disabled={pending}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => attach(c.id)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-start text-xs transition-colors disabled:opacity-60",
                            isActive
                              ? "bg-cyan-dim/60 text-foreground"
                              : "hover:bg-soft-2",
                          )}
                        >
                          <span className="truncate">{c.name}</span>
                          {busyServiceId === c.id && pending ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                          ) : (
                            <Check className="size-3.5 shrink-0 opacity-0" />
                          )}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              <div className="border-t border-soft px-2.5 py-1.5 text-[10px] text-muted-foreground">
                {filtered.length} متاح
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
