"use client";

import { useState, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { cn } from "@/lib/utils";
import { submitHandoverAction, type HandoverFormState } from "./_actions";

type Service = { id: string; name: string; slug: string; description: string | null };
type Option = { id: string; label: string };

const URGENCY_OPTIONS: { value: "low" | "normal" | "high" | "critical"; label: string; tone: string }[] = [
  { value: "low", label: "منخفض", tone: "border-white/10 bg-white/[0.04] text-muted-foreground" },
  { value: "normal", label: "عادي", tone: "border-cc-blue/30 bg-blue-dim text-cc-blue" },
  { value: "high", label: "عالٍ", tone: "border-amber/30 bg-amber-dim text-amber" },
  { value: "critical", label: "حرج", tone: "border-cc-red/30 bg-red-dim text-cc-red" },
];

export function HandoverForm({
  services, accountManagers,
}: {
  services: Service[];
  accountManagers: Option[];
}) {
  const router = useRouter();
  const [urgency, setUrgency] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [serviceIds, setServiceIds] = useState<Set<string>>(new Set());
  const [state, formAction, pending] = useActionState<HandoverFormState | undefined, FormData>(
    submitHandoverAction,
    undefined,
  );
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (state?.ok) {
      toast.success(
        `تم إرسال التسليم — ${state.taskCount ?? 0} مهمة تم توليدها`,
        {
          description: "تم إنشاء المشروع وتنبيه مدير الحساب",
          duration: 5000,
        },
      );
      setUrgency("normal");
      setServiceIds(new Set());
      setResetKey((k) => k + 1);
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  const toggleService = (id: string) =>
    setServiceIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  return (
    <form action={formAction} className="space-y-6" key={resetKey}>
      {Array.from(serviceIds).map((id) => (
        <input key={id} type="hidden" name="selected_service_ids" value={id} />
      ))}
      <input type="hidden" name="urgency_level" value={urgency} />

      {/* Client info */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <SectionTitle title="بيانات العميل" description="من المعلومات الأساسية للوصل التجاري." />
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="h_client_name">اسم العميل / الشركة *</Label>
              <Input id="h_client_name" name="client_name" required placeholder="مثال: مطعم البندر" aria-invalid={!!state?.fieldErrors?.client_name} />
              {state?.fieldErrors?.client_name && (
                <p className="text-xs text-cc-red">{state.fieldErrors.client_name}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="h_contact_name">جهة الاتصال</Label>
              <Input id="h_contact_name" name="client_contact_name" placeholder="اسم المسؤول من جهة العميل" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="h_phone">الهاتف</Label>
              <Input id="h_phone" name="client_phone" placeholder="+966 5x xxx xxxx" dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="h_email">البريد الإلكتروني</Label>
              <Input id="h_email" name="client_email" type="email" placeholder="name@company.com" dir="ltr" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Services */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <SectionTitle
            title="الخدمات المتفق عليها"
            description="ستُنشأ مهام كل خدمة تلقائيًا من قالبها الافتراضي."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {services.map((s) => {
              const active = serviceIds.has(s.id);
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => toggleService(s.id)}
                  className={cn(
                    "rounded-2xl border p-4 text-start transition-all relative",
                    active
                      ? "border-cyan/40 bg-cyan-dim text-cyan shadow-[0_0_20px_rgba(0,212,255,0.12)]"
                      : "border-white/[0.06] bg-card text-muted-foreground hover:text-foreground hover:border-white/15",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold leading-tight">{s.name}</div>
                    {active && (
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-cyan text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <p className="mt-1.5 text-[11px] leading-relaxed opacity-80">{s.description}</p>
                  )}
                </button>
              );
            })}
          </div>
          {state?.fieldErrors?.selected_service_ids && (
            <p className="text-xs text-cc-red">{state.fieldErrors.selected_service_ids}</p>
          )}
        </CardContent>
      </Card>

      {/* Project + Urgency + AM */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <SectionTitle title="تفاصيل التسليم" />
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="h_start_date">تاريخ بدء المشروع</Label>
              <Input id="h_start_date" name="project_start_date" type="date" dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="h_am">مدير الحساب</Label>
              <select
                id="h_am"
                name="assigned_account_manager_employee_id"
                defaultValue=""
                className="flex h-10 w-full rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">اختر من الفريق</option>
                {accountManagers.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>مستوى العاجلية</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {URGENCY_OPTIONS.map((u) => {
                const active = urgency === u.value;
                return (
                  <button
                    type="button"
                    key={u.value}
                    onClick={() => setUrgency(u.value)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
                      active ? u.tone : "border-white/[0.06] bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {u.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="h_package">تفاصيل الباقة</Label>
            <Textarea id="h_package" name="package_details" rows={2} placeholder="ما الذي تم الاتفاق عليه مع العميل؟" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="h_notes">ملاحظات المبيعات</Label>
            <Textarea id="h_notes" name="sales_notes" rows={3} placeholder="أي ملاحظات تساعد مدير الحساب في البدء…" />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-cyan/15 bg-cyan-dim/30 p-4">
        <div className="flex items-center gap-2.5 text-xs text-cyan">
          <Sparkles className="size-4" />
          <span>عند الإرسال: سيُنشأ ملف العميل · يُولَّد المشروع · تُولَّد المهام · يُنبَّه مدير الحساب · يُسجَّل حدث ذكي</span>
        </div>
        <Button type="submit" disabled={pending || serviceIds.size === 0}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          إرسال التسليم
        </Button>
      </div>
    </form>
  );
}
