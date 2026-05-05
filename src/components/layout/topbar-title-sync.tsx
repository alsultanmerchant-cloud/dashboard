"use client";

import { useEffect } from "react";
import { useTopbarControls } from "@/components/layout/topbar-context";

export function TopbarTitleSync({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const { setPageMeta } = useTopbarControls();

  useEffect(() => {
    setPageMeta({ title, subtitle });
    return () => setPageMeta(null);
  }, [setPageMeta, subtitle, title]);

  return null;
}
