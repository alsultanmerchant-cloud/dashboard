"use client";

// Multi-assignee panel for the task detail page (migration 0097 + 0109).
// Each assignee carries a team_leader (team_manager_employee_id) and a
// head_of_dept (head_of_dept_employee_id), both linked to the org chart.
// When adding a new assignee the two fields are auto-populated from the
// employee's department defaults (EmployeeOption.default_team_leader_id /
// default_head_of_dept_id) and can be overridden before saving.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, UserPlus, X, Search, Users, Building2, ChevronDown, Check, Globe } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AnchoredPopover } from "@/components/ui/anchored-popover";
import { cn } from "@/lib/utils";
import { TASK_OWNER_ROLE_LABELS, type TaskOwnerRoleKey } from "@/lib/labels";
import {
  addTaskAssigneeAction,
  removeTaskAssigneeAction,
  setAssigneeTeamManagerAction,
  setAssigneeHeadOfDeptAction,
} from "./_assignee_actions";

export type AssigneeRoleType =
  | "specialist"
  | "manager"
  | "agent"
  | "account_manager";

export type AssigneeRow = {
  id: string;
  employee_id: string;
  role_type: AssigneeRoleType;
  // Structural role from the employee's position (positions.role) — the badge
  // shows THIS (the person's real role), not role_type (the task's stage
  // function). Null when the employee has no position set; falls back to
  // role_type. Source of truth: /organization/employees.
  positionRole: string | null;
  team_manager_employee_id: string | null;
  head_of_dept_employee_id: string | null;
  employee: {
    id: string;
    full_name: string;
    job_title: string | null;
    avatar_url: string | null;
    department_name: string | null;
  };
  team_manager: {
    id: string;
    full_name: string;
  } | null;
  head_of_dept: {
    id: string;
    full_name: string;
  } | null;
};

export type EmployeeOption = {
  id: string;
  full_name: string;
  job_title: string | null;
  avatar_url: string | null;
  department_name: string | null;
  /** Auto-populated from the employee's department team leads (org chart). */
  default_team_leader_id: string | null;
  /** Auto-populated from the department head_employee_id (org chart). */
  default_head_of_dept_id: string | null;
};

export function TaskAssigneesPanel({
  taskId,
  assignees,
  employees,
  canManage,
  currentStage,
  stageOwnerPositions,
  positionRoleBySlug,
}: {
  taskId: string;
  assignees: AssigneeRow[];
  employees: EmployeeOption[];
  canManage: boolean;
  currentStage?: string | null;
  stageOwnerPositions?: Record<string, string | null> | null;
  positionRoleBySlug?: Record<string, string>;
}) {
  const t = useTranslations("TaskDetailPage.assigneesPanel");
  const roleLabels: Record<AssigneeRoleType, string> = {
    account_manager: t("roles.account_manager"),
    specialist: t("roles.specialist"),
    manager: t("roles.manager"),
    agent: t("roles.agent"),
  };

  const currentOwnerRole = (() => {
    if (!currentStage || !stageOwnerPositions) return null;
    // stage_owner_positions stores a position slug — map it to its role.
    const slug = stageOwnerPositions[currentStage];
    if (!slug) return null;
    const role = positionRoleBySlug?.[slug] ?? slug;
    return (role as AssigneeRoleType | null) ?? null;
  })();

  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<AssigneeRoleType>("agent");
  const [managerId, setManagerId] = useState<string | null>(null);
  const [headOfDeptId, setHeadOfDeptId] = useState<string | null>(null);
  // Per-card "apply globally" toggles, keyed by `${assigneeId}:tl` /
  // `${assigneeId}:hod`. When on, the next dropdown change also writes the
  // canonical org-chart record (employee_profiles.manager_employee_id or
  // departments.head_employee_id) — not just this task's override.
  const [globalScope, setGlobalScope] = useState<Record<string, boolean>>({});
  const isGlobal = (key: string) => Boolean(globalScope[key]);
  const toggleGlobal = (key: string) =>
    setGlobalScope((m) => ({ ...m, [key]: !m[key] }));
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, start] = useTransition();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        (e.job_title ?? "").toLowerCase().includes(q) ||
        (e.department_name ?? "").toLowerCase().includes(q),
    );
  }, [employees, query]);

  useEffect(() => {
    setActiveIndex((i) =>
      Math.min(Math.max(0, i), Math.max(0, filtered.length - 1)),
    );
  }, [filtered.length]);

  useEffect(() => {
    if (picking) inputRef.current?.focus();
  }, [picking]);

  function add(employeeId: string) {
    // Auto-populate from employee's department defaults if not manually set.
    const emp = employees.find((e) => e.id === employeeId);
    const resolvedManagerId = managerId ?? emp?.default_team_leader_id ?? null;
    const resolvedHodId = headOfDeptId ?? emp?.default_head_of_dept_id ?? null;

    start(async () => {
      const res = await addTaskAssigneeAction({
        taskId,
        employeeId,
        roleType: role,
        teamManagerEmployeeId: resolvedManagerId,
        headOfDeptEmployeeId: resolvedHodId,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.assigned"));
      setQuery("");
      setManagerId(null);
      setHeadOfDeptId(null);
      router.refresh();
    });
  }

  function remove(assigneeId: string) {
    start(async () => {
      const res = await removeTaskAssigneeAction({ assigneeId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.removed"));
      router.refresh();
    });
  }

  function setTeamLeader(assigneeId: string, employeeId: string | null) {
    const applyGlobally = isGlobal(`${assigneeId}:tl`);
    start(async () => {
      const res = await setAssigneeTeamManagerAction({
        assigneeId,
        teamManagerEmployeeId: employeeId,
        applyGlobally,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.appliedGlobally
          ? t("toasts.teamLeaderUpdatedGlobal")
          : t("toasts.teamLeaderUpdated"),
      );
      router.refresh();
    });
  }

  function setHeadOfDept(assigneeId: string, employeeId: string | null) {
    const applyGlobally = isGlobal(`${assigneeId}:hod`);
    start(async () => {
      const res = await setAssigneeHeadOfDeptAction({
        assigneeId,
        headOfDeptEmployeeId: employeeId,
        applyGlobally,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.appliedGlobally ? t("toasts.hodUpdatedGlobal") : t("toasts.hodUpdated"),
      );
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
      if (target) add(target.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPicking(false);
      setQuery("");
    }
  }

  return (
    <div className="space-y-3">
      {assignees.length === 0 ? (
        <div className="rounded-xl border border-dashed border-soft-2 bg-soft-1/40 px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">{t("empty.title")}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("empty.description")}
          </p>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {assignees.map((a) => {
            const isCurrentOwner =
              currentOwnerRole !== null && a.role_type === currentOwnerRole;
            return (
              <li
                key={a.id}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 transition-colors",
                  isCurrentOwner
                    ? "border-cyan/50 bg-cyan-dim/30 ring-1 ring-cyan/30"
                    : "border-soft bg-soft-1",
                )}
              >
                <Avatar className="size-10 shrink-0">
                  {a.employee.avatar_url ? (
                    <AvatarImage src={a.employee.avatar_url} alt="" />
                  ) : null}
                  <AvatarFallback>{a.employee.full_name[0]}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {a.employee.full_name}
                    </span>
                    <span className="rounded-full bg-cyan-dim px-1.5 py-0.5 text-[10px] font-semibold text-cyan">
                      {(a.positionRole &&
                        TASK_OWNER_ROLE_LABELS[
                          a.positionRole as TaskOwnerRoleKey
                        ]) ||
                        roleLabels[a.role_type]}
                    </span>
                    {isCurrentOwner && (
                      <span
                        className="inline-flex items-center rounded-full border border-cyan bg-cyan/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan"
                        title={t("currentOwnerTitle")}
                      >
                        {t("currentOwner")}
                      </span>
                    )}
                  </div>
                  {(a.employee.job_title || a.employee.department_name) && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {a.employee.job_title}
                      {a.employee.job_title && a.employee.department_name
                        ? " · "
                        : ""}
                      {a.employee.department_name}
                    </p>
                  )}

                  {/* Team Leader */}
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                    <Users className="size-3 text-muted-foreground" />
                    <span className="text-muted-foreground">{t("teamLeader")}</span>
                    {canManage ? (
                      <>
                        <ManagerSelect
                          employees={employees.filter((e) => e.id !== a.employee_id)}
                          value={a.team_manager_employee_id}
                          onChange={(v) => setTeamLeader(a.id, v)}
                          disabled={pending}
                        />
                        <GlobalScopeToggle
                          active={isGlobal(`${a.id}:tl`)}
                          onToggle={() => toggleGlobal(`${a.id}:tl`)}
                          tooltip={
                            isGlobal(`${a.id}:tl`)
                              ? t("scopeGlobalActive.teamLeader")
                              : t("scopeGlobalInactive.teamLeader")
                          }
                          ariaLabel={t("scopeGlobalAria.teamLeader")}
                        />
                      </>
                    ) : (
                      <span className="font-medium">
                        {a.team_manager?.full_name ?? t("none")}
                      </span>
                    )}
                  </div>

                  {/* Head of Department */}
                  <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                    <Building2 className="size-3 text-muted-foreground" />
                    <span className="text-muted-foreground">{t("headOfDept")}</span>
                    {canManage ? (
                      <>
                        <ManagerSelect
                          employees={employees.filter((e) => e.id !== a.employee_id)}
                          value={a.head_of_dept_employee_id}
                          onChange={(v) => setHeadOfDept(a.id, v)}
                          disabled={pending}
                        />
                        <GlobalScopeToggle
                          active={isGlobal(`${a.id}:hod`)}
                          onToggle={() => toggleGlobal(`${a.id}:hod`)}
                          tooltip={
                            isGlobal(`${a.id}:hod`)
                              ? t("scopeGlobalActive.headOfDept")
                              : t("scopeGlobalInactive.headOfDept")
                          }
                          ariaLabel={t("scopeGlobalAria.headOfDept")}
                        />
                      </>
                    ) : (
                      <span className="font-medium">
                        {a.head_of_dept?.full_name ?? t("none")}
                      </span>
                    )}
                  </div>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => remove(a.id)}
                    disabled={pending}
                    aria-label={t("removeAssignee", {
                      name: a.employee.full_name,
                    })}
                    className="text-muted-foreground transition-colors hover:text-cc-red disabled:opacity-50"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <div>
          <span ref={triggerRef} className="inline-block">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPicking((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={picking}
            >
              <UserPlus className="size-3.5" />
              {t("addAssignee")}
            </Button>
          </span>

          <AnchoredPopover
            anchorRef={triggerRef}
            open={picking}
            onClose={() => {
              setPicking(false);
              setQuery("");
            }}
            className="z-50 w-80 max-w-[92vw] overflow-hidden rounded-xl border border-soft bg-card shadow-2xl shadow-black/30"
          >
            <div role="dialog" aria-label={t("addAssignee")}>
              {/* Role + team leader + head of dept pickers */}
              <div className="space-y-2 border-b border-soft px-3 py-2.5">
                <label className="block text-[11px] font-medium text-muted-foreground">
                  {t("role")}
                </label>
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(roleLabels) as AssigneeRoleType[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                        role === r
                          ? "border-cyan/40 bg-cyan-dim text-cyan"
                          : "border-soft-2 bg-soft-1 text-muted-foreground hover:bg-soft-2",
                      )}
                    >
                      {roleLabels[r]}
                    </button>
                  ))}
                </div>

                <label className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Users className="size-3" />
                  {t("teamLeaderOptional")}
                </label>
                <ManagerSelect
                  employees={employees}
                  value={managerId}
                  onChange={setManagerId}
                  disabled={pending}
                />

                <label className="mt-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Building2 className="size-3" />
                  {t("headOfDeptOptional")}
                </label>
                <ManagerSelect
                  employees={employees}
                  value={headOfDeptId}
                  onChange={setHeadOfDeptId}
                  disabled={pending}
                />
              </div>

              {/* Searchable employee picker */}
              <div className="flex items-center gap-2 border-b border-soft px-2.5 py-2">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={t("searchPlaceholder")}
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  aria-label={t("search")}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("clearSearch")}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>

              <ul
                role="listbox"
                className="max-h-48 overflow-y-auto py-1"
                aria-label={t("employees")}
              >
                {filtered.length === 0 ? (
                  <li className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                    {t("noResults")}
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
                          onClick={() => add(c.id)}
                          className={cn(
                            "flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-xs transition-colors disabled:opacity-60",
                            isActive
                              ? "bg-cyan-dim/60 text-foreground"
                              : "hover:bg-soft-2",
                          )}
                        >
                          <Avatar size="sm" className="shrink-0">
                            {c.avatar_url ? (
                              <AvatarImage src={c.avatar_url} alt="" />
                            ) : null}
                            <AvatarFallback className="text-[10px]">
                              {c.full_name[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">
                              {c.full_name}
                            </div>
                            {(c.job_title || c.department_name) && (
                              <div className="truncate text-[10px] text-muted-foreground">
                                {c.job_title}
                                {c.job_title && c.department_name ? " · " : ""}
                                {c.department_name}
                              </div>
                            )}
                          </div>
                          {pending && (
                            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                          )}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>

              <div className="flex items-center justify-between border-t border-soft px-2.5 py-1.5 text-[10px] text-muted-foreground">
                <span>{t("candidates", { count: filtered.length })}</span>
                <button
                  type="button"
                  onClick={() => {
                    setPicking(false);
                    setQuery("");
                  }}
                  className="hover:text-foreground"
                >
                  {t("close")}
                </button>
              </div>
            </div>
          </AnchoredPopover>
        </div>
      )}
    </div>
  );
}

function ManagerSelect({
  employees,
  value,
  onChange,
  disabled,
}: {
  employees: EmployeeOption[];
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("TaskDetailPage.assigneesPanel");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (employee) =>
        employee.full_name.toLowerCase().includes(q) ||
        (employee.job_title ?? "").toLowerCase().includes(q) ||
        (employee.department_name ?? "").toLowerCase().includes(q),
    );
  }, [employees, query]);

  const selected = useMemo(
    () => employees.find((employee) => employee.id === value) ?? null,
    [employees, value],
  );

  useEffect(() => {
    setActiveIndex((i) =>
      Math.min(Math.max(0, i), Math.max(0, filtered.length - 1)),
    );
  }, [filtered.length]);

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  function pick(next: string | null) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setQuery("");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) pick(target.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="relative min-w-44">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-full items-center justify-between gap-2 rounded-md border border-soft-2 bg-card pe-2 ps-2 text-[11px] outline-none transition-colors focus:border-cyan/40 disabled:opacity-60"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span
          className={cn(
            "truncate text-start",
            !selected && "text-muted-foreground",
          )}
        >
          {selected?.full_name ?? t("noneOption")}
        </span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>

      <AnchoredPopover
        anchorRef={triggerRef}
        open={open}
        onClose={() => {
          setOpen(false);
          setQuery("");
        }}
        align="start"
        className="z-50 w-72 max-w-[90vw] overflow-hidden rounded-xl border border-soft bg-card shadow-2xl shadow-black/30"
      >
        <div role="dialog">
          <div className="flex items-center gap-2 border-b border-soft px-2.5 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("searchPlaceholder")}
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              aria-label={t("search")}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
                aria-label={t("clearSearch")}
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <div className="border-b border-soft px-2.5 py-1">
            <button
              type="button"
              onClick={() => pick(null)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-start text-xs transition-colors hover:bg-soft-2",
                value === null && "bg-cyan-dim/60 text-foreground",
              )}
            >
              <span className="truncate">{t("noneOption")}</span>
              {value === null && <Check className="size-3.5 shrink-0" />}
            </button>
          </div>

          <ul
            role="listbox"
            aria-label={t("employees")}
            className="max-h-56 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                {t("noResults")}
              </li>
            ) : (
              filtered.map((employee, idx) => {
                const isActive = idx === activeIndex;
                const isSelected = employee.id === value;
                return (
                  <li key={employee.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => pick(employee.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-start text-xs transition-colors",
                        isActive
                          ? "bg-cyan-dim/60 text-foreground"
                          : "hover:bg-soft-2",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {employee.full_name}
                        </span>
                        {(employee.job_title || employee.department_name) && (
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {employee.job_title}
                            {employee.job_title && employee.department_name
                              ? " · "
                              : ""}
                            {employee.department_name}
                          </span>
                        )}
                      </span>
                      {isSelected && <Check className="size-3.5 shrink-0" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </AnchoredPopover>
    </div>
  );
}

/**
 * Small Globe toggle that controls whether the next change to the adjacent
 * ManagerSelect also writes the canonical org-chart record (vs. only this
 * task's override row). The hover tooltip describes the current state.
 */
function GlobalScopeToggle({
  active,
  onToggle,
  tooltip,
  ariaLabel,
}: {
  active: boolean;
  onToggle: () => void;
  tooltip: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={tooltip}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors",
        active
          ? "border-cyan/50 bg-cyan-dim text-cyan"
          : "border-soft-2 bg-card text-muted-foreground hover:bg-soft-2",
      )}
    >
      <Globe className="size-3.5" />
    </button>
  );
}
