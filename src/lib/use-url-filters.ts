"use client";

// Shared URL-param filter state. Replaces the copy-pasted
// useSearchParams + useRouter + URLSearchParams boilerplate scattered across
// list pages. Anything visible in a toolbar should live in the URL (shareable,
// survives reload) — this hook is how.

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export type UrlFilterValue = string | number | null | undefined;

export interface UseUrlFiltersOptions {
  /** Param keys whose change should reset pagination back to page 1. */
  resetPageKeys?: string[];
  /** Pagination param name to reset (default "page"). */
  pageParam?: string;
  /** Debounce (ms) applied by `setDebounced`. Default 350 to match the codebase. */
  debounceMs?: number;
}

export function useUrlFilters(options: UseUrlFiltersOptions = {}) {
  const { resetPageKeys = [], pageParam = "page", debounceMs = 350 } = options;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const get = React.useCallback(
    (key: string) => searchParams.get(key),
    [searchParams],
  );

  const push = React.useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router],
  );

  const buildNext = React.useCallback(
    (entries: Record<string, UrlFilterValue>) => {
      const next = new URLSearchParams(searchParams.toString());
      let touchedResetKey = false;
      for (const [key, value] of Object.entries(entries)) {
        const str = value == null ? "" : String(value).trim();
        if (str === "") next.delete(key);
        else next.set(key, str);
        if (resetPageKeys.includes(key)) touchedResetKey = true;
      }
      if (touchedResetKey) next.delete(pageParam);
      return next;
    },
    [searchParams, resetPageKeys, pageParam],
  );

  /** Set one or more params immediately and navigate. */
  const set = React.useCallback(
    (entries: Record<string, UrlFilterValue>) => {
      push(buildNext(entries));
    },
    [buildNext, push],
  );

  /** Debounced set — ideal for free-text search inputs. */
  const setDebounced = React.useCallback(
    (entries: Record<string, UrlFilterValue>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => push(buildNext(entries)), debounceMs);
    },
    [buildNext, push, debounceMs],
  );

  /** Remove the given keys (or all `clearableKeys` if none passed). */
  const clear = React.useCallback(
    (keys: string[]) => {
      const next = new URLSearchParams(searchParams.toString());
      keys.forEach((k) => next.delete(k));
      next.delete(pageParam);
      push(next);
    },
    [searchParams, push, pageParam],
  );

  return { get, set, setDebounced, clear, searchParams } as const;
}
