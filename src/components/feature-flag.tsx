// <FeatureFlag flag="..." fallback={...}> — server-component gate.
//
// Usage:
//   <FeatureFlag flag="sales_track_enabled">
//     <SalesNav />
//   </FeatureFlag>
//
// With fallback:
//   <FeatureFlag flag="whatsapp_enabled" fallback={<ComingSoon />}>
//     <WhatsAppOutbox />
//   </FeatureFlag>
//
// Resolves the current session via getServerSession() so callers don't
// have to thread the user manually. If the flag is off, renders `fallback`
// (defaults to null).

import "server-only";
import * as React from "react";
import { isFlagOn } from "@/lib/feature-flags";
import { getServerSession } from "@/lib/auth-server";

type Props = {
  flag: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

export async function FeatureFlag({ flag, children, fallback = null }: Props) {
  const session = await getServerSession();
  const on = await isFlagOn(flag, session);
  return <>{on ? children : fallback}</>;
}
