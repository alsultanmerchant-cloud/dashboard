import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: Crumb[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 mb-6", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {b.href ? (
                <Link href={b.href} className="hover:text-foreground transition-colors">
                  {b.label}
                </Link>
              ) : (
                <span className="text-foreground/80">{b.label}</span>
              )}
              {i < breadcrumbs.length - 1 && (
                <ChevronLeft className="size-3 opacity-50 icon-flip-rtl" />
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5 min-w-0">
          <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-foreground leading-tight">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}
