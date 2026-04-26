import { Settings, Building2, User, Globe, Shield, Sparkles } from "lucide-react";
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
        title="الإعدادات"
        description="إعدادات الوكالة والحساب الحالي. إعدادات متقدمة (تكاملات، إعدادات الذكاء الاصطناعي، قوالب التواصل) ستضاف لاحقًا."
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Sparkles className="size-3 text-cyan" />
            إعدادات موسّعة في مرحلة 9
          </Badge>
        }
      />

      <SectionTitle title="بيانات الوكالة" />
      <Card className="mb-8">
        <CardContent className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field icon={<Building2 className="size-4" />} label="الاسم" value={org?.name ?? "—"} />
            <Field icon={<Globe className="size-4" />} label="المعرّف" value={org?.slug ?? "—"} mono />
            <Field icon={<Globe className="size-4" />} label="اللغة الافتراضية" value={org?.default_locale === "ar" ? "العربية" : (org?.default_locale ?? "—")} />
            <Field icon={<Globe className="size-4" />} label="المنطقة الزمنية" value={org?.timezone ?? "—"} mono />
          </div>
        </CardContent>
      </Card>

      <SectionTitle
        title="مدير المشاريع العام"
        description="الشخص الذي يظهر كـ Project Manager على لوحات المشاريع. عادةً ثابت لجميع المشاريع."
      />
      <Card className="mb-8">
        <CardContent className="p-5">
          <ProjectManagerPicker current={currentPM} employees={employeeOptions} />
        </CardContent>
      </Card>

      <SectionTitle title="حسابك" />
      <Card className="mb-8">
        <CardContent className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field icon={<User className="size-4" />} label="الاسم" value={session.fullName} />
            <Field icon={<User className="size-4" />} label="البريد" value={session.email} mono />
            <Field
              icon={<Shield className="size-4" />}
              label="الأدوار"
              value={session.roleKeys.map((k) => ROLE_LABELS[k] ?? k).join(" · ") || "—"}
            />
            <Field
              icon={<Shield className="size-4" />}
              label="الصلاحيات"
              value={`${session.permissions.size} صلاحية ${ownerRole ? "(تجاوز كامل بصفة مالك)" : ""}`}
            />
          </div>
        </CardContent>
      </Card>

      <SectionTitle title="إعدادات قادمة" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: "تكاملات الواتساب", desc: "ربط رسائل العميل والإشعارات" },
          { label: "تكاملات البريد", desc: "إشعارات بريدية للموظفين" },
          { label: "قوالب التواصل", desc: "قوالب تعليقات وردود معتمدة" },
          { label: "إعدادات الذكاء الاصطناعي", desc: "اختيار النماذج وضبط الحدود" },
          { label: "النسخ الاحتياطي والتصدير", desc: "تصدير دوري لبيانات الوكالة" },
          { label: "إعدادات الأمان", desc: "MFA، انتهاء الجلسات، سجلات الدخول" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <Settings className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                <Badge variant="ghost" className="text-[10px]">قريبًا</Badge>
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
