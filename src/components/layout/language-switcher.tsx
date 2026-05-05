"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { setLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/config";

interface LanguageSwitcherProps {
  /** When false, only the icon button is shown (collapsed sidebar). */
  showLabel?: boolean;
  className?: string;
}

export function LanguageSwitcher({ showLabel = true, className }: LanguageSwitcherProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("Common");
  const [pending, startTransition] = useTransition();

  const next: Locale = locale === "ar" ? "en" : "ar";
  const tooltip = next === "en" ? t("switchToEnglish") : t("switchToArabic");
  // Show the *target* language label so the affordance reads as "tap to switch to X".
  const label = next === "en" ? "English" : "العربية";

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startTransition(async () => {
      await setLocale(next);
    });
  };

  return (
    <button
      onClick={onClick}
      disabled={pending}
      aria-label={tooltip}
      title={tooltip}
      className={cn(
        "flex items-center gap-2 rounded-lg bg-sidebar-accent hover:bg-sidebar-primary/15 text-sidebar-foreground/80 hover:text-sidebar-foreground transition-all duration-200 disabled:opacity-50",
        showLabel ? "px-2 py-1.5 text-[11px] font-medium" : "w-7 h-7 justify-center",
        className,
      )}
    >
      <Languages className="w-3.5 h-3.5 shrink-0" />
      {showLabel && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}
