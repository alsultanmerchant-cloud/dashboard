"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Kicks off (or re-runs) the period's report generation, then refreshes the
// server-rendered page so the frozen run renders. Generation takes ~20-60s
// (facts fan-out + four Gemini chapters), so the button self-disables and
// shows progress wording rather than a bare spinner.
export function GenerateReportButton({
  from,
  to,
  preset,
  hasRun,
}: {
  from: string;
  to: string;
  preset: string;
  hasRun: boolean;
}) {
  const t = useTranslations("ReportsPage");
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function generate() {
    setPending(true);
    try {
      const qs = new URLSearchParams({ from, to, preset });
      if (hasRun) qs.set("force", "1");
      const res = await fetch(`/api/executive-report?${qs.toString()}`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? t("generate.failed"));
      toast.success(t("generate.done"));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("generate.failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={generate}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
        hasRun
          ? "border border-soft bg-card text-foreground hover:bg-soft-1"
          : "bg-cyan text-background hover:bg-cyan/90",
        pending && "opacity-70",
      )}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {t("generate.pending")}
        </>
      ) : hasRun ? (
        <>
          <RefreshCw className="size-4" />
          {t("generate.regenerate")}
        </>
      ) : (
        <>
          <FileText className="size-4" />
          {t("generate.generate")}
        </>
      )}
    </button>
  );
}
