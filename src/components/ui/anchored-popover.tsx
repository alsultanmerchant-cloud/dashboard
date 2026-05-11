"use client";

// Portal-rendered popover anchored to a trigger element. Solves the common
// shadcn-Card-clipping problem: any popover positioned `absolute` inside a
// `<Card>` (which has overflow-hidden for its rounded corners) gets cut off
// at the card edge. Rendering via portal escapes the clip; using
// `position: fixed` with getBoundingClientRect gives us pixel-accurate
// anchoring without depending on a positioned ancestor.
//
// RTL-aware: when `align="end"` (the common case for "drop from the end of
// the trigger"), the popover's inline-end edge aligns with the trigger's
// inline-end edge regardless of `dir`. We compute this from the trigger's
// bounding rect and the document direction.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type Props = {
  /** Ref to the element the popover anchors to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Whether the popover is open. */
  open: boolean;
  /** Called when the user clicks outside or presses Escape. */
  onClose: () => void;
  /** Side of the trigger to align with. "end" = drop from the trigger's
   *  inline-end edge (right in LTR, left in RTL). "start" = inline-start. */
  align?: "start" | "end";
  /** Pixels of gap between trigger and popover. */
  gap?: number;
  /** Tailwind classes for the popover container. */
  className?: string;
  children: ReactNode;
};

export function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  align = "end",
  gap = 6,
  className,
  children,
}: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Recompute position whenever the popover opens, the window resizes, or
  // the user scrolls. useLayoutEffect avoids the one-frame flicker at the
  // wrong coordinates that useEffect would cause.
  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    function compute() {
      const trigger = anchorRef.current;
      const pop = popoverRef.current;
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      const isRtl =
        document.documentElement.dir === "rtl" ||
        getComputedStyle(document.documentElement).direction === "rtl";
      const popWidth = pop?.offsetWidth ?? 320;
      let left: number;
      if (align === "end") {
        // Inline-end of trigger:
        // LTR → trigger.right; popover left = right - popWidth.
        // RTL → trigger.left;  popover left = left.
        left = isRtl ? r.left : r.right - popWidth;
      } else {
        // Inline-start of trigger:
        // LTR → trigger.left.
        // RTL → trigger.right - popWidth.
        left = isRtl ? r.right - popWidth : r.left;
      }
      // Clamp to viewport with a 12px gutter.
      const maxLeft = window.innerWidth - popWidth - 12;
      if (left > maxLeft) left = maxLeft;
      if (left < 12) left = 12;
      setCoords({ top: r.bottom + gap, left });
    }
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, anchorRef, align, gap]);

  // Outside click + Esc handling. Trigger is excluded so clicking it again
  // closes via the parent's own toggle without us racing it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const pop = popoverRef.current;
      const trigger = anchorRef.current;
      const target = e.target as Node;
      if (pop && pop.contains(target)) return;
      if (trigger && trigger.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        visibility: coords ? "visible" : "hidden",
      }}
      className={className}
    >
      {children}
    </div>,
    document.body,
  );
}
