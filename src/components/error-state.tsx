"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ErrorState({
  title,
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations("Errors");
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-cc-red/20 bg-cc-red/[0.04] px-6 py-12 text-center",
        className,
      )}
    >
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-red-dim text-cc-red ring-1 ring-cc-red/20">
        <AlertTriangle className="size-6" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title ?? t("boundaryTitle")}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground leading-relaxed">
        {description ?? t("boundaryDescription")}
      </p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-5">
          <RefreshCcw className="size-4" />
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
