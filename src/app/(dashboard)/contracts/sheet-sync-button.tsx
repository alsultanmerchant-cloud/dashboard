"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  syncGoogleSheetAction,
  type GoogleSheetSyncState,
} from "./import/_actions";
import { formatMonthYear } from "@/lib/utils-format";

// Live "pull fresh data from the Google Sheet" button shown on the CEO dashboard.
// One click re-reads the real sheet (contracts + installments + logs) AND the
// sheet's own computed CEO/target tabs, freezing them under the month the sheet
// is currently showing. Older months stay untouched.
export function SheetSyncButton({
  lastSyncedLabel,
}: {
  // Pre-formatted "last pulled from sheet" timestamp (server-formatted in the
  // org timezone so there's no client hydration mismatch). Null = never synced.
  lastSyncedLabel?: string | null;
}) {
  const router = useRouter();
  const locale = useLocale();
  const ar = locale.startsWith("ar");
  const [state, action, pending] = useActionState<
    GoogleSheetSyncState | undefined,
    FormData
  >(syncGoogleSheetAction, undefined);
  const handled = useRef<GoogleSheetSyncState | undefined>(undefined);

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.kind === "error") {
      toast.error(state.error);
      return;
    }
    if (state.kind === "ok") {
      const monthLabel = state.dashboardMonth
        ? formatMonthYear(state.dashboardMonth, locale)
        : null;
      if (state.dashboardMonth) {
        toast.success(
          ar
            ? `تم سحب بيانات الشيت لشهر ${monthLabel}: ${state.contractsUpserted} عقد، ${state.dashboardOnTarget ?? 0} عميل ضمن الهدف.`
            : `Pulled ${monthLabel} from the sheet: ${state.contractsUpserted} contracts, ${state.dashboardOnTarget ?? 0} on-target clients.`,
        );
      } else {
        toast.success(
          ar
            ? `تم سحب ${state.contractsUpserted} عقد من الشيت.`
            : `Pulled ${state.contractsUpserted} contracts from the sheet.`,
        );
        toast.warning(
          ar
            ? "تعذّر قراءة شهر لوحة الرئيس من الشيت."
            : "Could not read the dashboard month from the sheet.",
        );
      }
      if (state.warnings.length > 0) {
        toast.warning(
          ar
            ? `${state.warnings.length} تنبيه أثناء المزامنة.`
            : `${state.warnings.length} warning(s) during sync.`,
        );
      }
      router.refresh();
    }
  }, [state, ar, locale, router]);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action}>
        <Button type="submit" disabled={pending} size="sm" className="gap-1.5">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {ar ? "سحب بيانات الشيت" : "Pull from Sheet"}
        </Button>
      </form>
      <span className="text-[10px] leading-none text-muted-foreground">
        {lastSyncedLabel
          ? ar
            ? `آخر سحب: ${lastSyncedLabel}`
            : `Last synced: ${lastSyncedLabel}`
          : ar
            ? "لم تتم المزامنة بعد"
            : "Never synced"}
      </span>
    </div>
  );
}
