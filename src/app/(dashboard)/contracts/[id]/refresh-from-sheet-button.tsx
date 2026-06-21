"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncSingleContractAction } from "../import/_actions";

// Per-contract "refresh from the sheet" button on /contracts/[id]. Re-reads the
// workbook but commits ONLY this client's rows (and reruns the historical-cycle
// backfill for it) — a scoped alternative to the full CEO-dashboard sync.
// `clientExternalId` is the sheet ID like "C27", derived from the contract Key.
export function RefreshFromSheetButton({
  clientExternalId,
}: {
  clientExternalId: string;
}) {
  const router = useRouter();
  const locale = useLocale();
  const ar = locale.startsWith("ar");
  const [pending, startTransition] = useTransition();
  // Guard against double-submits while the server action is in flight.
  const [busy, setBusy] = useState(false);

  const onClick = () => {
    if (busy) return;
    setBusy(true);
    startTransition(async () => {
      try {
        const res = await syncSingleContractAction(clientExternalId);
        if (res.kind === "error") {
          toast.error(res.error);
          return;
        }
        toast.success(
          ar
            ? `تم تحديث ${res.contractsUpserted} عقد للعميل ${res.clientExternalId} من الشيت.`
            : `Refreshed ${res.contractsUpserted} contract(s) for ${res.clientExternalId} from the sheet.`,
        );
        if (res.warnings.length > 0) {
          toast.warning(
            ar
              ? `${res.warnings.length} تنبيه أثناء التحديث.`
              : `${res.warnings.length} warning(s) during refresh.`,
          );
        }
        router.refresh();
      } finally {
        setBusy(false);
      }
    });
  };

  const loading = pending || busy;
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={loading}
      size="sm"
      variant="outline"
      className="gap-1.5"
    >
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      {ar ? "تحديث من الشيت" : "Refresh from Sheet"}
    </Button>
  );
}
