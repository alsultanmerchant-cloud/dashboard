import { cn } from "@/lib/utils";
import { TopbarTitleSync } from "@/components/layout/topbar-title-sync";

export type Crumb = { label: string; href?: string };

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizePlainText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const stripped = decodeEntities(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || undefined;
}

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
  const safeTitle = normalizePlainText(title) ?? title;
  const safeDescription = normalizePlainText(description);

  return (
    <>
      <TopbarTitleSync title={safeTitle} subtitle={safeDescription} />
      {hasActions ? (
        <div className={cn("mb-6 flex justify-end", className)}>
          <div className="flex items-center gap-2 flex-wrap">{actions}</div>
        </div>
      ) : null}
    </>
  );
}
