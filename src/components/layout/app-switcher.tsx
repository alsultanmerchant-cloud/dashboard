"use client";

// Odoo's 9-dot app switcher, top-left of the topbar. Today it holds the
// modules we actually have routes for; the rest are placeholders so the
// muscle memory is in place when we expand to a full Rwasem replacement.
// Keep the launcher discoverable for users coming from Odoo.

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Briefcase,
  CalendarDays,
  Grid3x3,
  Handshake,
  MessageCircle,
  Settings,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type AppLink = {
  labelKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const APPS: AppLink[] = [
  { labelKey: "project", href: "/projects", icon: Briefcase },
  { labelKey: "discuss", href: "/messages", icon: MessageCircle },
  { labelKey: "calendar", href: "/my-activities", icon: CalendarDays },
  { labelKey: "employees", href: "/organization/employees", icon: Users },
  { labelKey: "sales", href: "/handover", icon: Handshake },
  { labelKey: "settings", href: "/settings", icon: Settings },
];

export function AppSwitcher({ className }: { className?: string }) {
  const t = useTranslations("AppSwitcher");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("openLabel")}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-2xl border border-white/70 bg-white/95 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-md transition-colors hover:bg-white hover:text-primary dark:border-soft dark:bg-soft-2 dark:text-muted-foreground dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:bg-white/18 dark:hover:text-white",
          className,
        )}
      >
        <Grid3x3 className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-64 p-2">
        <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t("heading")}
        </p>
        <div className="grid grid-cols-3 gap-1">
          {APPS.map((app) => {
            const Icon = app.icon;
            return (
              <Link
                key={app.labelKey}
                href={app.href}
                className="group flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center text-[11px] font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15">
                  <Icon className="size-4" />
                </span>
                <span className="truncate w-full">{t(app.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
