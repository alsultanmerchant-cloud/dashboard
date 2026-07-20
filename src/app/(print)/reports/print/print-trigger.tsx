"use client";

import * as React from "react";
import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";

// Opens the browser print dialog. With ?auto=1 (the /reports button) it fires
// once on load — the user lands directly in the print/Save-as-PDF dialog.
export function PrintTrigger({ auto }: { auto: boolean }) {
  const t = useTranslations("ReportsPage");
  React.useEffect(() => {
    if (!auto) return;
    // Give fonts/layout a beat to settle before the dialog snapshots the page.
    const id = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(id);
  }, [auto]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print-hide mb-6 inline-flex items-center gap-2 rounded-xl bg-cyan px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-cyan/90"
    >
      <Printer className="size-4" />
      {t("print.button")}
    </button>
  );
}
