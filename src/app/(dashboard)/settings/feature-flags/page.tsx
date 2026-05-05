// /settings/feature-flags — admin-only flag console.
// Permission gate: feature_flag.manage (seeded for owner + admin).

import { Flag } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listFlags, type FeatureFlag } from "@/lib/feature-flags";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { FlagRow } from "./flag-row";

async function loadRoles(orgId: string) {
  const { data } = await supabaseAdmin
    .from("roles")
    .select("key, name")
    .eq("organization_id", orgId)
    .order("key");
  return data ?? [];
}

export default async function FeatureFlagsPage() {
  const session = await requirePagePermission("feature_flag.manage");
  const t = await getTranslations("FeatureFlags");

  let flags: FeatureFlag[] = [];
  let loadError = false;
  try {
    flags = await listFlags();
  } catch (e) {
    console.error("[feature_flags_page_load_failed]", (e as Error).message);
    loadError = true;
  }
  const roles = await loadRoles(session.orgId);

  return (
    <div>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Flag className="size-3 text-cyan" />
            {t("flagsCount", { count: flags.length })}
          </Badge>
        }
      />

      {loadError ? (
        <ErrorState
          title={t("errorTitle")}
          description={t("errorDescription")}
        />
      ) : flags.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={<Flag className="size-6" />}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4">
          {flags.map((flag) => (
            <FlagRow key={flag.key} flag={flag} allRoles={roles} />
          ))}
        </div>
      )}
    </div>
  );
}
