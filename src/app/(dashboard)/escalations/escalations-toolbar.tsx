"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

const KINDS = [
  { key: null, label: "الكل" },
  { key: "client", label: "عميل" },
  { key: "deadline", label: "موعد" },
  { key: "quality", label: "جودة" },
  { key: "resource", label: "موارد" },
] as const;

export function EscalationsToolbar({ activeKind }: { activeKind: string | null }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">تصفية حسب النوع:</span>
      {KINDS.map((k) => {
        const href = k.key ? `/escalations?kind=${k.key}` : `/escalations`;
        const isActive = (activeKind ?? null) === (k.key ?? null);
        return (
          <Link
            key={k.label}
            href={href}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              isActive
                ? "border-cyan bg-cyan/10 text-cyan"
                : "border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground",
            )}
          >
            {k.label}
          </Link>
        );
      })}
    </div>
  );
}
