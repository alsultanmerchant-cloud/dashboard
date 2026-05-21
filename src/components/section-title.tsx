import { cn } from "@/lib/utils";

export function SectionTitle({
  title,
  description,
  actions,
  className,
  id,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  /** Set when callers need a scroll anchor (e.g. action-bar smart-pill jumps). */
  id?: string;
}) {
  return (
    <div id={id} className={cn("mb-3 flex items-end justify-between gap-3 scroll-mt-40", className)}>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
