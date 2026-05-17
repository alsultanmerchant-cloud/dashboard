"use client";

// Sky Light feedback #12: editable multi-package selection on the project
// detail page. Replaces the read-only chip strip — same visual layout, but
// each chip carries a remove button and a searchable "Add package" combobox
// is appended at the end. Backed by attach/detach server actions in
// _service_actions.ts.

import { useMemo, useRef, useState, useTransition, useEffect } from "react";
import { Plus, X, Loader2, Check, Search, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ServiceBadge } from "@/components/status-badges";
import { AnchoredPopover } from "@/components/ui/anchored-popover";
import { EmployeeCombobox } from "@/components/forms/employee-combobox";
import { cn } from "@/lib/utils";
import {
  attachProjectServiceAction,
  createServiceTaskAction,
  detachProjectServiceAction,
} from "./_service_actions";
import {
  attachServiceTagAction,
  detachServiceTagAction,
} from "./_service_tag_actions";

export type ServiceLink = {
  id: string;
  service_id: string;
  service: { id: string; name: string; slug: string };
  /** Count of tasks on the project that carry this service_id. Surfaced as
   *  a badge on the chip so users can see the service "has tasks" at a
   *  glance — fixes §3.2 where a freshly-created task wasn't visibly tied
   *  to its service from the project page. */
  task_count?: number;
  /** §3.1: tags attached to this specific project_services row (HOLD etc).
   *  Rendered as pills inside the chip. Reuses the org-wide project_tags
   *  catalog. */
  tags?: Array<{ id: string; name: string; color: number }>;
};

export type ProjectTagOption = { id: string; name: string; color: number };

export type ServiceCandidate = {
  id: string;
  name: string;
  slug: string;
};

export type EmployeePickOption = {
  id: string;
  full_name: string;
  department_name: string | null;
};

const ROLE_OPTIONS: Array<{
  value: "specialist" | "manager" | "agent" | "account_manager";
  label: string;
}> = [
  { value: "agent", label: "منفِّذ" },
  { value: "specialist", label: "متخصص" },
  { value: "manager", label: "مدير القسم" },
  { value: "account_manager", label: "مدير الحساب" },
];

// Odoo color palette — same palette used in project-card.tsx.
const ODOO_TAG_COLORS = [
  "#9c9c9c", "#d44d4d", "#dfb700", "#3597d3", "#5b8a72", "#9b59b6",
  "#e63946", "#2a9d8f", "#264653", "#f4a261", "#28a745", "#5241c3",
];
function odooTagColor(i: number): string {
  return ODOO_TAG_COLORS[i % ODOO_TAG_COLORS.length] ?? ODOO_TAG_COLORS[0];
}

export function ProjectServicesPanel({
  projectId,
  attached,
  candidates,
  employees,
  canManage,
  tagOptions = [],
}: {
  projectId: string;
  attached: ServiceLink[];
  candidates: ServiceCandidate[];
  employees: EmployeePickOption[];
  canManage: boolean;
  /** §3.1: catalog of project-level tags reused for service-level tagging.
   *  Empty when the org has no tags defined; the toggle button stays hidden
   *  in that case. */
  tagOptions?: ProjectTagOption[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Sky Light feedback #10: per-chip "create task" form. Only one expands at
  // a time. State is { serviceId, title, dueDate, priority } or null.
  const [taskForm, setTaskForm] = useState<{
    serviceId: string;
    serviceName: string;
    title: string;
    dueDate: string;
    priority: "low" | "medium" | "high" | "urgent";
    assigneeEmployeeId: string;
    assigneeRole: "specialist" | "manager" | "agent" | "account_manager";
    teamManagerEmployeeId: string;
  } | null>(null);
  const taskTitleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (taskForm) taskTitleRef.current?.focus();
  }, [taskForm?.serviceId]);

  function submitTask() {
    if (!taskForm) return;
    if (!taskForm.assigneeEmployeeId) {
      toast.error("اختر مُسنَدًا للمهمة");
      return;
    }
    setBusyServiceId(taskForm.serviceId);
    start(async () => {
      const res = await createServiceTaskAction({
        projectId,
        serviceId: taskForm.serviceId,
        title: taskForm.title,
        dueDate: taskForm.dueDate || null,
        priority: taskForm.priority,
        assignees: [
          {
            employeeId: taskForm.assigneeEmployeeId,
            roleType: taskForm.assigneeRole,
            teamManagerEmployeeId: taskForm.teamManagerEmployeeId || null,
          },
        ],
      });
      setBusyServiceId(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`تم إنشاء المهمة في «${taskForm.serviceName}»`);
      setTaskForm(null);
      router.refresh();
    });
  }

  const attachedIds = useMemo(
    () => new Set(attached.map((a) => a.service_id)),
    [attached],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((c) => !attachedIds.has(c.id))
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q),
      );
  }, [candidates, attachedIds, query]);

  useEffect(() => {
    setActiveIndex((i) => Math.min(Math.max(0, i), Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Outside-click + Esc handled by AnchoredPopover; we only focus the
  // search input on open. The previous scrollIntoView trick is unnecessary
  // now that the popover renders via portal (always visible at the trigger
  // bottom regardless of the trigger's parent scroll).
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function attach(serviceId: string) {
    setBusyServiceId(serviceId);
    start(async () => {
      const res = await attachProjectServiceAction({ projectId, serviceId });
      setBusyServiceId(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      // §3.3: report how many tasks were auto-generated so the user knows
      // the wizard-like template expansion ran (or didn't, for empty
      // services). Falls back to the prior message when the count is zero.
      toast.success(
        res.tasksGenerated && res.tasksGenerated > 0
          ? `تمت إضافة الباقة وتوليد ${res.tasksGenerated} مهمة`
          : "تمت إضافة الباقة",
      );
      setQuery("");
      router.refresh();
    });
  }

  function detach(serviceId: string, serviceName: string) {
    if (!window.confirm(`إزالة باقة «${serviceName}» من المشروع؟`)) return;
    setBusyServiceId(serviceId);
    start(async () => {
      const res = await detachProjectServiceAction({ projectId, serviceId });
      setBusyServiceId(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تمت الإزالة");
      router.refresh();
    });
  }

  // §3.1: tag-on-service controls. The popover-style picker would be
  // overkill here — services are visible chips and tags are short. We
  // anchor a small attach/detach via a single "Tag" button per chip that
  // cycles through tagOptions on click. For now we expose an inline
  // dropdown via native <select> to keep the surface tiny.
  const [tagBusyKey, setTagBusyKey] = useState<string | null>(null);
  function toggleTag(projectServiceId: string, tagId: string, attached: boolean) {
    const key = `${projectServiceId}:${tagId}`;
    setTagBusyKey(key);
    start(async () => {
      const res = attached
        ? await detachServiceTagAction({ projectId, projectServiceId, tagId })
        : await attachServiceTagAction({ projectId, projectServiceId, tagId });
      setTagBusyKey(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(attached ? "تم إلغاء الوسم" : "تم إضافة الوسم");
      router.refresh();
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) attach(target.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setAdding(false);
      setQuery("");
    }
  }

  return (
    <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      {attached.length === 0 && !canManage && (
        <p className="text-sm text-muted-foreground">لا توجد باقات مرتبطة بعد.</p>
      )}
      {attached.map((ps) => {
        const s = ps.service;
        const isBusy = busyServiceId === s.id && pending;
        const taskCount = ps.task_count ?? 0;
        return (
          <span
            key={ps.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-soft bg-soft-1 ps-1 pe-2 py-1"
          >
            <ServiceBadge slug={s.slug} name={s.name} />
            {(ps.tags ?? []).map((tag) => {
              const isBusyTag = tagBusyKey === `${ps.id}:${tag.id}` && pending;
              return (
                <button
                  type="button"
                  key={tag.id}
                  onClick={() => canManage && toggleTag(ps.id, tag.id, true)}
                  disabled={!canManage || isBusyTag}
                  title={canManage ? `إزالة الوسم ${tag.name}` : tag.name}
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-70"
                  style={{ backgroundColor: odooTagColor(tag.color) }}
                >
                  {tag.name}
                  {canManage && <X className="ms-0.5 size-2.5" />}
                </button>
              );
            })}
            {taskCount > 0 && (
              <a
                href={`/tasks?projectId=${projectId}&groupBy=service`}
                title={`عرض مهام ${s.name} (${taskCount})`}
                className="rounded-full bg-cyan/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-cyan transition-colors hover:bg-cyan/25"
              >
                {taskCount} مهمة
              </a>
            )}
            {canManage && tagOptions.length > 0 && (() => {
              // Inline picker: native <select> with onChange — minimal UI,
              // exact match to the user's "flag as HOLD" use case. The
              // select stays out of the way until clicked.
              const attachedTagIds = new Set((ps.tags ?? []).map((t) => t.id));
              const available = tagOptions.filter((t) => !attachedTagIds.has(t.id));
              if (available.length === 0) return null;
              return (
                <span
                  className="inline-flex items-center"
                  title="إضافة وسم لهذه الخدمة"
                >
                  <select
                    aria-label={`إضافة وسم لـ ${s.name}`}
                    value=""
                    disabled={pending}
                    onChange={(e) => {
                      const tagId = e.target.value;
                      if (tagId) toggleTag(ps.id, tagId, false);
                    }}
                    className="rounded-full border border-dashed border-soft bg-transparent px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-cyan/40 transition-colors disabled:opacity-50"
                  >
                    <option value="">+ وسم</option>
                    {available.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </span>
              );
            })()}
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setTaskForm((f) =>
                      f?.serviceId === s.id
                        ? null
                        : {
                            serviceId: s.id,
                            serviceName: s.name,
                            title: "",
                            dueDate: "",
                            priority: "medium",
                            assigneeEmployeeId: "",
                            assigneeRole: "agent",
                            teamManagerEmployeeId: "",
                          },
                    )
                  }
                  disabled={pending}
                  aria-label={`إضافة مهمة لـ ${s.name}`}
                  title="إضافة مهمة"
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-cyan-dim/40 hover:text-cyan transition-colors disabled:opacity-50"
                >
                  <ListPlus className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => detach(ps.service_id, s.name)}
                  disabled={pending}
                  aria-label={`إزالة ${s.name}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-cc-red/10 hover:text-cc-red transition-colors disabled:opacity-50"
                >
                  {isBusy ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <X className="size-3" />
                  )}
                </button>
              </>
            )}
          </span>
        );
      })}

      {canManage && (
        <div>
          <span ref={triggerRef} className="inline-block">
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              disabled={candidates.length === 0 || candidates.length === attached.length}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-dashed border-soft px-2.5 py-1 text-xs",
                "text-muted-foreground hover:text-foreground hover:border-cyan/40 hover:bg-cyan-dim/30 transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
              aria-haspopup="listbox"
              aria-expanded={adding}
            >
              <Plus className="size-3" />
              إضافة باقة
            </button>
          </span>

          <AnchoredPopover
            anchorRef={triggerRef}
            open={adding}
            onClose={() => {
              setAdding(false);
              setQuery("");
            }}
            className="z-50 w-72 max-w-[90vw] min-h-[14rem] overflow-hidden rounded-xl border border-soft bg-card shadow-2xl shadow-black/30"
          >
            <div role="dialog" aria-label="اختر باقة">
              <div className="flex items-center gap-2 border-b border-soft px-2.5 py-2">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="ابحث عن باقة..."
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
              <ul role="listbox" className="min-h-[10rem] max-h-64 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <li className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                    لا نتائج
                  </li>
                ) : (
                  filtered.map((c, idx) => {
                    const isActive = idx === activeIndex;
                    return (
                      <li key={c.id} role="option" aria-selected={isActive}>
                        <button
                          type="button"
                          disabled={pending}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => attach(c.id)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-start text-xs transition-colors disabled:opacity-60",
                            isActive
                              ? "bg-cyan-dim/60 text-foreground"
                              : "hover:bg-soft-2",
                          )}
                        >
                          <span className="truncate">{c.name}</span>
                          {busyServiceId === c.id && pending ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                          ) : (
                            <Check className="size-3.5 shrink-0 opacity-0" />
                          )}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              <div className="border-t border-soft px-2.5 py-1.5 text-[10px] text-muted-foreground">
                {filtered.length} متاح
              </div>
            </div>
          </AnchoredPopover>
        </div>
      )}
    </div>

      {taskForm && (
        <div className="rounded-xl border border-cyan/30 bg-cyan-dim/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">
              مهمة جديدة في «{taskForm.serviceName}»
            </p>
            <button
              type="button"
              onClick={() => setTaskForm(null)}
              disabled={pending}
              className="rounded-full p-1 text-muted-foreground hover:bg-soft-2"
              aria-label="إلغاء"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <input
              ref={taskTitleRef}
              value={taskForm.title}
              onChange={(e) =>
                setTaskForm((f) => (f ? { ...f, title: e.target.value } : f))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && taskForm.title.trim().length >= 2) {
                  e.preventDefault();
                  submitTask();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setTaskForm(null);
                }
              }}
              placeholder="عنوان المهمة..."
              className="rounded-lg border border-soft bg-card px-2.5 py-1.5 text-sm outline-none focus:border-cyan/50"
              disabled={pending}
            />
            <input
              type="date"
              value={taskForm.dueDate}
              onChange={(e) =>
                setTaskForm((f) => (f ? { ...f, dueDate: e.target.value } : f))
              }
              title="الموعد النهائي (اختياري)"
              className="rounded-lg border border-soft bg-card px-2 py-1.5 text-xs outline-none focus:border-cyan/50"
              disabled={pending}
            />
            <select
              value={taskForm.priority}
              onChange={(e) =>
                setTaskForm((f) =>
                  f
                    ? {
                        ...f,
                        priority: e.target.value as
                          | "low"
                          | "medium"
                          | "high"
                          | "urgent",
                      }
                    : f,
                )
              }
              className="rounded-lg border border-soft bg-card px-2 py-1.5 text-xs outline-none focus:border-cyan/50"
              disabled={pending}
            >
              <option value="low">منخفضة</option>
              <option value="medium">متوسطة</option>
              <option value="high">عالية</option>
              <option value="urgent">عاجلة</option>
            </select>
            <button
              type="button"
              onClick={submitTask}
              disabled={
                pending ||
                taskForm.title.trim().length < 2 ||
                !taskForm.assigneeEmployeeId
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {pending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Plus className="size-3" />
              )}
              إنشاء
            </button>
          </div>

          {/* Required assignee row — task creation is blocked until an
              employee is picked (Sky Light spec). Role + optional team
              manager keep parity with the per-task assignees panel. */}
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <EmployeeCombobox
              value={taskForm.assigneeEmployeeId || null}
              onChange={(v) =>
                setTaskForm((f) =>
                  f ? { ...f, assigneeEmployeeId: v ?? "" } : f,
                )
              }
              options={employees}
              disabled={pending}
              clearable={false}
              placeholder="— اختر مُسنَدًا (إلزامي) —"
              ariaLabel="المُسنَد"
            />
            <select
              value={taskForm.assigneeRole}
              onChange={(e) =>
                setTaskForm((f) =>
                  f
                    ? {
                        ...f,
                        assigneeRole: e.target.value as
                          | "specialist"
                          | "manager"
                          | "agent"
                          | "account_manager",
                      }
                    : f,
                )
              }
              disabled={pending}
              className="rounded-lg border border-soft bg-card px-2 py-1.5 text-xs outline-none focus:border-cyan/50"
              aria-label="الدور"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <EmployeeCombobox
              value={taskForm.teamManagerEmployeeId || null}
              onChange={(v) =>
                setTaskForm((f) =>
                  f ? { ...f, teamManagerEmployeeId: v ?? "" } : f,
                )
              }
              options={employees.filter(
                (e) => e.id !== taskForm.assigneeEmployeeId,
              )}
              disabled={pending}
              placeholder="— مدير الفريق (اختياري) —"
              clearLabel="— مدير الفريق (اختياري) —"
              ariaLabel="مدير الفريق (اختياري)"
            />
          </div>
        </div>
      )}
    </div>
  );
}
