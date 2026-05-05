"use client";

import * as React from "react";
import { ChevronLeft, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";

export function ComingSoonPage({
  title,
  description,
  phase,
  icon,
  bullets,
}: {
  title: string;
  description?: string;
  phase: number;
  icon?: React.ReactNode;
  bullets?: string[];
}) {
  const t = useTranslations("ComingSoon");
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Sparkles className="size-3 text-cyan" />
            {t("phaseLabel", { phase })}
          </Badge>
        }
      />
      <EmptyState
        icon={icon ?? <Sparkles className="size-6" />}
        title={t("title")}
        description={t("description")}
      />
      {bullets && bullets.length > 0 && (
        <div className="mt-6 rounded-2xl border border-cyan/15 bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ChevronLeft className="size-4 text-cyan icon-flip-rtl" />
            {t("bulletsTitle")}
          </h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-cyan" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
