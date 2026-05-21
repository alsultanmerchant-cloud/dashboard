"use client";

// Odoo-style record pagination — `n / N < >` chip in the action bar of a
// detail page, with Cmd/Ctrl+←/→ shortcuts. Mirrors the muscle memory of
// stepping through records without going back to the list (§NAV-2).
//
// The list-side captures the ordered IDs + URL pattern into sessionStorage
// via RecordPaginationListTap. The detail-side reads from sessionStorage
// to compute prev/next — no extra server round-trip.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY_PREFIX = "rwasem:record-list:";

export type RecordKind = "projects" | "tasks";

type Stored = { ids: string[]; hrefPattern: string };

function readList(kind: RecordKind): Stored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY_PREFIX + kind);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!Array.isArray(parsed.ids) || typeof parsed.hrefPattern !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildHref(pattern: string, id: string): string {
  return pattern.replace("{id}", id);
}

type Resolved = {
  index: number;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
};

function resolve(stored: Stored | null, recordId: string): Resolved {
  if (!stored) return { index: 0, total: 1, prevHref: null, nextHref: null };
  const i = stored.ids.indexOf(recordId);
  if (i < 0) return { index: 0, total: stored.ids.length, prevHref: null, nextHref: null };
  return {
    index: i,
    total: stored.ids.length,
    prevHref: i > 0 ? buildHref(stored.hrefPattern, stored.ids[i - 1]) : null,
    nextHref: i + 1 < stored.ids.length ? buildHref(stored.hrefPattern, stored.ids[i + 1]) : null,
  };
}

export function RecordPagination({
  kind,
  recordId,
  className,
}: {
  kind: RecordKind;
  recordId: string;
  className?: string;
}) {
  const router = useRouter();
  const t = useTranslations("RecordPagination");
  // Hydrate from sessionStorage after mount — server can't read it, so we
  // render the "1 / 1" placeholder first and replace on the client.
  const [state, setState] = useState<Resolved>({ index: 0, total: 1, prevHref: null, nextHref: null });

  useEffect(() => {
    setState(resolve(readList(kind), recordId));
  }, [kind, recordId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      // Don't hijack arrows while typing in a field.
      if (target && target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (e.key === "ArrowLeft" && state.prevHref) {
        e.preventDefault();
        router.push(state.prevHref);
      } else if (e.key === "ArrowRight" && state.nextHref) {
        e.preventDefault();
        router.push(state.nextHref);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, router]);

  const position = `${state.index + 1} / ${state.total}`;
  const navCls =
    "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[12px] text-muted-foreground",
        className,
      )}
      role="group"
      aria-label={t("label")}
    >
      <span dir="ltr" className="tabular-nums px-1 text-[12px] text-foreground/80">
        {position}
      </span>
      {state.prevHref ? (
        <Link
          href={state.prevHref}
          className={navCls}
          aria-label={t("previous")}
          title={`${t("previous")} (⌘/Ctrl+←)`}
        >
          <ChevronLeft className="size-4 rtl:hidden" />
          <ChevronRight className="size-4 ltr:hidden" />
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className={navCls}
          aria-label={t("previous")}
        >
          <ChevronLeft className="size-4 rtl:hidden" />
          <ChevronRight className="size-4 ltr:hidden" />
        </button>
      )}
      {state.nextHref ? (
        <Link
          href={state.nextHref}
          className={navCls}
          aria-label={t("next")}
          title={`${t("next")} (⌘/Ctrl+→)`}
        >
          <ChevronRight className="size-4 rtl:hidden" />
          <ChevronLeft className="size-4 ltr:hidden" />
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className={navCls}
          aria-label={t("next")}
        >
          <ChevronRight className="size-4 rtl:hidden" />
          <ChevronLeft className="size-4 ltr:hidden" />
        </button>
      )}
    </div>
  );
}

/** Captures the current list of record IDs into sessionStorage so the detail
 *  page can paginate through them without a second server query. Render this
 *  as a sibling of the list (one per page is enough). */
export function RecordPaginationListTap({
  kind,
  ids,
  hrefPattern,
}: {
  kind: RecordKind;
  ids: string[];
  /** URL template with `{id}` placeholder, e.g. `/projects/{id}`. */
  hrefPattern: string;
}) {
  useEffect(() => {
    if (ids.length === 0) return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY_PREFIX + kind,
        JSON.stringify({ ids, hrefPattern }),
      );
    } catch {
      /* sessionStorage can throw in private mode — pagination just degrades */
    }
  }, [kind, ids, hrefPattern]);
  return null;
}
