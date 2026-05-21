"use client";

import { useEffect } from "react";
import { useTopbarControls } from "@/components/layout/topbar-context";

type Props = {
  trailingText: string | null;
  isBusy?: boolean;
  pills: {
    label: string;
    href?: string;
    active?: boolean;
    count?: number | null;
    title?: string;
  }[];
};

export function TasksModuleTabsMeta({
  trailingText,
  isBusy = false,
  pills,
}: Props) {
  const { setModuleTabsMeta } = useTopbarControls();

  useEffect(() => {
    setModuleTabsMeta({
      trailingText: trailingText ?? undefined,
      isBusy,
      pills,
    });
    return () => setModuleTabsMeta(null);
  }, [isBusy, pills, setModuleTabsMeta, trailingText]);

  return null;
}
