"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { ErrorState } from "@/components/error-state";

export default function TaskDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("TaskDetailPage.error");
  useEffect(() => {
    console.error("[tasks/[id] error]", error);
  }, [error]);

  return (
    <div className="p-4 md:p-6 space-y-3">
      <ErrorState
        title={t("title")}
        description={t("description")}
        onRetry={reset}
      />
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4 icon-flip-rtl" />
          {t("back")}
        </Link>
        {error.digest && (
          <span className="text-[11px] font-mono text-muted-foreground/60">
            ref: {error.digest}
          </span>
        )}
      </div>
    </div>
  );
}
