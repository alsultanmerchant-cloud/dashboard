"use client";
import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/error-state";

export default function Error({ reset }: { error?: Error; reset: () => void }) {
  const t = useTranslations("Organization");
  return (
    <ErrorState
      title={t("chartErrorTitle")}
      description={t("chartErrorDescription")}
      onRetry={reset}
    />
  );
}
