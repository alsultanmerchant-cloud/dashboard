"use client";

// Demo mode — blurs sensitive data so the dashboard can be screen-recorded or
// demoed without exposing real company data.
//
// How it works: enabled categories are written to `<html data-demo="...">`, and
// globals.css blurs anything tagged `data-private="<category>"`. Nothing is
// removed from the DOM — this is a *presentation* guard for video/screenshare,
// not a security boundary. Do not rely on it to hide data from someone who can
// open devtools or read the network tab.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const PRIVATE_CATEGORIES = ["client", "money", "person", "chat"] as const;
export type PrivateCategory = (typeof PRIVATE_CATEGORIES)[number];

export type DemoModeState = {
  enabled: boolean;
  categories: PrivateCategory[];
  /** Un-blur an element while the presenter hovers it. */
  revealOnHover: boolean;
};

export const DEMO_MODE_STORAGE_KEY = "rwasem-demo-mode";

export const DEMO_MODE_DEFAULT: DemoModeState = {
  enabled: false,
  categories: [...PRIVATE_CATEGORIES],
  revealOnHover: false,
};

type DemoModeContextValue = DemoModeState & {
  setEnabled: (next: boolean) => void;
  toggleEnabled: () => void;
  setCategory: (category: PrivateCategory, on: boolean) => void;
  setRevealOnHover: (next: boolean) => void;
  /** True when `category` is currently being blurred. */
  isBlurred: (category: PrivateCategory) => boolean;
};

const DemoModeContext = createContext<DemoModeContextValue | null>(null);

function parse(raw: string | null): DemoModeState {
  if (!raw) return DEMO_MODE_DEFAULT;
  try {
    const parsed = JSON.parse(raw) as Partial<DemoModeState>;
    const categories = Array.isArray(parsed.categories)
      ? PRIVATE_CATEGORIES.filter((c) => parsed.categories!.includes(c))
      : DEMO_MODE_DEFAULT.categories;
    return {
      enabled: parsed.enabled === true,
      categories,
      revealOnHover: parsed.revealOnHover === true,
    };
  } catch {
    return DEMO_MODE_DEFAULT;
  }
}

/** The `data-demo` value for a state — space-separated so CSS `~=` can match. */
export function demoAttrValue(state: DemoModeState): string {
  if (!state.enabled || state.categories.length === 0) return "";
  return state.categories.join(" ");
}

export function DemoModeProvider({ children }: { children: React.ReactNode }) {
  // Starts at the default and syncs from localStorage on mount. The pre-paint
  // bootstrap script in the root layout has already applied the real value to
  // <html>, so there is no flash of unblurred data before this catches up.
  const [state, setState] = useState<DemoModeState>(DEMO_MODE_DEFAULT);

  useEffect(() => {
    setState(parse(window.localStorage.getItem(DEMO_MODE_STORAGE_KEY)));
  }, []);

  const commit = useCallback((next: DemoModeState) => {
    setState(next);
    try {
      window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const value = demoAttrValue(state);
    if (value) root.setAttribute("data-demo", value);
    else root.removeAttribute("data-demo");
    root.toggleAttribute("data-demo-reveal", state.enabled && state.revealOnHover);
  }, [state]);

  const setEnabled = useCallback(
    (next: boolean) => commit({ ...state, enabled: next }),
    [commit, state],
  );

  const toggleEnabled = useCallback(
    () => commit({ ...state, enabled: !state.enabled }),
    [commit, state],
  );

  const setCategory = useCallback(
    (category: PrivateCategory, on: boolean) =>
      commit({
        ...state,
        categories: on
          ? PRIVATE_CATEGORIES.filter(
              (c) => c === category || state.categories.includes(c),
            )
          : state.categories.filter((c) => c !== category),
      }),
    [commit, state],
  );

  const setRevealOnHover = useCallback(
    (next: boolean) => commit({ ...state, revealOnHover: next }),
    [commit, state],
  );

  // Presenter shortcut — cmd/ctrl+shift+B flips demo mode without leaving the
  // page being recorded.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleEnabled();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleEnabled]);

  const value = useMemo<DemoModeContextValue>(
    () => ({
      ...state,
      setEnabled,
      toggleEnabled,
      setCategory,
      setRevealOnHover,
      isBlurred: (category) => state.enabled && state.categories.includes(category),
    }),
    [state, setEnabled, toggleEnabled, setCategory, setRevealOnHover],
  );

  return <DemoModeContext.Provider value={value}>{children}</DemoModeContext.Provider>;
}

export function useDemoMode() {
  const ctx = useContext(DemoModeContext);
  if (!ctx) throw new Error("useDemoMode must be used within DemoModeProvider");
  return ctx;
}

/**
 * Tag an element as sensitive. Works in server components — the blur is pure
 * CSS keyed off `<html data-demo>`, so no client hook is involved.
 *
 *   <span {...privateAttr("client")}>{client.name}</span>
 */
export function privateAttr(category: PrivateCategory) {
  return { "data-private": category } as const;
}

/**
 * Wrap sensitive content. Renders a plain <span> by default; pass `as` for a
 * different element when the surrounding layout needs one.
 *
 *   <Private kind="money">{formatSar(contract.value)}</Private>
 */
export function Private({
  kind,
  children,
  className,
  as: Tag = "span",
}: {
  kind: PrivateCategory;
  children: React.ReactNode;
  className?: string;
  as?: "span" | "div" | "td" | "p" | "h3";
}) {
  return (
    <Tag data-private={kind} className={className}>
      {children}
    </Tag>
  );
}
