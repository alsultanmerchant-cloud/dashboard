"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AppNotification } from "@/types";
import { Button } from "@/components/ui/button";
import { X, CheckCheck, ArrowLeft } from "lucide-react";
import { notificationHref } from "@/lib/notifications/registry";
import { markNotificationReadAction } from "@/app/(dashboard)/notifications/_actions";

interface NotificationPanelProps {
  notifications: AppNotification[];
  onClose: () => void;
  onMarkAllRead: () => void;
}

// How many to show in the popover — the rest live on /notifications.
const PREVIEW_LIMIT = 8;

export function NotificationPanel({
  notifications,
  onClose,
  onMarkAllRead,
}: NotificationPanelProps) {
  const router = useRouter();
  const t = useTranslations("Notifications");
  const tCommon = useTranslations("Common");
  const panelRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const recent = notifications.slice(0, PREVIEW_LIMIT);
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Close on outside click / Escape. Clicks inside the bell root (the bell
  // button itself toggles) are ignored so reopening isn't double-handled.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest("[data-bell-root]")) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function timeAgo(timestamp: string): string {
    const diff = nowTs - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("now");
    if (minutes < 60) return t("minutesAgo", { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("hoursAgo", { n: hours });
    const days = Math.floor(hours / 24);
    return t("daysAgo", { n: days });
  }

  function handleClick(n: AppNotification) {
    if (!n.isRead) void markNotificationReadAction(n.id);
    const href = notificationHref({
      type: n.notifType,
      entityType: n.entityType,
      entityId: n.entityId,
    });
    onClose();
    if (href) router.push(href);
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-50 top-16 start-3 end-3 max-h-[70vh] bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 flex flex-col overflow-hidden animate-in slide-in-from-top-2 fade-in-0 duration-200 sm:absolute sm:top-[calc(100%+12px)] sm:start-auto sm:end-0 sm:w-96 sm:max-w-[calc(100vw-1.5rem)] sm:rtl:start-0 sm:rtl:end-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-foreground">{t("title")}</h3>
          {unreadCount > 0 && (
            <span className="bg-cc-red text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1 text-muted-foreground"
            onClick={onMarkAllRead}
            disabled={unreadCount === 0}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            {t("markAllRead")}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label={tCommon("close")}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {recent.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          recent.map((n) => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-start px-4 py-3 border-b border-border/50 hover:bg-soft-2 transition-colors ${
                !n.isRead ? "bg-cyan/[0.03]" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-base mt-0.5 shrink-0">{n.icon}</span>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-xs leading-relaxed ${n.isRead ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {n.title ?? n.message}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {timeAgo(n.timestamp)}
                  </p>
                </div>
                {!n.isRead && (
                  <span className="w-2 h-2 rounded-full bg-cyan shrink-0 mt-1.5" />
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* Footer — Show all */}
      <div className="px-4 py-2.5 border-t border-border">
        <Link
          href="/notifications"
          onClick={onClose}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-soft-2 py-2 text-xs font-medium text-cyan hover:bg-soft-1 transition-colors"
        >
          {t("showAll")}
          <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
        </Link>
      </div>
    </div>
  );
}
