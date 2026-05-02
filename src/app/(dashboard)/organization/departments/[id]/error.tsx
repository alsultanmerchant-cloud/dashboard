"use client";

import { ErrorState } from "@/components/error-state";
import { copy } from "@/lib/copy";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title={copy.organization.chartError.title}
      description={copy.organization.chartError.description}
      onRetry={reset}
    />
  );
}
