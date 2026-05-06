// MetricCard — dashboard headline cards (active clients / open tasks / etc.).
// For interactive analytics tiles use src/components/ui/stat-card.tsx instead.

import * as React from "react";
import Link from "next/link";
import { ArrowUpLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export type MetricTone = "default" | "success" | "warning" | "destructive" | "info" | "purple";

const toneAccent: Record<MetricTone, string> = {
  default: "text-cyan bg-cyan-dim border-cyan/25",
  success: "text-cc-green bg-green-dim border-cc-green/25",
  warning: "text-amber bg-amber-dim border-amber/25",
  destructive: "text-cc-red bg-red-dim border-cc-red/25",
  info: "text-cc-blue bg-blue-dim border-cc-blue/25",
  purple: "text-cc-purple bg-purple-dim border-cc-purple/25",
};

const toneGlow: Record<MetricTone, string> = {
  default: "hover:shadow-[0_0_24px_rgba(0,212,255,0.12)]",
  success: "hover:shadow-[0_0_24px_rgba(16,185,129,0.12)]",
  warning: "hover:shadow-[0_0_24px_rgba(245,158,11,0.12)]",
  destructive: "hover:shadow-[0_0_24px_rgba(239,68,68,0.12)]",
  info: "hover:shadow-[0_0_24px_rgba(125,166,255,0.12)]",
  purple: "hover:shadow-[0_0_24px_rgba(139,92,246,0.12)]",
};

export interface MetricCardProps {
  label: string;
  value: number | string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: MetricTone;
  href?: string;
  trend?: { value: string; direction: "up" | "down" | "flat" };
  className?: string;
  size?: "default" | "compact";
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  href,
  trend,
  className,
  size = "default",
}: MetricCardProps) {
  const inner = (
    <div
      className={cn(
        "group/metric relative rounded-2xl border border-cyan/[0.18] bg-card transition-all duration-200",
        size === "default" && "p-4",
        size === "compact" && "p-3",
        "shadow-[0_0_20px_rgba(0,212,255,0.05),inset_0_1px_0_rgba(255,255,255,0.04)]",
        href && "cursor-pointer",
        href && toneGlow[tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "font-medium uppercase tracking-[0.12em] text-muted-foreground",
              size === "default" && "text-[11px]",
              size === "compact" && "text-[10px]",
            )}
          >
            {label}
          </div>
          <div
            className={cn(
              "font-bold tabular-nums text-foreground leading-none",
              size === "default" && "mt-2 text-3xl",
              size === "compact" && "mt-1.5 text-2xl",
            )}
          >
            {value}
          </div>
          {(hint || trend) && (
            <div
              className={cn(
                "flex items-center gap-2 text-muted-foreground",
                size === "default" && "mt-2 text-[11px]",
                size === "compact" && "mt-1.5 text-[10px]",
              )}
            >
              {trend && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                    trend.direction === "up" && "bg-green-dim text-cc-green",
                    trend.direction === "down" && "bg-red-dim text-cc-red",
                    trend.direction === "flat" && "bg-soft-2 text-muted-foreground",
                  )}
                >
                  {trend.value}
                </span>
              )}
              {hint && <span>{hint}</span>}
            </div>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              "flex items-center justify-center border ring-1 ring-white/5",
              size === "default" && "size-10 rounded-xl",
              size === "compact" && "size-8 rounded-lg",
              toneAccent[tone],
            )}
          >
            {icon}
          </div>
        )}
      </div>
      {href && (
        <ArrowUpLeft
          className="absolute bottom-3 left-3 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/metric:opacity-100"
          aria-hidden
        />
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {inner}
      </Link>
    );
  }
  return inner;
}
