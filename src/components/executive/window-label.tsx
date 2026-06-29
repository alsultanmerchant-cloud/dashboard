import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

// Small muted pill that declares the period a card's numbers cover. Rendered in
// SectionTitle's `actions` slot so every CEO-dashboard indicator states its
// window (Phase 2). Use for both windowed ("Last 30 days") and point-in-time
// ("as of Jun 29", "Next 7 days", "Current") cards.
export function WindowLabel({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-soft bg-soft-1 px-2 py-0.5 text-[10px] text-muted-foreground",
        className,
      )}
    >
      <CalendarRange className="size-3 opacity-70" />
      {label}
    </span>
  );
}
