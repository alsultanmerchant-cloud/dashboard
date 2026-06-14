"use client";

import { useTranslations } from "next-intl";
import { CircleDollarSign, Target, AlertTriangle, HandCoins } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClientFinanceBadge } from "@/lib/data/client-finance";

// =========================================================================
// The two client finance indicators the CEO wants beside EVERY client
// mention: target standing (On Target / Overdue / Sales Deposit, from the
// Acc-sheet contract) and overdue installments. Drop-in chip row — renders
// nothing when the client has no contract data, so it is safe everywhere.
// =========================================================================

export function ClientFinanceBadges({
  badge,
  size = "sm",
  className,
}: {
  badge: ClientFinanceBadge | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useTranslations("ClientFinance");
  if (!badge) return null;

  const chips: Array<{ key: string; label: string; icon: React.ReactNode; cls: string; title?: string }> = [];

  if (badge.targetStatus === "on_target") {
    chips.push({
      key: "target",
      label: t("onTarget"),
      icon: <Target className="size-3" />,
      cls: "bg-cc-green/10 text-cc-green border-cc-green/30",
    });
  } else if (badge.targetStatus === "overdue") {
    chips.push({
      key: "target",
      label: t("targetOverdue"),
      icon: <AlertTriangle className="size-3" />,
      cls: "bg-amber/10 text-amber border-amber/30",
    });
  } else if (badge.targetStatus === "sales_deposit") {
    chips.push({
      key: "target",
      label: t("salesDeposit"),
      icon: <HandCoins className="size-3" />,
      cls: "bg-cyan/10 text-cyan border-cyan/30",
    });
  }

  if (badge.overdueInstallments > 0) {
    chips.push({
      key: "overdue",
      label: t("overduePayment", { count: badge.overdueInstallments }),
      icon: <CircleDollarSign className="size-3" />,
      cls: "bg-cc-red/10 text-cc-red border-cc-red/30",
      title: t("overdueAmount", { amount: badge.overdueAmount.toLocaleString("en-US") }),
    });
  } else if (badge.paymentStatus === "complete") {
    chips.push({
      key: "paid",
      label: t("paidComplete"),
      icon: <CircleDollarSign className="size-3" />,
      cls: "bg-soft-2 text-muted-foreground border-border/60",
    });
  }

  if (chips.length === 0) return null;

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {chips.map((c) => (
        <span
          key={c.key}
          title={c.title}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
            size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
            c.cls,
          )}
        >
          {c.icon}
          {c.label}
        </span>
      ))}
    </span>
  );
}
