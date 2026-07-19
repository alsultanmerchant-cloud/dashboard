"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Shared "how was this computed?" affordance for score/label badges across the
// dashboard. The team asked to be able to hover any AI/derived value and learn
// how it was produced. Two shapes:
//   <MetricInfo text="…" />            → a small ⓘ icon (use next to a header/label)
//   <Explained text="…">{badge}</Explained> → wrap an existing badge/value
// Each is self-contained (own TooltipProvider) so it works anywhere.

export function MetricInfo({
  text,
  label,
  className,
}: {
  text: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={label ?? "How is this calculated?"}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                className,
              )}
            />
          }
        >
          <Info className="size-3" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-normal text-start leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function Explained({
  text,
  children,
  className,
}: {
  text: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  if (!text) return <>{children}</>;
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span tabIndex={0} className={cn("cursor-help", className)} />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-normal text-start leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Like `Explained`, but the trigger is a block-level <div> so it can BE a grid
// cell / card (a <span> wrapper would collapse the layout). Use to make a whole
// metric card hover-reveal the breakdown that produced its number.
export function ExplainBlock({
  text,
  children,
  className,
}: {
  text: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  if (!text) return <div className={className}>{children}</div>;
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger render={<div className={cn("cursor-help", className)} />}>
          {children}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-normal text-start leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
