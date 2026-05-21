"use client";

// iOS-style stacked bottom sheets. When a child sheet opens on top of a
// parent sheet, the parent settles back: scales down, rounds its corners
// further, and slides up a few pixels to create depth — Apple Mail /
// Music / Maps modal idiom.
//
// We use a custom portal + context (not Base UI Dialog) because Base UI's
// modal Dialog dismisses the underlying instance when another opens; we
// need all stack members to stay mounted.
//
// Composition:
//   <StackedSheetProvider>           ← anchors the stack (once, at app
//                                       root or per-feature root)
//     <StackedSheet open ...>        ← top-level sheet
//       <StackedSheet open ...>      ← nested sheet; parent settles back
//       </StackedSheet>
//     </StackedSheet>
//   </StackedSheetProvider>

import * as React from "react";
import * as ReactDOM from "react-dom";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ─── Context ─────────────────────────────────────────────────────────────

type StackEntry = { id: string };
type StackCtx = {
  stack: StackEntry[];
  push: (id: string) => void;
  pop: (id: string) => void;
};

const StackedSheetContext = React.createContext<StackCtx | null>(null);

export function StackedSheetProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = React.useState<StackEntry[]>([]);
  const push = React.useCallback((id: string) => {
    setStack((prev) => (prev.some((e) => e.id === id) ? prev : [...prev, { id }]));
  }, []);
  const pop = React.useCallback((id: string) => {
    setStack((prev) => prev.filter((e) => e.id !== id));
  }, []);
  const value = React.useMemo(() => ({ stack, push, pop }), [stack, push, pop]);
  return (
    <StackedSheetContext.Provider value={value}>
      {children}
    </StackedSheetContext.Provider>
  );
}

function useStack() {
  const ctx = React.useContext(StackedSheetContext);
  if (!ctx) {
    throw new Error("StackedSheet must be rendered inside <StackedSheetProvider>.");
  }
  return ctx;
}

// ─── Sheet ───────────────────────────────────────────────────────────────

export type StackedSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Height as a viewport fraction. Default 0.86 (86dvh). */
  heightFraction?: number;
  hideClose?: boolean;
  hideHandle?: boolean;
  /** Disable swipe-down-to-dismiss on the header. Default false. */
  disableSwipe?: boolean;
  className?: string;
  bodyClassName?: string;
};

const SWIPE_CLOSE_THRESHOLD = 120; // px past which the sheet dismisses
const SWIPE_CLOSE_VELOCITY = 0.6; // px/ms

export function StackedSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  heightFraction = 0.86,
  hideClose = false,
  hideHandle = false,
  disableSwipe = false,
  className,
  bodyClassName,
}: StackedSheetProps) {
  const id = React.useId();
  const { stack, push, pop } = useStack();
  const [mounted, setMounted] = React.useState(false);
  const [entering, setEntering] = React.useState(true);
  const popupRef = React.useRef<HTMLDivElement | null>(null);
  const openerRef = React.useRef<Element | null>(null);

  // Register/unregister in the stack.
  React.useEffect(() => {
    if (open) {
      push(id);
      return () => pop(id);
    }
    return undefined;
  }, [open, id, push, pop]);

  // Mount lifecycle — keep the popup in the DOM for the exit transition.
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => setEntering(false));
      return () => cancelAnimationFrame(r);
    } else if (mounted) {
      setEntering(true);
      const t = setTimeout(() => setMounted(false), 320);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, mounted]);

  // Body scroll lock while any sheet is open.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const myIndex = stack.findIndex((e) => e.id === id);
  const isTopmost = myIndex === stack.length - 1;

  // Escape closes topmost.
  React.useEffect(() => {
    if (!open || !isTopmost) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isTopmost, onOpenChange]);

  // Focus management — when topmost, move focus into the sheet; on
  // unmount, restore to the opener element.
  React.useEffect(() => {
    if (!open || !isTopmost) return;
    openerRef.current = document.activeElement;
    const node = popupRef.current;
    if (node) {
      const focusable = node.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? node).focus();
    }
    return () => {
      const opener = openerRef.current as HTMLElement | null;
      if (opener && typeof opener.focus === "function") {
        // Defer so the next topmost sheet's effect runs first.
        requestAnimationFrame(() => opener.focus());
      }
    };
  }, [open, isTopmost]);

  // Trap Tab within the topmost sheet.
  React.useEffect(() => {
    if (!open || !isTopmost) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const node = popupRef.current;
      if (!node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isTopmost]);

  // Swipe-to-dismiss. Tracks pointer on the header region; while
  // dragging we override the popup transform; on release we either snap
  // back (animated) or close.
  const [dragY, setDragY] = React.useState<number | null>(null);
  const dragState = React.useRef<{ startY: number; startTime: number } | null>(null);

  const onSwipeDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disableSwipe || !isTopmost) return;
      dragState.current = { startY: e.clientY, startTime: performance.now() };
      setDragY(0);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [disableSwipe, isTopmost],
  );
  const onSwipeMove = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const dy = Math.max(0, e.clientY - dragState.current.startY);
    setDragY(dy);
  }, []);
  const onSwipeEnd = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState.current) return;
      const dy = Math.max(0, e.clientY - dragState.current.startY);
      const dt = performance.now() - dragState.current.startTime;
      const velocity = dy / Math.max(dt, 1);
      dragState.current = null;
      setDragY(null);
      if (dy >= SWIPE_CLOSE_THRESHOLD || velocity >= SWIPE_CLOSE_VELOCITY) {
        onOpenChange(false);
      }
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore — pointer may already be released
      }
    },
    [onOpenChange],
  );

  if (!mounted) return null;

  const depth = myIndex >= 0 ? stack.length - myIndex - 1 : 0;
  const layer = Math.min(depth, 2);
  const baseTransform = entering
    ? "translateY(100%) scale(1)"
    : [
        "translateY(0) scale(1)",
        "translateY(-14px) scale(0.965)",
        "translateY(-26px) scale(0.93)",
      ][layer];
  const transform = dragY != null ? `translateY(${dragY}px) scale(1)` : baseTransform;
  const radius = ["1.25rem", "1.5rem", "1.75rem"][layer];
  const dim = entering ? 0 : [0, 0.18, 0.32][layer];
  const zIndex = 50 + (myIndex >= 0 ? myIndex * 2 : 0);

  // While dragging, kill the transition so the popup tracks the pointer
  // 1:1. On release we restore the transition for the snap-back.
  const transition = dragY != null
    ? "none"
    : "transform 300ms cubic-bezier(0.32, 0.72, 0, 1), border-radius 300ms";

  return ReactDOM.createPortal(
    <div className="fixed inset-0" style={{ zIndex }} role="dialog" aria-modal="true">
      {depth === 0 && (
        <div
          onClick={() => onOpenChange(false)}
          className={cn(
            "absolute inset-0 bg-black/30 transition-opacity duration-300",
            "supports-backdrop-filter:backdrop-blur-sm",
          )}
          style={{ opacity: entering ? 0 : 1 }}
          aria-hidden
        />
      )}

      <div
        ref={popupRef}
        tabIndex={-1}
        data-stack-depth={depth}
        style={{
          transform,
          transition,
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
          height: `${Math.round(heightFraction * 100)}dvh`,
        }}
        className={cn(
          "absolute inset-x-0 bottom-0 mx-auto flex max-w-2xl flex-col bg-card text-foreground shadow-[0_-12px_40px_rgba(0,0,0,0.18)] outline-none",
          className,
        )}
      >
        {/* Per-sheet dim overlay — visible only when a child sheet is on
            top of this one. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 bg-black transition-opacity duration-300"
          style={{
            opacity: dim,
            borderTopLeftRadius: radius,
            borderTopRightRadius: radius,
          }}
        />

        {/* Swipe handle region — covers grabber + header. Pointer events
            registered only on this region so the body can still scroll. */}
        <div
          onPointerDown={onSwipeDown}
          onPointerMove={onSwipeMove}
          onPointerUp={onSwipeEnd}
          onPointerCancel={onSwipeEnd}
          className={cn(
            "shrink-0",
            !disableSwipe && isTopmost && "touch-none cursor-grab active:cursor-grabbing",
          )}
        >
          {!hideHandle && (
            <div className="flex justify-center pt-2 pb-1">
              <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            </div>
          )}

          {(title || description || !hideClose) && (
            <div className="flex items-start gap-3 px-5 pt-2 pb-3">
              <div className="min-w-0 flex-1">
                {title ? (
                  <h2 className="truncate text-base font-semibold text-foreground">
                    {title}
                  </h2>
                ) : null}
                {description ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {description}
                  </p>
                ) : null}
              </div>
              {!hideClose && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onOpenChange(false)}
                  className="-mt-1 -me-1 shrink-0"
                >
                  <XIcon />
                  <span className="sr-only">Close</span>
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-5 pb-4",
            bodyClassName,
          )}
        >
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-border bg-card/95 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
