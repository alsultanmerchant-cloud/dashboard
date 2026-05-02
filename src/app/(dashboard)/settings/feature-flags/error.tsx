"use client";

import { ErrorState } from "@/components/error-state";
import { copy } from "@/lib/copy";

export default function FeatureFlagsError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      title={copy.featureFlags.error.title}
      description={copy.featureFlags.error.description}
      onRetry={reset}
    />
  );
}
