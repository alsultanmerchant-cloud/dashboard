import { Settings, Building2, User, Globe, Shield, Sparkles, CalendarOff, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listEmployees } from "@/lib/data/employees";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/labels";
import { ProjectManagerPicker } from "./project-manager-picker";

async function getOrgInfo(orgId: string) {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("id, name, slug, default_locale, timezone, created_at, project_manager_employee_id")
    .eq("id", orgId)
    .maybeSingle();
  return data;
}

export default async function SettingsPage() {
  const session = await requirePagePermission("settings.manage");
  const t = await getTranslations("SettingsPage");
  const tRoles = await getTranslations("RoleLabels");
  const [org, employees] = await Promise.all([
    getOrgInfo(session.orgId),
    listEmployees(session.orgId),
  ]);
  const ownerRole = session.roleKeys.includes("owner");

  const employeeOptions = employees
    .filter((e) => e.employment_status === "active")
    .map((e) => ({
      id: e.id,
      full_name: e.full_name,
      job_title: e.job_title ?? null,
    }));
  const currentPM =
    employeeOptions.find((e) => e.id === org?.project_manager_employee_id) ?? null;

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Sparkles className="size-3 text-cyan" />
            {t("phaseBadge")}
          </Badge>
        }
      />

      <SectionTitle title={t("agencyInfo.title")} />
      <Card className="mb-8">
        <CardContent className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field icon={<Building2 className="size-4" />} label={t("agencyInfo.name")} value={org?.name ?? "—"} />
            <Field icon={<Globe className="size-4" />} label={t("agencyInfo.slug")} value={org?.slug ?? "—"} mono />
            <Field
              icon={<Globe className="size-4" />}
              label={t("agencyInfo.defaultLocale")}
              value={org?.default_locale === "ar" ? t("locales.ar") : org?.default_locale === "en" ? t("locales.en") : (org?.default_locale ?? "—")}
            />
            <Field icon={<Globe className="size-4" />} label={t("agencyInfo.timezone")} value={org?.timezone ?? "—"} mono />
          </div>
        </CardContent>
      </Card>

      <SectionTitle
        title={t("projectManager.title")}
        description={t("projectManager.description")}
      />
      <Card className="mb-8">
        <CardContent className="p-5">
          <ProjectManagerPicker current={currentPM} employees={employeeOptions} />
        </CardContent>
      </Card>

      <SectionTitle title={t("workSchedule.title")} />
      <Card className="mb-8">
        <CardContent className="p-5">
          <Link
            href="/settings/holidays"
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-3 transition-colors hover:bg-muted/40"
          >
            <span className="flex items-center gap-3">
              <CalendarOff className="size-4 text-cyan" />
              <span>
                <span className="block text-sm font-medium">{t("workSchedule.holidaysTitle")}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t("workSchedule.holidaysDescription")}
                </span>
              </span>
            </span>
            <ChevronLeft className="size-4 text-muted-foreground icon-flip-rtl" />
          </Link>
        </CardContent>
      </Card>

      <SectionTitle title={t("ai.title")} />
      <Card className="mb-8">
        <CardContent className="p-5">
          <Link
            href="/settings/ai-knowledge"
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-3 transition-colors hover:bg-muted/40"
          >
            <span className="flex items-center gap-3">
              <Sparkles className="size-4 text-cyan" />
              <span>
                <span className="block text-sm font-medium">{t("ai.knowledgeTitle")}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t("ai.knowledgeDescription")}
                </span>
              </span>
            </span>
            <ChevronLeft className="size-4 text-muted-foreground icon-flip-rtl" />
          </Link>
        </CardContent>
      </Card>

      <SectionTitle title={t("account.title")} />
      <Card className="mb-8">
        <CardContent className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field icon={<User className="size-4" />} label={t("account.name")} value={session.fullName} />
            <Field icon={<User className="size-4" />} label={t("account.email")} value={session.email} mono />
            <Field
              icon={<Shield className="size-4" />}
              label={t("account.roles")}
              value={session.roleKeys.map((k) => tRoles.has(k) ? tRoles(k) : (ROLE_LABELS[k] ?? k)).join(" · ") || "—"}
            />
            <Field
              icon={<Shield className="size-4" />}
              label={t("account.permissions")}
              value={t("account.permissionsValue", {
                count: session.permissions.size,
                ownerSuffix: ownerRole ? ` ${t("account.ownerSuffix")}` : "",
              })}
            />
          </div>
        </CardContent>
      </Card>

      <SectionTitle title={t("upcoming.title")} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: t("upcoming.whatsapp"), desc: t("upcoming.whatsappDesc") },
          { label: t("upcoming.email"), desc: t("upcoming.emailDesc") },
          { label: t("upcoming.templates"), desc: t("upcoming.templatesDesc") },
          { label: t("upcoming.ai"), desc: t("upcoming.aiDesc") },
          { label: t("upcoming.backup"), desc: t("upcoming.backupDesc") },
          { label: t("upcoming.security"), desc: t("upcoming.securityDesc") },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <Settings className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                <Badge variant="ghost" className="text-[10px]">{t("soon")}</Badge>
              </div>
              <h3 className="mt-2 text-sm font-semibold">{s.label}</h3>
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{s.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Field({
  icon, label, value, mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={`mt-1 text-sm font-medium ${mono ? "font-mono" : ""}`} dir={mono ? "ltr" : undefined}>
        {value}
      </p>
    </div>
  );
}
