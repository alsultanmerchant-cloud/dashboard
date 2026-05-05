"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, CalendarClock, Users, Eye, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { expandTemplates, type GeneratedTask, type TemplateInput } from "@/lib/projects/offsets";
import { createProjectAction, type ProjectFormState } from "../_actions";
import type { TemplateWithItems } from "@/lib/data/service-categories";

type Option = { id: string; label: string };

const SELECT_CLASS =
  "flex h-10 w-full rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type CategoryOpt = {
  id: string;
  key: string;
  name_ar: string;
  service_id: string | null;
  service_name: string | null;
};

type ServiceOpt = { id: string; name: string; slug: string };

type SplitState = Record<string, { week_split: boolean; weeks: number; category_id: string | null }>;

export function NewProjectForm({
  clients, services, accountManagers, categories, templates,
}: {
  clients: Option[];
  services: ServiceOpt[];
  accountManagers: Option[];
  categories: CategoryOpt[];
  templates: TemplateWithItems[];
}) {
  const router = useRouter();
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [splits, setSplits] = useState<SplitState>({});
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [generateTasks, setGenerateTasks] = useState(true);
  const [state, formAction, pending] = useActionState<ProjectFormState | undefined, FormData>(
    createProjectAction,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(`تم إنشاء المشروع${state.taskCount ? ` وتوليد ${state.taskCount} مهمة` : ""}`);
      router.push(state.projectId ? `/projects/${state.projectId}` : "/projects");
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  const toggleService = (id: string) =>
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSplits((s) => {
          const rest = { ...s };
          delete rest[id];
          return rest;
        });
      } else {
        next.add(id);
        // Default Social Media to a 3-week split per PDF §11.
        const svc = services.find((x) => x.id === id);
        const defaults = svc?.slug === "social-media-management"
          ? { week_split: true, weeks: 3, category_id: null }
          : { week_split: false, weeks: 0, category_id: null };
        setSplits((s) => ({ ...s, [id]: defaults }));
      }
      return next;
    });

  const updateSplit = (sid: string, patch: Partial<SplitState[string]>) => {
    setSplits((s) => ({ ...s, [sid]: { ...(s[sid] ?? { week_split: false, weeks: 0, category_id: null }), ...patch } }));
  };

  // Live preview: re-run the pure offset engine on every tick.
  const preview: GeneratedTask[] = useMemo(() => {
    if (selectedServices.size === 0 || !startDate) return [];
    const inputs = templates
      .filter((t) => selectedServices.has(t.service_id))
      .filter((t) => {
        const sel = splits[t.service_id];
        if (sel?.category_id && t.category_id && sel.category_id !== t.category_id) return false;
        return true;
      })
      .map<{ template: TemplateInput; projectStartDate: string; weekSplit: boolean; weeks: number | null }>((t) => {
        const sel = splits[t.service_id];
        return {
          template: {
            id: t.id,
            service_id: t.service_id,
            category_id: t.category_id,
            default_owner_position: t.default_owner_position,
            deadline_offset_days: t.deadline_offset_days,
            upload_offset_days: t.upload_offset_days,
            default_followers_positions: t.default_followers_positions,
            items: t.items,
          },
          projectStartDate: startDate,
          weekSplit: sel?.week_split ?? false,
          weeks: sel?.week_split ? sel.weeks : null,
        };
      });
    return expandTemplates(inputs);
  }, [selectedServices, splits, startDate, templates]);

  const splitsForForm = useMemo(() => {
    return Array.from(selectedServices).map((sid) => ({
      service_id: sid,
      week_split: splits[sid]?.week_split ?? false,
      weeks: splits[sid]?.week_split ? splits[sid].weeks : null,
      category_id: splits[sid]?.category_id ?? null,
    }));
  }, [selectedServices, splits]);

  return (
    <form action={formAction} className="grid gap-4 lg:grid-cols-2">
      {/* Left: form */}
      <div className="space-y-3">
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from(selectedServices).map((id) => (
              <input key={id} type="hidden" name="service_ids" value={id} />
            ))}
            <input
              type="hidden"
              name="service_week_splits"
              value={JSON.stringify(splitsForForm)}
            />
            <input type="hidden" name="generate_tasks" value={generateTasks ? "true" : "false"} />

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="proj_client">العميل *</Label>
                <select id="proj_client" name="client_id" required defaultValue="" className={SELECT_CLASS}>
                  <option value="" disabled>اختر العميل</option>
                  {clients.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                </select>
                {state?.fieldErrors?.client_id && (
                  <p className="text-xs text-cc-red">{state.fieldErrors.client_id}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">اسم المشروع *</Label>
                <Input id="name" name="name" required placeholder="مثال: حملة رمضان 1447" />
                {state?.fieldErrors?.name && (
                  <p className="text-xs text-cc-red">{state.fieldErrors.name}</p>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start_date">تاريخ البدء</Label>
                <Input
                  id="start_date" name="start_date" type="date" dir="ltr"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end_date">تاريخ الانتهاء</Label>
                <Input id="end_date" name="end_date" type="date" dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proj_priority">الأولوية</Label>
                <select id="proj_priority" name="priority" defaultValue="medium" className={SELECT_CLASS}>
                  <option value="low">منخفضة</option>
                  <option value="medium">متوسطة</option>
                  <option value="high">عالية</option>
                  <option value="urgent">عاجلة</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proj_am">مدير الحساب</Label>
              <select id="proj_am" name="account_manager_employee_id" defaultValue="" className={SELECT_CLASS}>
                <option value="">— اختياري — يمكن تعيينه لاحقًا</option>
                {accountManagers.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">وصف المشروع</Label>
              <Textarea id="description" name="description" rows={2} placeholder="ملخص قصير عن المشروع…" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="m-0">الخدمات المتفق عليها</Label>
              <span className="text-[11px] text-muted-foreground">
                {selectedServices.size} مختارة
              </span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {services.map((s) => {
                const active = selectedServices.has(s.id);
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => toggleService(s.id)}
                    className={cn(
                      "flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
                      active
                        ? "border-cyan/40 bg-cyan-dim text-cyan"
                        : "border-soft bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="text-start truncate">{s.name}</span>
                    {active && <Check className="size-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {Array.from(selectedServices).map((sid) => {
              const svc = services.find((x) => x.id === sid);
              const sel = splits[sid] ?? { week_split: false, weeks: 0, category_id: null };
              const cats = categories.filter((c) => c.service_id === sid);
              return (
                <div key={sid} className="rounded-lg border border-soft bg-card/40 p-3 text-xs space-y-2">
                  <div className="font-semibold">{svc?.name}</div>
                  {cats.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Label className="m-0 text-[11px] text-muted-foreground">التصنيف</Label>
                      <select
                        className={cn(SELECT_CLASS, "h-8 flex-1")}
                        value={sel.category_id ?? ""}
                        onChange={(e) => updateSplit(sid, { category_id: e.target.value || null })}
                      >
                        <option value="">— كل القوالب —</option>
                        {cats.map((c) => (
                          <option key={c.id} value={c.id}>{c.name_ar}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-foreground/90 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sel.week_split}
                      onChange={(e) => updateSplit(sid, { week_split: e.target.checked, weeks: e.target.checked ? Math.max(1, sel.weeks || 3) : 0 })}
                      className="size-3.5 accent-cyan"
                    />
                    تقسيم العمل عبر أسابيع
                  </label>
                  {sel.week_split && (
                    <div className="flex items-center gap-2">
                      <Label className="m-0 text-[11px] text-muted-foreground">عدد الأسابيع</Label>
                      <Input
                        type="number"
                        min={1}
                        max={12}
                        className="h-8 w-20"
                        value={sel.weeks || 0}
                        onChange={(e) => updateSplit(sid, { weeks: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <label className="flex items-center gap-2 rounded-xl border border-cyan/15 bg-cyan-dim/40 px-3 py-2.5 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={generateTasks}
            onChange={(e) => setGenerateTasks(e.target.checked)}
            className="size-3.5 accent-cyan"
          />
          توليد المهام تلقائيًا من قوالب الخدمات المحددة
        </label>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/projects")}>
            إلغاء
          </Button>
          <Button type="submit" disabled={pending || selectedServices.size === 0}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            إنشاء المشروع
          </Button>
        </div>
      </div>

      {/* Right: preview pane */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Eye className="size-4 text-cyan" />
            معاينة المهام التي ستُولَّد
            <span className="ms-auto text-[11px] text-muted-foreground tabular-nums">
              {preview.length} مهمة
            </span>
          </div>

          {selectedServices.size === 0 ? (
            <div className="rounded-lg border border-dashed border-soft-2 p-6 text-center text-xs text-muted-foreground">
              اختر خدمة واحدة على الأقل لعرض المهام المتوقعة.
            </div>
          ) : preview.length === 0 ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400 flex items-start gap-2">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <div>
                لا توجد قوالب مطابقة. تحقق من تصنيفات الخدمات في
                <a href="/service-categories" className="underline px-1">إدارة التصنيفات</a>
                ثم أعد المحاولة.
              </div>
            </div>
          ) : (
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {preview.map((t, i) => (
                <li
                  key={`${t.templateItemId ?? "x"}-${i}`}
                  className="rounded-lg border border-soft bg-card/60 p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-medium leading-tight">{t.title}</div>
                    {t.weekIndex != null && (
                      <span className="rounded-full border border-cyan/30 bg-cyan-dim/40 px-1.5 py-0.5 text-[10px] text-cyan shrink-0">
                        أسبوع {t.weekIndex}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="size-3" />
                      الديدلاين <span className="tabular-nums" dir="ltr">{t.deadline}</span>
                    </span>
                    {t.uploadDue && (
                      <span className="inline-flex items-center gap-1">
                        رفع <span className="tabular-nums" dir="ltr">{t.uploadDue}</span>
                      </span>
                    )}
                    {t.defaultRoleKey && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" />
                        {t.defaultRoleKey}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
