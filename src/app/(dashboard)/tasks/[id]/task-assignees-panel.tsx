"use client";

// Multi-assignee panel for the task detail page (migration 0097).
// Many assignees per task, each with role + optional team manager.
// Mirrors the followers-panel popover pattern for the searchable picker.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Loader2, UserPlus, X, Search, ChevronDown, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AnchoredPopover } from "@/components/ui/anchored-popover";
import { cn } from "@/lib/utils";
import {
  addTaskAssigneeAction,
  removeTaskAssigneeAction,
  setAssigneeTeamManagerAction,
} from "./_assignee_actions";

export type AssigneeRoleType =
  | "specialist"
  | "manager"
  | "agent"
  | "account_manager";

const ROLE_LABELS: Record<AssigneeRoleType, string> = {
  account_manager: "مدير الحساب",
  specialist: "متخصص",
  manager: "مدير القسم",
  agent: "منفِّذ",
};

export type AssigneeRow = {
  id: string;
  employee_id: string;
  role_type: AssigneeRoleType;
  team_manager_employee_id: string | null;
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
};

export type EmployeeOption = {
  id: string;
  full_name: string;
  job_title: string | null;
  avatar_url: string | null;
  department_name: string | null;
};

export function TaskAssigneesPanel({
  taskId,
  assignees,
  employees,
  canManage,
}: {
  taskId: string;
  assignees: AssigneeRow[];
  employees: EmployeeOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<AssigneeRoleType>("agent");
  const [managerId, setManagerId] = useState<string | null>(null);
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
    start(async () => {
      const res = await addTaskAssigneeAction({
        taskId,
        employeeId,
        roleType: role,
        teamManagerEmployeeId: managerId,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم إسناد المهمة");
      setQuery("");
      setManagerId(null);
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
      toast.success("تمت الإزالة");
      router.refresh();
    });
  }

  function setManager(assigneeId: string, employeeId: string | null) {
    start(async () => {
      const res = await setAssigneeTeamManagerAction({
        assigneeId,
        teamManagerEmployeeId: employeeId,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم تحديث مدير الفريق");
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
          <p className="text-sm text-muted-foreground">
            لا يوجد مُسنَدون بعد
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            كل مهمة تحتاج لمُسنَد واحد على الأقل قبل البدء.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {assignees.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-3 rounded-xl border border-soft bg-soft-1 p-3"
            >
              <Avatar size="md" className="shrink-0">
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
                    {ROLE_LABELS[a.role_type]}
                  </span>
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
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                  <UserCog className="size-3 text-muted-foreground" />
                  <span className="text-muted-foreground">مدير الفريق:</span>
                  {canManage ? (
                    <ManagerSelect
                      employees={employees.filter(
                        (e) => e.id !== a.employee_id,
                      )}
                      value={a.team_manager_employee_id}
                      onChange={(v) => setManager(a.id, v)}
                      disabled={pending}
                    />
                  ) : (
                    <span className="font-medium">
                      {a.team_manager?.full_name ?? "—"}
                    </span>
                  )}
                </div>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  disabled={pending}
                  aria-label={`إزالة ${a.employee.full_name}`}
                  className="text-muted-foreground transition-colors hover:text-cc-red disabled:opacity-50"
                >
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
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
              إضافة مُسنَد
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
            <div role="dialog" aria-label="إضافة مُسنَد">
              {/* Role + optional team manager pickers */}
              <div className="space-y-2 border-b border-soft px-3 py-2.5">
                <label className="block text-[11px] font-medium text-muted-foreground">
                  الدور
                </label>
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(ROLE_LABELS) as AssigneeRoleType[]).map((r) => (
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
                      {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
                <label className="mt-1.5 block text-[11px] font-medium text-muted-foreground">
                  مدير الفريق (اختياري)
                </label>
                <ManagerSelect
                  employees={employees}
                  value={managerId}
                  onChange={setManagerId}
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
                  placeholder="ابحث بالاسم أو الوظيفة أو القسم..."
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  aria-label="بحث الموظفين"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="مسح البحث"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>

              <ul
                role="listbox"
                className="max-h-56 overflow-y-auto py-1"
                aria-label="الموظفون"
              >
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
                <span>{filtered.length} مرشح</span>
                <button
                  type="button"
                  onClick={() => {
                    setPicking(false);
                    setQuery("");
                  }}
                  className="hover:text-foreground"
                >
                  إغلاق (Esc)
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
  return (
    <div className="relative">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="h-7 w-full appearance-none rounded-md border border-soft-2 bg-card pe-6 ps-2 text-[11px] outline-none focus:border-cyan/40 disabled:opacity-60"
      >
        <option value="">— بدون —</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.full_name}
            {e.department_name ? ` · ${e.department_name}` : ""}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute end-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
