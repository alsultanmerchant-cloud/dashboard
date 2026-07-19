"use client";

// Settings control for demo mode. Preference is per-browser (localStorage),
// not per-org — turning it on is a local presentation choice and must never
// blur data for other users of the dashboard.

import { EyeOff, Banknote, Building2, Users, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Kbd } from "@/components/kbd";
import { useDemoMode, PRIVATE_CATEGORIES, type PrivateCategory } from "@/lib/demo-mode";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<PrivateCategory, React.ElementType> = {
  client: Building2,
  money: Banknote,
  person: Users,
  chat: MessageSquare,
};

export function DemoModeCard() {
  const t = useTranslations("DemoMode");
  const {
    enabled,
    categories,
    revealOnHover,
    setEnabled,
    setCategory,
    setRevealOnHover,
  } = useDemoMode();

  return (
    <Card className="mb-8">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              <EyeOff className="size-4 text-cyan" />
              {t("toggleTitle")}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("toggleDescription")}
            </p>
          </div>
          <DemoSwitch checked={enabled} onCheckedChange={setEnabled} label={t("toggleTitle")} />
        </div>

        <div
          className={cn(
            "mt-4 space-y-2 border-t border-soft pt-4 transition-opacity",
            enabled ? "opacity-100" : "pointer-events-none opacity-40",
          )}
        >
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("categoriesTitle")}
          </p>
          {PRIVATE_CATEGORIES.map((category) => {
            const Icon = CATEGORY_ICONS[category];
            return (
              <label
                key={category}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:bg-muted/40"
              >
                <span className="flex items-center gap-3">
                  <Icon className="size-4 text-muted-foreground" />
                  <span>
                    <span className="block text-sm font-medium">
                      {t(`categories.${category}.label`)}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {t(`categories.${category}.description`)}
                    </span>
                  </span>
                </span>
                <DemoSwitch
                  checked={categories.includes(category)}
                  disabled={!enabled}
                  onCheckedChange={(next) => setCategory(category, next)}
                  label={t(`categories.${category}.label`)}
                />
              </label>
            );
          })}

          <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:bg-muted/40">
            <span>
              <span className="block text-sm font-medium">{t("revealTitle")}</span>
              <span className="block text-[11px] text-muted-foreground">
                {t("revealDescription")}
              </span>
            </span>
            <DemoSwitch
              checked={revealOnHover}
              disabled={!enabled}
              onCheckedChange={setRevealOnHover}
              label={t("revealTitle")}
            />
          </label>
        </div>

        <p className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-soft pt-3 text-[11px] text-muted-foreground">
          {t("shortcutHint")}
          <Kbd>⌘</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>B</Kbd>
        </p>
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          {t("securityNote")}
        </p>
      </CardContent>
    </Card>
  );
}

function DemoSwitch({
  checked,
  disabled,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-[background-color,box-shadow]",
        "ring-1 ring-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "justify-end bg-cc-green/80" : "justify-start bg-soft-3/90",
      )}
    >
      <span
        className={cn(
          "block size-5 rounded-full bg-white/95 shadow-[0_1px_3px_rgba(15,23,42,0.28)] transition-transform",
          checked ? "scale-100" : "scale-95",
        )}
      />
    </button>
  );
}
