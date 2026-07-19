"use client";

import { useEffect } from "react";
import { useTopbarControls } from "@/components/layout/topbar-context";
import type { PrivateCategory } from "@/lib/demo-mode";

export function TopbarTitleSync({
  title,
  subtitle,
  privateKind,
}: {
  title: string;
  subtitle?: string;
  privateKind?: PrivateCategory;
}) {
  const { setPageMeta } = useTopbarControls();

  useEffect(() => {
    setPageMeta({ title, subtitle, privateKind });
    return () => setPageMeta(null);
  }, [setPageMeta, subtitle, title, privateKind]);

  return null;
}
