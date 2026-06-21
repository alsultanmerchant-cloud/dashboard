"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

// Calendar topbar button: goes directly to /my-activities (no popup)
export function TopbarCalendarPopover({ className }: { className?: string }) {
  return (
    <Link
      href="/my-activities"
      className={cn(
        "inline-flex size-9 items-center justify-center transition-colors",
        className,
      )}
      aria-label="الأنشطة المجدولة"
      title="جدول الأنشطة"
      prefetch={false}
    >
      <CalendarDays className="size-4 text-white/90 dark:text-muted-foreground" />
      <span className="sr-only">الأنشطة المجدولة</span>
    </Link>
  );
}
