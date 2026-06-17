"use client";

// Canonical filter chip. Mirrors the active/inactive pill used across the
// project-management toolbar (cyan-dim active, soft inactive). Use everywhere
// instead of hand-rolling `<Link>`/`<button>` chip classes per page.

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type CommonProps = {
  active?: boolean;
  /** Optional trailing count badge (e.g. number of matches). */
  count?: number | null;
  className?: string;
  children: React.ReactNode;
};

type LinkChip = CommonProps & {
  as?: "link";
  href: string;
};

type ButtonChip = CommonProps & {
  as: "button";
  onClick?: () => void;
  disabled?: boolean;
};

export type FilterChipProps = LinkChip | ButtonChip;

const chipClass = (active?: boolean, className?: string) =>
  cn(
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-cyan/30 bg-cyan-dim text-cyan"
      : "border-soft bg-soft-1 text-muted-foreground hover:text-foreground",
    className,
  );

function Count({ value, active }: { value: number; active?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 text-[0.65rem] tabular-nums",
        active ? "bg-cyan/15 text-cyan" : "bg-soft-2 text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

export function FilterChip(props: FilterChipProps) {
  const { active, count, className, children } = props;
  const body = (
    <>
      {children}
      {count != null && <Count value={count} active={active} />}
    </>
  );

  if (props.as === "button") {
    return (
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-pressed={active}
        className={chipClass(active, className)}
      >
        {body}
      </button>
    );
  }

  return (
    <Link href={props.href} aria-current={active ? "true" : undefined} className={chipClass(active, className)}>
      {body}
    </Link>
  );
}
