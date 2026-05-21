"use client";

// Odoo-style right rail (§NAV-4). Vertical strip pinned to the right edge of
// the viewport with the same icon order as Rwasem's chrome: Bookmark Panel,
// Magnifier, Search, Fullscreen, Add Bookmark. Star/Bookmark actions are
// placeholders today — they prime muscle memory so a Rwasem operator
// recognises the affordance before the underlying behaviours land.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Bookmark,
  BookmarkPlus,
  Maximize2,
  Minimize2,
  Search,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

function dispatchCommandPalette() {
  // Matches the event name CommandPaletteProvider already listens on
  // (src/components/command-palette.tsx).
  window.dispatchEvent(new CustomEvent("command-palette:open"));
}

export function RightRail() {
  const t = useTranslations("RightRail");
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  }, []);

  const iconCls =
    "grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <aside
      aria-label={t("label")}
      className="pointer-events-none fixed end-2 top-1/2 z-30 hidden -translate-y-1/2 lg:block"
    >
      <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <button
          type="button"
          aria-label={t("bookmarkPanel")}
          title={t("bookmarkPanel")}
          className={iconCls}
          disabled
        >
          <Bookmark className="size-4" />
        </button>
        <Link
          href="/projects?onlyFavorites=1"
          aria-label={t("favorite")}
          title={t("favorite")}
          className={iconCls}
        >
          <Star className="size-4" />
        </Link>
        <button
          type="button"
          aria-label={t("search")}
          title={t("search")}
          className={iconCls}
          onClick={dispatchCommandPalette}
        >
          <Search className="size-4" />
        </button>
        <button
          type="button"
          aria-label={isFullscreen ? t("exitFullscreen") : t("enterFullscreen")}
          title={isFullscreen ? t("exitFullscreen") : t("enterFullscreen")}
          className={cn(iconCls, isFullscreen && "text-primary")}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        <button
          type="button"
          aria-label={t("addBookmark")}
          title={t("addBookmark")}
          className={iconCls}
          disabled
        >
          <BookmarkPlus className="size-4" />
        </button>
      </div>
    </aside>
  );
}
