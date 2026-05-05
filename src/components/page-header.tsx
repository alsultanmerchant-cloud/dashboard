import { cn } from "@/lib/utils";
import { TopbarTitleSync } from "@/components/layout/topbar-title-sync";

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
  const hasActions = Boolean(actions);

  return (
    <>
      <TopbarTitleSync title={title} subtitle={description} />
      {hasActions ? (
        <div className={cn("mb-6 flex justify-end", className)}>
          <div className="flex items-center gap-2 flex-wrap">{actions}</div>
        </div>
      ) : null}
    </>
  );
}
