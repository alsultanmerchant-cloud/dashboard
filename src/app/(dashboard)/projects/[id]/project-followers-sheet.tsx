"use client";

// Body of the Followers StackedSheet on the project page. Loads followers
// on first mount and renders a tappable list with avatars + DM buttons.

import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { MessageButton } from "@/components/dm/message-button";

type Follower = {
  id: string;
  full_name: string;
  job_title: string | null;
  avatar_url: string | null;
};

export function ProjectFollowersSheetBody({ projectId }: { projectId: string }) {
  const t = useTranslations("ProjectDetailPage");
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/followers`, {
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { followers?: Follower[] };
      })
      .then((json) => {
        if (!alive) return;
        setFollowers(json.followers ?? []);
      })
      .catch((err) => {
        if (!alive) return;
        console.error("[project followers] load failed", err);
        setError(t("empty.followers"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("loading.followers")}
      </div>
    );
  }
  if (error) {
    return <div className="py-6 text-sm text-cc-red">{error}</div>;
  }
  if (followers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-soft px-3 py-10 text-center text-sm text-muted-foreground">
        <Users className="size-4 opacity-60" />
        <span>{t("empty.followers")}</span>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-soft/40 rounded-xl border border-border bg-card">
      {followers.map((f) => (
        <li
          key={f.id}
          className="flex items-center gap-3 px-3 py-2.5 text-sm"
        >
          {f.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={f.avatar_url}
              alt={f.full_name}
              className="size-9 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-cyan/20 text-xs font-semibold text-cyan">
              {f.full_name.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{f.full_name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {f.job_title ?? "—"}
            </p>
          </div>
          <MessageButton
            employeeId={f.id}
            employeeName={f.full_name}
            contextProjectId={projectId}
            size="xs"
          />
        </li>
      ))}
    </ul>
  );
}
