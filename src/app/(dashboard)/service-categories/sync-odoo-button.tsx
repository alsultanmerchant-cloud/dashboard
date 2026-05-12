"use client";

// "Sync from Odoo" — single-button server action wrapper. Owner clicks,
// importer runs (~14 services for Sky Light), toast summarizes the result.

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { syncOdooServicesAction } from "./_actions";

export function SyncOdooButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      const res = await syncOdooServicesAction();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const detail = `${res.servicesImported} خدمة · ${res.categoriesUpserted} تصنيف`;
      if (res.errors.length > 0) {
        toast.warning(`تمت المزامنة (${detail}) مع ${res.errors.length} خطأ`, {
          duration: 8000,
        });
      } else {
        toast.success(`تمت المزامنة من Odoo: ${detail}`);
      }
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      مزامنة من Odoo
    </Button>
  );
}
