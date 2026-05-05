"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FilterBarProps {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  onClear?: () => void;
  hasActiveFilters?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function FilterBar({ search, onClear, hasActiveFilters, children, className }: FilterBarProps) {
  const tF = useTranslations("Forms");
  const tA = useTranslations("Actions");
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-soft bg-card/60 px-3 py-2.5",
        className,
      )}
    >
      {search && (
        <div className="relative min-w-0 flex-1 max-w-sm">
          <Search className="pointer-events-none absolute rtl:right-2.5 ltr:left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? tF("placeholderSearch")}
            className="rtl:pe-8 ltr:ps-8"
            type="search"
            inputMode="search"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {hasActiveFilters && onClear && (
        <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
          <X className="size-3.5" />
          {tA("clearFilters")}
        </Button>
      )}
    </div>
  );
}
