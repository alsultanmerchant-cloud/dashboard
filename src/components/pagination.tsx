"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  total: number;
  pageSize: number;
  currentPage: number;
  /** URL query key for the page number. Defaults to "page". */
  pageParam?: string;
  className?: string;
}

const numAr = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

export function Pagination({
  total,
  pageSize,
  currentPage,
  pageParam = "page",
  className,
}: PaginationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (totalPages <= 1) return null;

  const buildHref = (page: number) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (page <= 1) sp.delete(pageParam);
    else sp.set(pageParam, String(page));
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, total);

  // Build page-number list with ellipses (max ~7 entries)
  const pages: (number | "…")[] = [];
  const push = (v: number | "…") => pages.push(v);
  const window = 1; // pages on each side of current
  push(1);
  if (currentPage - window > 2) push("…");
  for (
    let p = Math.max(2, currentPage - window);
    p <= Math.min(totalPages - 1, currentPage + window);
    p++
  ) {
    push(p);
  }
  if (currentPage + window < totalPages - 1) push("…");
  if (totalPages > 1) push(totalPages);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-card/60 px-3 py-2.5 text-xs",
        className,
      )}
    >
      <span className="text-muted-foreground tabular-nums">
        {numAr(from)}–{numAr(to)} من {numAr(total)}
      </span>

      <div className="flex items-center gap-1">
        <PageLink
          href={buildHref(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="السابق"
        >
          <ChevronRight className="size-3.5" />
        </PageLink>

        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`e${i}`}
              className="px-2 py-1 text-muted-foreground select-none"
            >
              …
            </span>
          ) : (
            <PageLink
              key={p}
              href={buildHref(p)}
              active={p === currentPage}
              aria-label={`صفحة ${numAr(p)}`}
              aria-current={p === currentPage ? "page" : undefined}
            >
              {numAr(p)}
            </PageLink>
          ),
        )}

        <PageLink
          href={buildHref(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="التالي"
        >
          <ChevronLeft className="size-3.5" />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  children,
  active,
  disabled,
  ...rest
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const base =
    "inline-flex min-w-[28px] items-center justify-center rounded-lg border px-2 py-1 text-[11px] font-medium tabular-nums transition-colors";
  if (disabled) {
    return (
      <span
        className={cn(
          base,
          "border-white/[0.04] bg-white/[0.02] text-muted-foreground/40 cursor-not-allowed",
        )}
        aria-disabled="true"
        {...rest}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        base,
        active
          ? "border-cyan/30 bg-cyan-dim text-cyan"
          : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground hover:border-white/[0.12]",
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
