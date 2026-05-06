// Rwasem / Odoo-style two-pane Configuration shell.
//
// Left rail: searchable, scrollable item list. Each item links to the same
// page with a `?id=` param so server components handle data fetching.
// Right pane: caller-supplied detail panel (or an empty-state when nothing
// is selected). Mirrors Odoo's classic settings form layout.

import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export type ConfigItem = {
  id: string;
  label: string;
  /** Small line under the label — service name, count, etc. */
  hint?: string;
  /** Right-aligned chip — typically a count or status. */
  badge?: ReactNode;
  /** Color stripe (Odoo color hex) drawn on the start edge of the row. */
  stripeColor?: string;
  /** Inactive items render dim. */
  inactive?: boolean;
};

export function ConfigShell({
  basePath,
  items,
  selectedId,
  detail,
  emptyDetail,
  toolbar,
}: {
  /** Pathname used to build the `?id=` Links (e.g. "/task-templates"). */
  basePath: string;
  items: ConfigItem[];
  selectedId: string | null;
  detail: ReactNode | null;
  emptyDetail?: ReactNode;
  /** Optional header strip above the rail (filters, "+ new" button, etc.). */
  toolbar?: ReactNode;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      {/* Left rail */}
      <div data-config-rail className="flex flex-col gap-2">
        {toolbar}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                لا توجد عناصر
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((it) => {
                  const active = it.id === selectedId;
                  return (
                    <li key={it.id} className="relative">
                      {it.stripeColor && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 start-0 w-1"
                          style={{ backgroundColor: it.stripeColor }}
                        />
                      )}
                      <Link
                        href={`${basePath}?id=${it.id}`}
                        scroll={false}
                        className={cn(
                          "flex items-start gap-2 ps-3 pe-2 py-2.5 text-[13px] transition-colors",
                          active
                            ? "bg-primary/10 text-foreground"
                            : "text-foreground hover:bg-muted",
                          it.inactive && "opacity-60",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold leading-snug">
                            {it.label}
                          </div>
                          {it.hint && (
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {it.hint}
                            </div>
                          )}
                        </div>
                        {it.badge && (
                          <span className="shrink-0">{it.badge}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right pane */}
      <section className="min-w-0">
        {detail ?? emptyDetail ?? (
          <Card>
            <CardContent className="space-y-2 p-10 text-center">
              <Search className="mx-auto size-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">اختر عنصرًا لعرض تفاصيله</p>
              <p className="text-xs text-muted-foreground">
                اختر من القائمة على اليمين.
              </p>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
