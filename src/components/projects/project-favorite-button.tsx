"use client";

import * as React from "react";
import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

const FAVORITE_EVENT = "project-favorite:changed";

type FavoriteChangeDetail = {
  projectKey: string;
  isFavorite: boolean;
};

function emitFavoriteChange(detail: FavoriteChangeDetail) {
  window.dispatchEvent(new CustomEvent<FavoriteChangeDetail>(FAVORITE_EVENT, { detail }));
}

function favoriteKey(projectId?: string, projectOdooId?: number) {
  if (projectId) return `id:${projectId}`;
  if (typeof projectOdooId === "number") return `odoo:${projectOdooId}`;
  return null;
}

function favoriteUrl(projectId?: string, projectOdooId?: number) {
  if (projectId) return `/api/projects/${projectId}/favorite`;
  if (typeof projectOdooId === "number") return `/api/projects/by-odoo/${projectOdooId}/favorite`;
  throw new Error("favorite_target_missing");
}

async function requestFavorite(
  method: "GET" | "POST",
  target: { projectId?: string; projectOdooId?: number },
  isFavorite?: boolean,
) {
  const res = await fetch(favoriteUrl(target.projectId, target.projectOdooId), {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify({ isFavorite }) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`favorite_request_failed:${res.status}`);
  }
  return (await res.json()) as { isFavorite: boolean };
}

export function ProjectFavoriteButton({
  projectId,
  projectOdooId,
  initialFavorite,
  className,
  iconClassName,
  activeClassName,
  inactiveClassName,
  disabled = false,
  size = "md",
}: {
  projectId?: string;
  projectOdooId?: number;
  initialFavorite?: boolean;
  className?: string;
  iconClassName?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const projectKey = favoriteKey(projectId, projectOdooId);
  const [isFavorite, setIsFavorite] = React.useState(Boolean(initialFavorite));
  const [isReady, setIsReady] = React.useState(typeof initialFavorite === "boolean");
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (typeof initialFavorite === "boolean") {
      setIsFavorite(initialFavorite);
      setIsReady(true);
    }
  }, [initialFavorite]);

  React.useEffect(() => {
    if (typeof initialFavorite === "boolean") return;
    let cancelled = false;
    requestFavorite("GET", { projectId, projectOdooId })
      .then((data) => {
        if (cancelled) return;
        setIsFavorite(Boolean(data.isFavorite));
        setIsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setIsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, projectOdooId, initialFavorite]);

  React.useEffect(() => {
    function onFavoriteChange(event: Event) {
      const detail = (event as CustomEvent<FavoriteChangeDetail>).detail;
      if (!detail || detail.projectKey !== projectKey) return;
      setIsFavorite(detail.isFavorite);
      setIsReady(true);
    }
    window.addEventListener(FAVORITE_EVENT, onFavoriteChange);
    return () => window.removeEventListener(FAVORITE_EVENT, onFavoriteChange);
  }, [projectKey]);

  const isDisabled = disabled || !projectKey || !isReady || isPending;

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
      title={isFavorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
      className={cn(
        "rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "p-0.5" : "p-1",
        isFavorite
          ? activeClassName ?? "text-amber-500 hover:text-amber-600"
          : inactiveClassName ?? "text-muted-foreground hover:text-amber-500",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        const nextFavorite = !isFavorite;
        setIsFavorite(nextFavorite);
        emitFavoriteChange({ projectKey: projectKey!, isFavorite: nextFavorite });
        startTransition(async () => {
          try {
            const data = await requestFavorite("POST", { projectId, projectOdooId }, nextFavorite);
            setIsFavorite(Boolean(data.isFavorite));
            emitFavoriteChange({ projectKey: projectKey!, isFavorite: Boolean(data.isFavorite) });
          } catch {
            setIsFavorite(!nextFavorite);
            emitFavoriteChange({ projectKey: projectKey!, isFavorite: !nextFavorite });
          }
        });
      }}
    >
      <Star
        className={cn(
          size === "sm" ? "size-4" : "size-5",
          isFavorite && "fill-amber-400",
          iconClassName,
        )}
      />
    </button>
  );
}
