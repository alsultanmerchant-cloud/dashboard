"use client";

import { useEffect, useMemo, useRef, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Check, CalendarClock, Users, Eye, AlertCircle,
  ChevronLeft, ChevronRight, User as UserIcon, Briefcase, ClipboardList,
  UserPlus, Plus, X, Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { AnchoredPopover } from "@/components/ui/anchored-popover";
import { cn } from "@/lib/utils";
import { expandTemplates, type GeneratedTask, type TemplateInput } from "@/lib/projects/offsets";
import { createProjectAction, createClientQuickAction, type ProjectFormState } from "../_actions";
import type { TemplateWithItems } from "@/lib/data/service-categories";

type WizardStep = 1 | 2 | 3;

const STEPS: { id: WizardStep; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 1, label: "العميل", icon: UserIcon },
  { id: 2, label: "الخدمات", icon: Briefcase },
  { id: 3, label: "الجدولة والمراجعة", icon: ClipboardList },
];

const SELECT_CLASS =
  "flex h-10 w-full rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type ClientOpt = { id: string; name: string; phone: string | null; email: string | null };
type EmployeeOpt = {
  id: string;
  full_name: string;
  job_title: string | null;
  department_name: string | null;
};
type AMOpt = { id: string; full_name: string; job_title: string | null };

type CategoryOpt = {
  id: string;
  key: string;
  name_ar: string;
  service_id: string | null;
  service_name: string | null;
};

type ServiceOpt = { id: string; name: string; slug: string };
type SplitState = Record<string, { week_split: boolean; weeks: number; category_id: string | null }>;

// Sky Light's standard agency packages (extracted from project-name conventions).
const PACKAGE_OPTIONS: SearchableOption[] = [
  { value: "نوفا", label: "نوفا (Nova)", hint: "السوشال + الميديا + السيو" },
  { value: "ذهبية", label: "ذهبية (Golden)", hint: "حزمة شاملة" },
  { value: "فضية", label: "فضية (Silver)", hint: "حزمة مبسّطة" },
  { value: "حملات إعلانية", label: "حملات إعلانية", hint: "ميديا فقط" },
  { value: "سوشيال ميديا", label: "سوشيال ميديا", hint: "إدارة منصات التواصل" },
  { value: "سيو", label: "سيو (SEO)", hint: "تحسين محركات البحث" },
  { value: "إنشاء + نوفا", label: "إنشاء + نوفا", hint: "إنشاء متجر + باقة نوفا" },
  { value: "خدمات جوجل", label: "خدمات جوجل", hint: "Google Ads + GMB" },
];

const DURATION_PRESETS: { value: string; label: string; days: number }[] = [
  { value: "15 يوم", label: "15 يوم", days: 15 },
  { value: "شهر", label: "شهر", days: 30 },
  { value: "شهرين", label: "شهرين", days: 60 },
  { value: "3 شهور", label: "3 شهور", days: 90 },
];

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function NewProjectForm({
  clients: initialClients, services, accountManagers, employees, categories, templates,
}: {
  clients: ClientOpt[];
  services: ServiceOpt[];
  accountManagers: AMOpt[];
  employees: EmployeeOpt[];
  categories: CategoryOpt[];
  templates: TemplateWithItems[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [splits, setSplits] = useState<SplitState>({});
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>("");
  const [activeDuration, setActiveDuration] = useState<string>("");
  const [generateTasks, setGenerateTasks] = useState(true);
  const [clients, setClients] = useState<ClientOpt[]>(initialClients);
  const [clientId, setClientId] = useState<string>("");
  const [name, setName] = useState<string>("");
  // Multi-select package names. Stored as a Set client-side, joined with
  // " + " when shipped to the server (kept as a single text column in DB).
  const [packageNames, setPackageNames] = useState<Set<string>>(new Set());
  const [packagePicking, setPackagePicking] = useState(false);
  const [packageQuery, setPackageQuery] = useState("");
  const [packageCustom, setPackageCustom] = useState("");
  const packageTriggerRef = useRef<HTMLSpanElement | null>(null);
  const packageInputRef = useRef<HTMLInputElement | null>(null);
  const togglePackage = (value: string) =>
    setPackageNames((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  const packageNamesJoined = useMemo(
    () => Array.from(packageNames).join(" + "),
    [packageNames],
  );
  const [accountManagerId, setAccountManagerId] = useState<string>("");
  const [socialId, setSocialId] = useState<string>("");
  const [mediaId, setMediaId] = useState<string>("");
  const [seoId, setSeoId] = useState<string>("");
  const [socialManagerId, setSocialManagerId] = useState<string>("");
  const [mediaManagerId, setMediaManagerId] = useState<string>("");
  const [seoManagerId, setSeoManagerId] = useState<string>("");
  const [followerIds, setFollowerIds] = useState<string[]>([]);
  const [constantAssigneeId, setConstantAssigneeId] = useState<string>("");
  const [showQuickClient, setShowQuickClient] = useState(false);
  const [quickClient, setQuickClient] = useState({ name: "", phone: "", email: "" });
  const [creatingClient, setCreatingClient] = useState(false);
  // Step 2 searchable services picker. Mirrors the project detail page
  // "إضافة باقة" UX (services-panel.tsx) so the multi-select pattern is
  // identical across project creation and edit-after-the-fact.
  const [picking, setPicking] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerActive, setPickerActive] = useState(0);
  const pickerTriggerRef = useRef<HTMLSpanElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [state, formAction, pending] = useActionState<ProjectFormState | undefined, FormData>(
    createProjectAction,
    undefined,
  );

  // Validation: each step must have its required fields filled.
  const validation = useMemo(() => {
    const issues: string[] = [];
    if (step >= 1) {
      if (!clientId) issues.push("اختر العميل");
      if (name.trim().length < 3) issues.push("اسم المشروع قصير جدًا (3 أحرف على الأقل)");
    }
    if (step >= 2) {
      if (selectedServices.size === 0) issues.push("اختر خدمة واحدة على الأقل");
    }
    if (step === 3) {
      if (!startDate) issues.push("اختر تاريخ البدء");
    }
    return issues;
  }, [step, clientId, name, selectedServices.size, startDate]);

  const canAdvance: Record<WizardStep, boolean> = {
    1: clientId.length > 0 && name.trim().length >= 3,
    2: selectedServices.size > 0,
    3: !!startDate,
  };

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

  const applyDuration = (value: string, days: number) => {
    setActiveDuration(value);
    if (startDate) setEndDate(addDaysIso(startDate, days));
  };

  // Re-apply active duration when start_date changes.
  useEffect(() => {
    if (!activeDuration || !startDate) return;
    const preset = DURATION_PRESETS.find((d) => d.value === activeDuration);
    if (preset) setEndDate(addDaysIso(startDate, preset.days));
  }, [startDate, activeDuration]);

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

  const selectedClient = clients.find((c) => c.id === clientId);

  // Available services filtered by search query, excluding already-selected
  // ones. Empty query returns everything not yet attached.
  const pickerCandidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return services
      .filter((s) => !selectedServices.has(s.id))
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q),
      );
  }, [services, selectedServices, pickerQuery]);

  useEffect(() => {
    setPickerActive((i) =>
      Math.min(Math.max(0, i), Math.max(0, pickerCandidates.length - 1)),
    );
  }, [pickerCandidates.length]);

  useEffect(() => {
    if (picking) pickerInputRef.current?.focus();
  }, [picking]);

  function pickerKeyDown(e: React.KeyboardEvent) {
    if (pickerCandidates.length === 0) {
      if (e.key === "Escape") {
        setPicking(false);
        setPickerQuery("");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPickerActive((i) => (i + 1) % pickerCandidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPickerActive(
        (i) => (i - 1 + pickerCandidates.length) % pickerCandidates.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = pickerCandidates[pickerActive];
      if (target) {
        toggleService(target.id);
        setPickerQuery("");
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPicking(false);
      setPickerQuery("");
    }
  }

  // Searchable-select options.
  const clientOptions: SearchableOption[] = clients.map((c) => ({
    value: c.id,
    label: c.name,
    hint: c.phone || c.email || null,
  }));
  const employeeOptionsAll: SearchableOption[] = employees.map((e) => ({
    value: e.id,
    label: e.full_name,
    hint: e.job_title || e.department_name || null,
  }));
  const amOptions: SearchableOption[] = accountManagers.map((a) => ({
    value: a.id,
    label: a.full_name,
    hint: a.job_title || null,
  }));

  const submitQuickClient = async () => {
    if (quickClient.name.trim().length < 2) {
      toast.error("اسم العميل قصير");
      return;
    }
    setCreatingClient(true);
    try {
      const res = await createClientQuickAction({
        name: quickClient.name.trim(),
        phone: quickClient.phone.trim() || undefined,
        email: quickClient.email.trim() || undefined,
      });
      if (res.ok) {
        toast.success("تم إضافة العميل");
        const fresh: ClientOpt = {
          id: res.client.id,
          name: res.client.name,
          phone: quickClient.phone || null,
          email: quickClient.email || null,
        };
        setClients((prev) => [fresh, ...prev]);
        setClientId(res.client.id);
        setShowQuickClient(false);
        setQuickClient({ name: "", phone: "", email: "" });
      } else {
        toast.error(res.error);
      }
    } finally {
      setCreatingClient(false);
    }
  };

  const submitProject = () => {
    if (pending || step !== 3 || selectedServices.size === 0 || validation.length > 0) return;
    const form = formRef.current;
    if (!form) return;
    formAction(new FormData(form));
  };

  return (
    <form
      ref={formRef}
      className="grid gap-4 lg:grid-cols-2"
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // Defensive: prevent any single-input Enter (project name, package
        // search, employee search, etc.) from submitting the wizard. The
        // ONLY way a project gets created is by clicking "إنشاء المشروع"
        // on Step 3. Submit-via-Enter is silently swallowed; the user has
        // to use the explicit button.
        if (
          e.key === "Enter" &&
          !(e.target instanceof HTMLTextAreaElement) &&
          !(e.target instanceof HTMLButtonElement && (e.target as HTMLButtonElement).type === "submit")
        ) {
          e.preventDefault();
        }
      }}
    >
      {/* Hidden form payload */}
      {Array.from(selectedServices).map((id) => (
        <input key={id} type="hidden" name="service_ids" value={id} />
      ))}
      <input type="hidden" name="service_week_splits" value={JSON.stringify(splitsForForm)} />
      <input type="hidden" name="generate_tasks" value={generateTasks ? "true" : "false"} />
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="package_name" value={packageNamesJoined} />
      <input type="hidden" name="duration_label" value={activeDuration} />
      <input type="hidden" name="account_manager_employee_id" value={accountManagerId} />
      <input type="hidden" name="social_specialist_id" value={socialId} />
      <input type="hidden" name="media_specialist_id" value={mediaId} />
      <input type="hidden" name="seo_specialist_id" value={seoId} />
      <input type="hidden" name="social_manager_id" value={socialManagerId} />
      <input type="hidden" name="media_manager_id" value={mediaManagerId} />
      <input type="hidden" name="seo_manager_id" value={seoManagerId} />
      <input type="hidden" name="constant_assignee_employee_id" value={constantAssigneeId} />
      {followerIds.map((id) => (
        <input key={id} type="hidden" name="follower_employee_ids" value={id} />
      ))}

      <div className="space-y-3">
        <Card>
          <CardContent className="flex items-stretch gap-1 p-2">
            {STEPS.map((s, i) => {
              const active = step === s.id;
              const done = step > s.id;
              const Icon = s.icon;
              // #3 — gate jumps on EVERY prior step's canAdvance, not just
              // the immediate predecessor. Otherwise a partial state (e.g.
              // services pre-selected from a previous attempt) could let the
              // user click directly from step 1 to step 3, silently skipping
              // step 2 — which matches the team's "skipped 3 steps" report.
              const priorComplete = STEPS.slice(0, i).every(
                (prev) => canAdvance[prev.id],
              );
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (active) return;
                    if (s.id < step || priorComplete) setStep(s.id);
                  }}
                  disabled={!done && !active && !priorComplete}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded-md px-3 py-2 text-[12px] font-medium transition-colors",
                    active
                      ? "bg-primary/15 text-primary"
                      : done
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                        : "bg-muted/40 text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                      active && "bg-primary text-primary-foreground",
                      done && "bg-emerald-500 text-white",
                      !active && !done && "bg-muted-foreground/30 text-foreground/70",
                    )}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* STEP 1 — Client (searchable + quick-add) */}
        <div className={cn(step === 1 ? "block" : "hidden")}>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>العميل *</Label>
                  <button
                    type="button"
                    onClick={() => setShowQuickClient((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-cyan transition-colors hover:bg-cyan-dim/40"
                  >
                    <UserPlus className="size-3.5" />
                    {showQuickClient ? "إخفاء" : "إضافة عميل جديد"}
                  </button>
                </div>
                <SearchableSelect
                  value={clientId}
                  onValueChange={setClientId}
                  options={clientOptions}
                  placeholder="اختر العميل"
                  searchPlaceholder="ابحث بالاسم أو الهاتف…"
                  required
                  onCreateNew={(q) => {
                    setShowQuickClient(true);
                    setQuickClient((p) => ({ ...p, name: q || p.name }));
                  }}
                  createLabel="إضافة عميل جديد"
                />
                {state?.fieldErrors?.client_id && (
                  <p className="text-xs text-cc-red">{state.fieldErrors.client_id}</p>
                )}
              </div>

              {showQuickClient && (
                <div className="rounded-lg border border-cyan/30 bg-cyan-dim/30 p-3 space-y-2">
                  <div className="text-[11px] font-semibold text-cyan">عميل جديد</div>
                  <Input
                    placeholder="اسم العميل *"
                    value={quickClient.name}
                    onChange={(e) => setQuickClient((p) => ({ ...p, name: e.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="هاتف"
                      value={quickClient.phone}
                      onChange={(e) => setQuickClient((p) => ({ ...p, phone: e.target.value }))}
                    />
                    <Input
                      placeholder="بريد"
                      type="email"
                      value={quickClient.email}
                      onChange={(e) => setQuickClient((p) => ({ ...p, email: e.target.value }))}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitQuickClient}
                      disabled={creatingClient || quickClient.name.trim().length < 2}
                    >
                      {creatingClient && <Loader2 className="size-3.5 animate-spin" />}
                      حفظ العميل
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowQuickClient(false)}
                    >
                      إلغاء
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="name">اسم المشروع *</Label>
                <Input
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: حملة رمضان 1447"
                />
                {/* `name` value is sent via the visible input */}
                <input type="hidden" name="name" value={name} />
                {state?.fieldErrors?.name && (
                  <p className="text-xs text-cc-red">{state.fieldErrors.name}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>الباقات</Label>
                {/* Multi-select: a project can combine packages
                    (Nova + Ads, Social + SEO, …). Selected names render
                    as removable chips; the "+ إضافة باقة" popover lists
                    PACKAGE_OPTIONS minus already-selected ones plus a
                    free-text fallback. Server stores them joined with
                    " + " in projects.package_name (no schema change). */}
                <div className="flex flex-wrap items-center gap-2">
                  {Array.from(packageNames).map((name) => {
                    const opt = PACKAGE_OPTIONS.find((o) => o.value === name);
                    return (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1.5 rounded-full border border-cyan/40 bg-cyan-dim px-2.5 py-1 text-xs font-medium text-cyan"
                      >
                        {opt?.label ?? name}
                        <button
                          type="button"
                          onClick={() => togglePackage(name)}
                          aria-label={`إزالة ${name}`}
                          className="rounded-full p-0.5 text-cyan/80 hover:bg-cyan/10 hover:text-cyan transition-colors"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    );
                  })}
                  <span ref={packageTriggerRef} className="inline-block">
                    <button
                      type="button"
                      onClick={() => setPackagePicking((v) => !v)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border border-dashed border-soft px-2.5 py-1 text-xs",
                        "text-muted-foreground hover:text-foreground hover:border-cyan/40 hover:bg-cyan-dim/30 transition-colors",
                      )}
                      aria-haspopup="listbox"
                      aria-expanded={packagePicking}
                    >
                      <Plus className="size-3" />
                      {packageNames.size === 0 ? "اختر باقة" : "إضافة باقة"}
                    </button>
                  </span>
                  <AnchoredPopover
                    anchorRef={packageTriggerRef}
                    open={packagePicking}
                    onClose={() => {
                      setPackagePicking(false);
                      setPackageQuery("");
                      setPackageCustom("");
                    }}
                    className="z-50 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-soft bg-card shadow-2xl shadow-black/30"
                  >
                    <div role="dialog" aria-label="اختر باقة">
                      <div className="flex items-center gap-2 border-b border-soft px-2.5 py-2">
                        <Search className="size-3.5 shrink-0 text-muted-foreground" />
                        <input
                          ref={packageInputRef}
                          value={packageQuery}
                          onChange={(e) => setPackageQuery(e.target.value)}
                          placeholder="ابحث في الباقات…"
                          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                          aria-label="بحث الباقات"
                        />
                      </div>
                      <ul
                        role="listbox"
                        aria-label="الباقات المتاحة"
                        className="max-h-64 overflow-y-auto py-1"
                      >
                        {(() => {
                          const q = packageQuery.trim().toLowerCase();
                          const available = PACKAGE_OPTIONS.filter(
                            (o) => !packageNames.has(o.value),
                          ).filter(
                            (o) =>
                              !q ||
                              o.label.toLowerCase().includes(q) ||
                              o.value.toLowerCase().includes(q) ||
                              (o.hint ?? "").toLowerCase().includes(q),
                          );
                          if (available.length === 0) {
                            return (
                              <li className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                                لا نتائج
                              </li>
                            );
                          }
                          return available.map((opt) => (
                            <li key={opt.value} role="option" aria-selected={false}>
                              <button
                                type="button"
                                onClick={() => {
                                  togglePackage(opt.value);
                                  setPackageQuery("");
                                }}
                                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-xs hover:bg-soft-2 transition-colors"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium">{opt.label}</div>
                                  {opt.hint && (
                                    <div className="truncate text-[10px] text-muted-foreground">
                                      {opt.hint}
                                    </div>
                                  )}
                                </div>
                                <Check className="size-3.5 shrink-0 opacity-0 group-hover:opacity-100" />
                              </button>
                            </li>
                          ));
                        })()}
                      </ul>
                      <div className="border-t border-soft p-2 space-y-1.5">
                        <input
                          type="text"
                          value={packageCustom}
                          onChange={(e) => setPackageCustom(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const v = packageCustom.trim();
                              if (v && !packageNames.has(v)) {
                                togglePackage(v);
                                setPackageCustom("");
                              }
                            }
                          }}
                          placeholder="باقة مخصصة (اختياري)…"
                          maxLength={80}
                          className="h-7 w-full rounded-md border border-soft bg-background px-2 text-[11px]"
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={
                              !packageCustom.trim() ||
                              packageNames.has(packageCustom.trim())
                            }
                            onClick={() => {
                              const v = packageCustom.trim();
                              if (v && !packageNames.has(v)) {
                                togglePackage(v);
                                setPackageCustom("");
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-md bg-cyan px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Plus className="size-3" />
                            إضافة نص حر
                          </button>
                        </div>
                      </div>
                    </div>
                  </AnchoredPopover>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  يمكنك اختيار أكثر من باقة — مثل «نوفا + حملات إعلانية».
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">وصف المشروع</Label>
                <Textarea id="description" name="description" rows={3} placeholder="ملخص قصير عن المشروع…" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* STEP 2 — Services (unchanged) */}
        <div className={cn(step === 2 ? "block" : "hidden")}>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <Label className="m-0">الخدمات (الباقات) المتفق عليها</Label>
                <span className="text-[11px] text-muted-foreground">
                  {selectedServices.size} مختارة من {services.length}
                </span>
              </div>

              {/* Chip strip of currently-selected services + searchable add
                  picker. Same pattern as services-panel.tsx on the project
                  detail page so the multi-select UX is identical end-to-end. */}
              <div className="flex flex-wrap items-center gap-2">
                {Array.from(selectedServices).map((sid) => {
                  const svc = services.find((x) => x.id === sid);
                  if (!svc) return null;
                  return (
                    <span
                      key={sid}
                      className="inline-flex items-center gap-1.5 rounded-full border border-cyan/40 bg-cyan-dim px-2.5 py-1 text-xs font-medium text-cyan"
                    >
                      {svc.name}
                      <button
                        type="button"
                        onClick={() => toggleService(sid)}
                        aria-label={`إزالة ${svc.name}`}
                        className="rounded-full p-0.5 text-cyan/80 hover:bg-cyan/10 hover:text-cyan transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  );
                })}

                <span ref={pickerTriggerRef} className="inline-block">
                  <button
                    type="button"
                    onClick={() => setPicking((v) => !v)}
                    disabled={pickerCandidates.length === 0 && pickerQuery === ""}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border border-dashed border-soft px-2.5 py-1 text-xs",
                      "text-muted-foreground hover:text-foreground hover:border-cyan/40 hover:bg-cyan-dim/30 transition-colors",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                    )}
                    aria-haspopup="dialog"
                    aria-expanded={picking}
                  >
                    <Plus className="size-3" />
                    إضافة باقة
                  </button>
                </span>

                <AnchoredPopover
                  anchorRef={pickerTriggerRef}
                  open={picking}
                  onClose={() => {
                    setPicking(false);
                    setPickerQuery("");
                  }}
                  className="z-50 w-72 max-w-[90vw] min-h-[14rem] overflow-hidden rounded-xl border border-soft bg-card shadow-2xl shadow-black/30"
                >
                  <div role="dialog" aria-label="اختر باقة">
                    <div className="flex items-center gap-2 border-b border-soft px-2.5 py-2">
                      <Search className="size-3.5 shrink-0 text-muted-foreground" />
                      <input
                        ref={pickerInputRef}
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                        onKeyDown={pickerKeyDown}
                        placeholder="ابحث عن باقة..."
                        className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                      />
                      {pickerQuery && (
                        <button
                          type="button"
                          onClick={() => setPickerQuery("")}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="مسح البحث"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                    <ul
                      role="listbox"
                      className="min-h-[10rem] max-h-64 overflow-y-auto py-1"
                    >
                      {pickerCandidates.length === 0 ? (
                        <li className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                          {selectedServices.size === services.length
                            ? "كل الباقات مضافة"
                            : "لا نتائج"}
                        </li>
                      ) : (
                        pickerCandidates.map((c, idx) => {
                          const isActive = idx === pickerActive;
                          return (
                            <li key={c.id} role="option" aria-selected={isActive}>
                              <button
                                type="button"
                                onMouseEnter={() => setPickerActive(idx)}
                                onClick={() => {
                                  toggleService(c.id);
                                  setPickerQuery("");
                                }}
                                className={cn(
                                  "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-start text-xs transition-colors",
                                  isActive
                                    ? "bg-cyan-dim/60 text-foreground"
                                    : "hover:bg-soft-2",
                                )}
                              >
                                <span className="truncate">{c.name}</span>
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                    <div className="border-t border-soft px-2.5 py-1.5 text-[10px] text-muted-foreground">
                      {pickerCandidates.length} متاح · {selectedServices.size}{" "}
                      مختارة
                    </div>
                  </div>
                </AnchoredPopover>
              </div>

              {selectedServices.size === 0 && (
                <p className="rounded-lg border border-dashed border-soft-2 bg-soft-1/40 px-3 py-3 text-center text-[11px] text-muted-foreground">
                  لم تُختَر باقات بعد. اضغط «إضافة باقة» لاختيار خدمة واحدة أو
                  أكثر.
                </p>
              )}

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
        </div>

        {/* STEP 3 — Schedule + ownership + followers + review */}
        <div className={cn(step === 3 ? "block space-y-3" : "hidden")}>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start_date">تاريخ البدء *</Label>
                  <Input
                    id="start_date" name="start_date" type="date" dir="ltr"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end_date">تاريخ الانتهاء</Label>
                  <Input
                    id="end_date" name="end_date" type="date" dir="ltr"
                    value={endDate}
                    onChange={(e) => { setEndDate(e.target.value); setActiveDuration(""); }}
                  />
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

              {/* Duration presets */}
              <div className="space-y-1.5">
                <Label className="m-0">المدة (تحدِّد تاريخ الانتهاء تلقائيًا)</Label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_PRESETS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => applyDuration(d.value, d.days)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        activeDuration === d.value
                          ? "border-cyan bg-cyan-dim text-cyan"
                          : "border-soft bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                  {activeDuration && (
                    <button
                      type="button"
                      onClick={() => { setActiveDuration(""); setEndDate(""); }}
                      className="rounded-full border border-soft px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      مسح
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>مدير الحساب</Label>
                <SearchableSelect
                  value={accountManagerId}
                  onValueChange={setAccountManagerId}
                  options={amOptions}
                  placeholder="— اختياري — يمكن تعيينه لاحقًا"
                  searchPlaceholder="ابحث بالاسم أو الوظيفة…"
                />
              </div>

              {/* Per-role team: each row pairs the specialist (المتخصص) with
                  the section head (مدير القسم) accountable for that specialty. */}
              <div className="space-y-3">
                <div className="rounded-xl border border-soft bg-soft-1/40 p-3">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-foreground">
                    <span className="grid size-5 place-items-center rounded-full bg-blue-400/20 text-blue-300">🔵</span>
                    قسم السوشال ميديا
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">المتخصص</Label>
                      <SearchableSelect
                        value={socialId}
                        onValueChange={setSocialId}
                        options={employeeOptionsAll}
                        placeholder="— اختر المتخصص —"
                        searchPlaceholder="ابحث في الموظفين…"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">مدير القسم (Team Lead)</Label>
                      <SearchableSelect
                        value={socialManagerId}
                        onValueChange={setSocialManagerId}
                        options={employeeOptionsAll}
                        placeholder="— اختر مدير القسم —"
                        searchPlaceholder="ابحث في الموظفين…"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-soft bg-soft-1/40 p-3">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-foreground">
                    <span className="grid size-5 place-items-center rounded-full bg-emerald-400/20 text-emerald-300">🟢</span>
                    قسم الميديا (الحملات الإعلانية)
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">المتخصص</Label>
                      <SearchableSelect
                        value={mediaId}
                        onValueChange={setMediaId}
                        options={employeeOptionsAll}
                        placeholder="— اختر المتخصص —"
                        searchPlaceholder="ابحث في الموظفين…"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">مدير القسم (Team Lead)</Label>
                      <SearchableSelect
                        value={mediaManagerId}
                        onValueChange={setMediaManagerId}
                        options={employeeOptionsAll}
                        placeholder="— اختر مدير القسم —"
                        searchPlaceholder="ابحث في الموظفين…"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-soft bg-soft-1/40 p-3">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-foreground">
                    <span className="grid size-5 place-items-center rounded-full bg-orange-400/20 text-orange-300">🟠</span>
                    قسم السيو (SEO)
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">المتخصص</Label>
                      <SearchableSelect
                        value={seoId}
                        onValueChange={setSeoId}
                        options={employeeOptionsAll}
                        placeholder="— اختر المتخصص —"
                        searchPlaceholder="ابحث في الموظفين…"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">مدير القسم (Team Lead)</Label>
                      <SearchableSelect
                        value={seoManagerId}
                        onValueChange={setSeoManagerId}
                        options={employeeOptionsAll}
                        placeholder="— اختر مدير القسم —"
                        searchPlaceholder="ابحث في الموظفين…"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>متابعون (يستلمون التنبيهات)</Label>
                <SearchableSelect
                  multi
                  value={followerIds}
                  onValueChange={setFollowerIds}
                  options={employeeOptionsAll}
                  placeholder="إضافة متابعين"
                  searchPlaceholder="ابحث في الموظفين…"
                />
              </div>

              <div className="space-y-1.5">
                <Label>منفِّذ ثابت لكل قوالب المهام</Label>
                <SearchableSelect
                  value={constantAssigneeId}
                  onValueChange={setConstantAssigneeId}
                  options={employeeOptionsAll}
                  placeholder="— اختياري — يُضاف منفِّذًا لكل المهام المُولَّدة"
                  searchPlaceholder="ابحث…"
                />
                <p className="text-[10px] text-muted-foreground">
                  عند الاختيار، يضاف هذا الموظف كمنفِّذ لكل المهام التي تُولَّد من القوالب.
                </p>
              </div>

              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-cyan/15 bg-cyan-dim/40 px-3 py-2.5 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={generateTasks}
                  onChange={(e) => setGenerateTasks(e.target.checked)}
                  className="size-3.5 accent-cyan"
                />
                توليد المهام تلقائيًا من قوالب الخدمات المحددة
              </label>
            </CardContent>
          </Card>

          {/* Validation summary */}
          {validation.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex items-start gap-2 p-3 text-xs text-amber-400">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">يُرجى استكمال:</div>
                  <ul className="mt-1 list-disc ps-4">
                    {validation.map((v) => <li key={v}>{v}</li>)}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-2 p-4 text-[12px]">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">مراجعة سريعة</p>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">العميل:</dt>
                <dd className="font-medium">{selectedClient?.name ?? "—"}</dd>
                <dt className="text-muted-foreground">اسم المشروع:</dt>
                <dd className="font-medium">{name || "—"}</dd>
                <dt className="text-muted-foreground">الباقة:</dt>
                <dd className="font-medium">{packageNamesJoined || "—"}</dd>
                <dt className="text-muted-foreground">المدة:</dt>
                <dd className="font-medium">{activeDuration || "—"}</dd>
                <dt className="text-muted-foreground">عدد الخدمات:</dt>
                <dd className="font-medium tabular-nums">{selectedServices.size}</dd>
                <dt className="text-muted-foreground">المهام المتوقعة:</dt>
                <dd className="font-medium tabular-nums">{preview.length}</dd>
                <dt className="text-muted-foreground">المتابعون:</dt>
                <dd className="font-medium tabular-nums">{followerIds.length}</dd>
                <dt className="text-muted-foreground">من → إلى:</dt>
                <dd className="font-medium tabular-nums" dir="ltr">
                  {startDate || "—"} → {endDate || "—"}
                </dd>
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (step === 1) router.push("/projects");
              else setStep((step - 1) as WizardStep);
            }}
          >
            {step === 1 ? "إلغاء" : (
              <>
                <ChevronRight className="size-4 icon-flip-rtl" />
                السابق
              </>
            )}
          </Button>
          {step < 3 ? (
            <Button
              type="button"
              disabled={!canAdvance[step]}
              onClick={() => setStep((step + 1) as WizardStep)}
            >
              التالي
              <ChevronLeft className="size-4 icon-flip-rtl" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={submitProject}
              disabled={pending || selectedServices.size === 0 || validation.length > 0}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              إنشاء المشروع
            </Button>
          )}
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
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto px-1">
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
                    {constantAssigneeId && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-dim px-1.5 py-0.5 text-cyan">
                        + منفِّذ ثابت
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
