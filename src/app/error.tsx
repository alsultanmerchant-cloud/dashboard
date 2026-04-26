"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

export default function GlobalError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md">
        <ErrorState
          title="حدثت مشكلة غير متوقعة"
          description={
            error.digest
              ? `الرجاء المحاولة مرة أخرى. مرجع الخطأ: ${error.digest}`
              : "الرجاء المحاولة مرة أخرى. إذا تكرر الخطأ تواصل مع مسؤول النظام."
          }
          onRetry={reset}
        />
      </div>
    </main>
  );
}
