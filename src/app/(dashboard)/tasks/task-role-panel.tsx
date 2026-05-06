"use client";

// Sky Light role-slot panel.
// Renders the 4 named slots (Specialist / Manager / Agent / Account Manager)
// in the task detail page. Each row has a picker; assigning fires the
// server action and refreshes.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserMinus } from "lucide-react";
import {
  TASK_ROLE_TYPES,
  TASK_ROLE_LABELS,
  TASK_ROLE_TONES,
  TASK_ROLE_ELIGIBLE_KINDS,
  type TaskRoleType,
  type DepartmentKind,
} from "@/lib/labels";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { assignTaskRoleAction } from "./_actions";

type Employee = {
  id: string;
  full_name: string;
  job_title: string | null;
  avatar_url: string | null;
  department_kind: DepartmentKind | null;
  department_name: string | null;
};

type SlotAssignment = {
  role_type: TaskRoleType;
  employee: Employee | null;
};

export function TaskRolePanel({
  taskId,
  slots,
  employees,
}: {
  taskId: string;
  slots: SlotAssignment[];
  employees: Employee[];
}) {
  const byRole = new Map<TaskRoleType, Employee | null>();
  for (const r of TASK_ROLE_TYPES) byRole.set(r, null);
  for (const s of slots) byRole.set(s.role_type, s.employee);

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {TASK_ROLE_TYPES.map((role) => (
        <SlotRow
          key={role}
          taskId={taskId}
          role={role}
          current={byRole.get(role) ?? null}
          employees={employees}
        />
      ))}
    </div>
  );
}

function SlotRow({
  taskId,
  role,
  current,
  employees,
}: {
  taskId: string;
  role: TaskRoleType;
  current: Employee | null;
  employees: Employee[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Sky Light routing: each slot only sees employees from the relevant
  // department kinds. If filter yields nothing (e.g. no employee yet
  // assigned to the right dept) we fall back to the full list so the
  // user isn't blocked during initial setup.
  const allowedKinds = TASK_ROLE_ELIGIBLE_KINDS[role];
  const filtered = employees.filter(
    (e) => e.department_kind != null && allowedKinds.includes(e.department_kind),
  );
  let options = filtered.length > 0 ? filtered : employees;
  // CRITICAL: Radix Select shows the raw `value` (the UUID) when no matching
  // SelectItem exists. Many Odoo-imported employees lack a department_kind
  // (or are in a non-execution dept) so they get filtered out — but they
  // can still be CURRENTLY assigned to this slot. Always include the
  // currently-assigned employee so the trigger renders their name.
  if (current && !options.some((o) => o.id === current.id)) {
    options = [current, ...options];
  }

  function commit(employeeId: string | null) {
    start(async () => {
      const res = await assignTaskRoleAction({
        taskId,
        roleType: role,
        employeeId,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(
        employeeId
          ? `تم تعيين ${TASK_ROLE_LABELS[role]}`
          : `تم إخلاء خانة ${TASK_ROLE_LABELS[role]}`,
      );
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        // TASK_ROLE_TONES provides solid bg + text colors per role.
        "flex items-center gap-3 rounded-xl border p-3",
        TASK_ROLE_TONES[role],
      )}
    >
      <div className="flex min-w-24 flex-col">
        <span className="text-[11px] uppercase tracking-wider font-semibold">
          {TASK_ROLE_LABELS[role]}
        </span>
        {current && (
          <span className="text-[10px] opacity-90 truncate">
            {current.job_title ?? ""}
          </span>
        )}
      </div>
      <div className="flex flex-1 items-center gap-2">
        {current && (
          <Avatar size="sm">
            {current.avatar_url && (
              <AvatarImage src={current.avatar_url} alt={current.full_name} />
            )}
            <AvatarFallback>{current.full_name[0]}</AvatarFallback>
          </Avatar>
        )}
        <Select
          value={current?.id ?? ""}
          onValueChange={(v) => commit(v === "" ? null : v)}
          disabled={pending}
        >
          <SelectTrigger className="flex-1 bg-white/90 dark:bg-black/30 border-soft-2 text-xs text-foreground">
            {/* Explicit fallback: if Radix can't resolve `value` to a child
                SelectItem (stale data, async edge), render the current name
                directly so the user never sees a raw UUID. */}
            {current ? (
              <span className="truncate">{current.full_name}</span>
            ) : (
              <SelectValue placeholder="غير معيّن" />
            )}
          </SelectTrigger>
          <SelectContent>
            {options.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.full_name}
                {e.job_title ? ` — ${e.job_title}` : e.department_name ? ` — ${e.department_name}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {current && !pending && (
          <button
            type="button"
            onClick={() => commit(null)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-soft-2 hover:text-foreground"
            aria-label="إخلاء"
            title="إخلاء"
          >
            <UserMinus className="size-3.5" />
          </button>
        )}
        {pending && <Loader2 className="size-4 animate-spin opacity-70" />}
      </div>
    </div>
  );
}
