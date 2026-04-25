// A lightweight, theme-aware table wrapper. Use this for read-mostly tables.
// For interactive tables (sorting, paging, column visibility) compose
// @tanstack/react-table inside a `DataTableShell`.

import { cn } from "@/lib/utils";

export function DataTableShell({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-white/[0.06] bg-card",
        "shadow-[0_0_20px_rgba(0,212,255,0.04),inset_0_1px_0_rgba(255,255,255,0.04)]",
        className,
      )}
    >
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function DataTable({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn(
        "w-full border-collapse text-right text-sm",
        // RTL header alignment
        className,
      )}
      {...props}
    />
  );
}

export function DataTableHead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("bg-white/[0.02] text-[11px] uppercase tracking-wider text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DataTableHeaderCell({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-3 py-2.5 font-medium text-start", className)} {...props} />;
}

export function DataTableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-t border-white/[0.04] transition-colors hover:bg-white/[0.02]",
        className,
      )}
      {...props}
    />
  );
}

export function DataTableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-3 align-middle", className)} {...props} />;
}
