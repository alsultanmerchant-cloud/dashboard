"use client";

import { Component, Suspense, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/error-state";

// Per-section error isolation for the executive dashboard. Each section is an
// async server component behind its own Suspense. Suspense only handles the
// LOADING state — a thrown error (e.g. a transient Supabase/Odoo ETIMEDOUT in
// one section's data fetch) bubbles past it to the route-level error.tsx and
// blanks the WHOLE dashboard. This boundary catches that failure so only the
// affected card shows an error + retry; every other section still renders.

function SectionFallback({ onReset }: { onReset: () => void }) {
  const router = useRouter();
  const t = useTranslations("Errors");
  return (
    <ErrorState
      className="my-4 px-6 py-8"
      title={t("sectionTitle")}
      description={t("sectionDescription")}
      onRetry={() => {
        // Fetch fresh server data, then drop the error state so the refreshed
        // section can render (resetting alone would just re-throw the stale RSC).
        router.refresh();
        onReset();
      }}
    />
  );
}

class SectionErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[dashboard section]", error);
  }

  render() {
    if (this.state.hasError) {
      return <SectionFallback onReset={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}

/**
 * Wraps one dashboard section in its own error boundary + Suspense, so a single
 * section's data failure degrades only that card instead of the whole page.
 */
export function DashSection({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  return (
    <SectionErrorBoundary>
      <Suspense fallback={fallback}>{children}</Suspense>
    </SectionErrorBoundary>
  );
}
