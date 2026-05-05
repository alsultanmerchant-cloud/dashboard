import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function RecordPagination({
  position,
  total,
  prevId,
  nextId,
  basePath,
}: {
  position: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
  basePath: string;
}) {
  const linkClass =
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-soft-2 hover:text-foreground";
  const disabledClass = "opacity-30 pointer-events-none";

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-soft bg-card px-1.5 py-0.5">
      {prevId ? (
        <Link
          href={`${basePath}/${prevId}`}
          className={linkClass}
          aria-label="السابق"
        >
          <ChevronRight className="size-3.5 icon-flip-rtl" />
        </Link>
      ) : (
        <span className={cn(linkClass, disabledClass)} aria-hidden>
          <ChevronRight className="size-3.5 icon-flip-rtl" />
        </span>
      )}
      <span className="px-1 text-[11px] tabular-nums text-muted-foreground">
        {position} / {total}
      </span>
      {nextId ? (
        <Link
          href={`${basePath}/${nextId}`}
          className={linkClass}
          aria-label="التالي"
        >
          <ChevronLeft className="size-3.5 icon-flip-rtl" />
        </Link>
      ) : (
        <span className={cn(linkClass, disabledClass)} aria-hidden>
          <ChevronLeft className="size-3.5 icon-flip-rtl" />
        </span>
      )}
    </div>
  );
}
