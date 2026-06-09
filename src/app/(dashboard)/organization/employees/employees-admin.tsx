"use client";

// Owner-admin employee management. One page, all CRUD:
//   • List active + terminated employees (filterable by status).
//   • Inline-edit a row (popover form).
//   • Soft-delete = terminate (sets employment_status='terminated').
//   • Hard-delete behind a typed-confirmation modal.
//
// Permission gate `employees.manage` is enforced server-side in _actions.ts;
// here we just hide row actions when canManage is false.

import { useMemo, useRef, useState, useTransition } from "react";
import {
  Loader2,
  Pencil,
  UserMinus,
  UserCheck,
  UserPlus,
  KeyRound,
  Trash2,
  X,
  Search,
  Copy,
  RefreshCw,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnchoredPopover } from "@/components/ui/anchored-popover";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";
import { OriginBadge } from "@/components/origin-badge";
import {
  PositionPicker,
  type PositionOption,
} from "@/components/forms/position-picker";
import { cn } from "@/lib/utils";
import {
  updateEmployeeAction,
  terminateEmployeeAction,
  restoreEmployeeAction,
  hardDeleteEmployeeAction,
  createAccountForEmployeeAction,
  resetEmployeePasswordAction,
} from "./_actions";

export type EmployeeRow = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  position: string | null;
  position_id: string | null;
  employment_status: string;
  department_id: string | null;
  department_name: string | null;
  manager_employee_id: string | null;
  manager_name: string | null;
  team_leader_employee_id: string | null;
  team_leader_name: string | null;
  department_head_name: string | null;
  external_source: string | null;
};

export type DeptOption = {
  id: string;
  name: string;
  head_employee_id: string | null;
};

export function EmployeesAdmin({
  rows,
  departments,
  positions: positionsProp,
  canManage,
}: {
  rows: EmployeeRow[];
  departments: DeptOption[];
  positions: PositionOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  // Lifted so a position created from one edit dialog stays available to the
  // next one without a full page refresh.
  const [positions, setPositions] = useState<PositionOption[]>(positionsProp);
  const [statusFilter, setStatusFilter] = useState<"active" | "terminated" | "all">("active");
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [hardDeleting, setHardDeleting] = useState<EmployeeRow | null>(null);
  const [creatingAccount, setCreatingAccount] = useState<EmployeeRow | null>(null);
  const [resettingPassword, setResettingPassword] = useState<EmployeeRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.employment_status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.job_title ?? "").toLowerCase().includes(q) ||
        (r.department_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  function onTerminate(row: EmployeeRow) {
    if (!window.confirm(`إنهاء خدمة «${row.full_name}»؟ يمكن استرجاعها لاحقًا.`)) {
      return;
    }
    start(async () => {
      const res = await terminateEmployeeAction({ id: row.id });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم إنهاء الخدمة");
      router.refresh();
    });
  }

  function onRestore(row: EmployeeRow) {
    start(async () => {
      const res = await restoreEmployeeAction({ id: row.id });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تمت الإعادة للعمل");
      router.refresh();
    });
  }

  const counts = useMemo(() => {
    let active = 0;
    let terminated = 0;
    for (const r of rows) {
      if (r.employment_status === "active") active++;
      else if (r.employment_status === "terminated") terminated++;
    }
    return { active, terminated, all: rows.length };
  }, [rows]);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو البريد أو القسم..."
            className="ps-8"
          />
        </div>
        <div className="inline-flex rounded-lg border border-soft bg-card p-0.5 text-xs">
          {(
            [
              { k: "active" as const, label: `النشطون (${counts.active})` },
              { k: "terminated" as const, label: `منتهية الخدمة (${counts.terminated})` },
              { k: "all" as const, label: `الكل (${counts.all})` },
            ]
          ).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setStatusFilter(t.k)}
              className={cn(
                "rounded-md px-2.5 py-1 transition-colors",
                statusFilter === t.k
                  ? "bg-cyan-dim text-cyan font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-soft-2 bg-soft-1/40 px-4 py-10 text-center text-sm text-muted-foreground">
          لا يوجد موظفون مطابقون للفلتر الحالي.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-soft bg-card">
          <table className="w-full text-sm">
            <thead className="bg-soft-1/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">الموظف</th>
                <th className="px-3 py-2 text-start font-medium">المسمى</th>
                <th className="px-3 py-2 text-start font-medium">القسم</th>
                <th className="px-3 py-2 text-start font-medium">المدير</th>
                <th className="px-3 py-2 text-start font-medium">قائد الفريق</th>
                <th className="px-3 py-2 text-start font-medium">رئيس القسم</th>
                <th className="px-3 py-2 text-start font-medium">الحالة</th>
                {canManage && <th className="px-3 py-2 text-start font-medium" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const terminated = r.employment_status === "terminated";
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-t border-soft/60",
                      terminated && "bg-soft-1/40 text-muted-foreground",
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar size="sm">
                          <AvatarFallback>{r.full_name[0]}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {r.full_name}
                            {/* PR-F (#3): origin badge — Odoo-synced rows only. */}
                            <OriginBadge source={r.external_source} className="ms-2 align-middle" />
                          </p>
                          {r.email && (
                            <p className="text-[11px] text-muted-foreground truncate" dir="ltr">
                              {r.email}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.job_title ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.department_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.manager_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.team_leader_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.department_head_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {terminated ? (
                        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                          منتهية
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                          نشط
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {!terminated && !r.user_id && (
                            <button
                              type="button"
                              onClick={() => setCreatingAccount(r)}
                              disabled={pending}
                              aria-label={`إنشاء حساب دخول لـ ${r.full_name}`}
                              title="إنشاء حساب دخول"
                              className="rounded p-1.5 text-muted-foreground hover:bg-cyan-dim hover:text-cyan"
                            >
                              <UserPlus className="size-3.5" />
                            </button>
                          )}
                          {!terminated && r.user_id && (
                            <button
                              type="button"
                              onClick={() => setResettingPassword(r)}
                              disabled={pending}
                              aria-label={`تغيير كلمة مرور ${r.full_name}`}
                              title="تغيير كلمة المرور"
                              className="rounded p-1.5 text-muted-foreground hover:bg-amber-400/10 hover:text-amber-300"
                            >
                              <KeyRound className="size-3.5" />
                            </button>
                          )}
                          <RowEditButton
                            row={r}
                            departments={departments}
                            employees={rows}
                            onOpen={() => setEditing(r)}
                          />
                          {terminated ? (
                            <button
                              type="button"
                              onClick={() => onRestore(r)}
                              disabled={pending}
                              aria-label={`إعادة ${r.full_name} للعمل`}
                              title="إعادة للعمل"
                              className="rounded p-1.5 text-muted-foreground hover:bg-emerald-400/10 hover:text-emerald-300"
                            >
                              <UserCheck className="size-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onTerminate(r)}
                              disabled={pending}
                              aria-label={`إنهاء خدمة ${r.full_name}`}
                              title="إنهاء الخدمة"
                              className="rounded p-1.5 text-muted-foreground hover:bg-amber-400/10 hover:text-amber-300"
                            >
                              <UserMinus className="size-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setHardDeleting(r)}
                            disabled={pending}
                            aria-label={`حذف ${r.full_name} نهائيًا`}
                            title="حذف نهائي"
                            className="rounded p-1.5 text-muted-foreground hover:bg-cc-red/10 hover:text-cc-red"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditEmployeeDialog
          employee={editing}
          departments={departments}
          allEmployees={rows}
          positions={positions}
          onPositionCreated={(p) =>
            setPositions((prev) =>
              prev.some((x) => x.id === p.id) ? prev : [...prev, p],
            )
          }
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {hardDeleting && (
        <HardDeleteDialog
          employee={hardDeleting}
          onClose={() => setHardDeleting(null)}
          onDeleted={() => {
            setHardDeleting(null);
            router.refresh();
          }}
        />
      )}

      {creatingAccount && (
        <CreateAccountDialog
          employee={creatingAccount}
          onClose={() => setCreatingAccount(null)}
          onCreated={() => {
            setCreatingAccount(null);
            router.refresh();
          }}
        />
      )}

      {resettingPassword && (
        <ResetPasswordDialog
          employee={resettingPassword}
          onClose={() => setResettingPassword(null)}
          onDone={() => {
            setResettingPassword(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// Edit button uses AnchoredPopover so the form pops above the table without
// being clipped by the surrounding Card.
function RowEditButton({
  row,
  onOpen,
}: {
  row: EmployeeRow;
  departments: DeptOption[];
  employees: EmployeeRow[];
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`تعديل ${row.full_name}`}
      title="تعديل"
      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Pencil className="size-3.5" />
    </button>
  );
}

function EditEmployeeDialog({
  employee,
  departments,
  allEmployees,
  positions,
  onPositionCreated,
  onClose,
  onSaved,
}: {
  employee: EmployeeRow;
  departments: DeptOption[];
  allEmployees: EmployeeRow[];
  positions: PositionOption[];
  onPositionCreated: (position: PositionOption) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(employee.full_name);
  const [email, setEmail] = useState(employee.email ?? "");
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [positionId, setPositionId] = useState(employee.position_id ?? "");
  const [departmentId, setDepartmentId] = useState(employee.department_id ?? "");
  const [managerId, setManagerId] = useState(employee.manager_employee_id ?? "");
  const [teamLeaderId, setTeamLeaderId] = useState(
    employee.team_leader_employee_id ?? "",
  );
  // Department head is stored on departments.head_employee_id — the dropdown
  // is seeded from the employee's current department and re-seeded whenever
  // the department changes. Saving it updates the head for that whole dept.
  const headForDept = (deptId: string) =>
    departments.find((d) => d.id === deptId)?.head_employee_id ?? "";
  const [departmentHeadId, setDepartmentHeadId] = useState(
    headForDept(employee.department_id ?? ""),
  );
  const [pending, start] = useTransition();

  const employeeOptions: SearchableOption[] = allEmployees
    .filter((e) => e.id !== employee.id && e.employment_status === "active")
    .map((e) => ({
      value: e.id,
      label: e.full_name,
      hint: [e.job_title, e.department_name].filter(Boolean).join(" • ") || null,
    }));

  function save() {
    start(async () => {
      const res = await updateEmployeeAction({
        id: employee.id,
        fullName,
        email: email || null,
        phone: phone || null,
        positionId: positionId || null,
        departmentId: departmentId || null,
        managerEmployeeId: managerId || null,
        teamLeaderEmployeeId: teamLeaderId || null,
        departmentHeadEmployeeId: departmentId ? departmentHeadId || null : null,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم الحفظ");
      onSaved();
    });
  }

  return (
    <Modal onClose={onClose} title={`تعديل: ${employee.full_name}`}>
      <div className="space-y-3 p-4">
        <Field label="الاسم الكامل">
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={pending}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="البريد">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              dir="ltr"
            />
          </Field>
          <Field label="الهاتف">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={pending}
              dir="ltr"
            />
          </Field>
        </div>
        <Field label="المسمى الوظيفي">
          <PositionPicker
            positions={positions}
            value={positionId}
            onChange={setPositionId}
            onPositionCreated={onPositionCreated}
            disabled={pending}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="القسم">
            <select
              value={departmentId}
              onChange={(e) => {
                const next = e.target.value;
                setDepartmentId(next);
                setDepartmentHeadId(headForDept(next));
              }}
              disabled={pending}
              className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm"
            >
              <option value="">— بدون —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="المدير">
            <SearchableSelect
              value={managerId}
              onValueChange={setManagerId}
              options={[
                { value: "", label: "— بدون —" },
                ...employeeOptions,
              ]}
              disabled={pending}
              placeholder="— بدون —"
              searchPlaceholder="ابحث عن موظف..."
              emptyMessage="لا توجد نتائج"
              ariaLabel="المدير"
            />
          </Field>
        </div>
        <Field label="قائد الفريق">
          <SearchableSelect
            value={teamLeaderId}
            onValueChange={setTeamLeaderId}
            options={[
              { value: "", label: "— بدون —" },
              ...employeeOptions,
            ]}
            disabled={pending}
            placeholder="— بدون —"
            searchPlaceholder="ابحث عن موظف..."
            emptyMessage="لا توجد نتائج"
            ariaLabel="قائد الفريق"
          />
        </Field>
        <Field label="رئيس القسم">
          <SearchableSelect
            value={departmentHeadId}
            onValueChange={setDepartmentHeadId}
            options={[
              { value: "", label: "— بدون —" },
              ...allEmployees
                .filter((e) => e.employment_status === "active")
                .map((e) => ({
                  value: e.id,
                  label: e.full_name,
                  hint:
                    [e.job_title, e.department_name]
                      .filter(Boolean)
                      .join(" • ") || null,
                })),
            ]}
            disabled={pending || !departmentId}
            placeholder={departmentId ? "— بدون —" : "اختر قسمًا أولًا"}
            searchPlaceholder="ابحث عن موظف..."
            emptyMessage="لا توجد نتائج"
            ariaLabel="رئيس القسم"
          />
          {departmentId && (
            <p className="text-[10px] text-muted-foreground">
              يُحدِّث رئيس القسم لكل موظفي هذا القسم.
            </p>
          )}
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-soft px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          إلغاء
        </Button>
        <Button size="sm" onClick={save} disabled={pending || fullName.trim().length < 2}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          حفظ
        </Button>
      </div>
    </Modal>
  );
}

function HardDeleteDialog({
  employee,
  onClose,
  onDeleted,
}: {
  employee: EmployeeRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const match = typed.trim() === employee.full_name;

  function confirmDelete() {
    if (!match) return;
    start(async () => {
      const res = await hardDeleteEmployeeAction({
        id: employee.id,
        confirmationName: typed.trim(),
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`تم حذف «${employee.full_name}» نهائيًا`);
      onDeleted();
    });
  }

  return (
    <Modal onClose={onClose} title="حذف نهائي للموظف">
      <div className="space-y-3 p-4">
        <div className="rounded-lg border border-cc-red/30 bg-cc-red/5 p-3 text-xs text-cc-red">
          <p className="font-semibold">هذا الإجراء لا يمكن التراجع عنه.</p>
          <p className="mt-1 text-cc-red/90">
            سيتم حذف الموظف وكل علاقاته (الإسنادات، المتابعات، التعليقات...) بشكل
            دائم. للحذف غير الدائم استخدم «إنهاء الخدمة» بدلًا من ذلك.
          </p>
        </div>
        <p className="text-sm">
          للتأكيد، اكتب اسم الموظف بالكامل:{" "}
          <span className="font-semibold text-foreground">{employee.full_name}</span>
        </p>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={employee.full_name}
          disabled={pending}
          autoFocus
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-soft px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          إلغاء
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={confirmDelete}
          disabled={pending || !match}
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          حذف نهائي
        </Button>
      </div>
    </Modal>
  );
}

function CreateAccountDialog({
  employee,
  onClose,
  onCreated,
}: {
  employee: EmployeeRow;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState(employee.email ?? "");
  const [password, setPassword] = useState(() => generateRandomPassword());
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ email: string; password: string } | null>(
    null,
  );
  const [copied, setCopied] = useState<"email" | "password" | "both" | null>(
    null,
  );

  function copy(value: string, kind: "email" | "password" | "both") {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(kind);
        setTimeout(() => setCopied(null), 1500);
      },
      () => toast.error("تعذر النسخ"),
    );
  }

  function submit() {
    start(async () => {
      const res = await createAccountForEmployeeAction({
        employeeId: employee.id,
        email: email.trim(),
        password,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.reusedExistingUser
          ? "تم ربط حساب موجود وتحديث كلمة المرور"
          : "تم إنشاء الحساب",
      );
      setDone({ email: res.email, password: res.password });
    });
  }

  const valid = /^\S+@\S+\.\S+$/.test(email.trim()) && password.length >= 8;

  if (done) {
    const combined = `البريد: ${done.email}\nكلمة المرور: ${done.password}`;
    return (
      <Modal onClose={onCreated} title={`بيانات دخول: ${employee.full_name}`}>
        <div className="space-y-3 p-4">
          <div className="rounded-lg border border-cyan/30 bg-cyan-dim/40 p-3 text-xs text-cyan">
            <p className="font-semibold">احفظ هذه البيانات الآن</p>
            <p className="mt-1 text-cyan/90">
              لن تظهر كلمة المرور مرة أخرى. أرسلها للموظف عبر قناة آمنة.
            </p>
          </div>
          <CredentialField
            label="البريد"
            value={done.email}
            onCopy={() => copy(done.email, "email")}
            copied={copied === "email"}
          />
          <CredentialField
            label="كلمة المرور"
            value={done.password}
            mono
            onCopy={() => copy(done.password, "password")}
            copied={copied === "password"}
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-soft px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(combined, "both")}
          >
            {copied === "both" ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            نسخ الكل
          </Button>
          <Button size="sm" onClick={onCreated}>
            تم
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title={`إنشاء حساب دخول: ${employee.full_name}`}>
      <div className="space-y-3 p-4">
        <div className="rounded-lg border border-soft bg-soft-1/40 p-3 text-[11px] text-muted-foreground">
          سيتمكن الموظف من تسجيل الدخول بهذا البريد وكلمة المرور. الصلاحيات
          تُدار من{" "}
          <span className="font-medium text-foreground">صفحة الأدوار</span>{" "}
          بعد إنشاء الحساب.
        </div>
        <Field label="البريد الإلكتروني">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            dir="ltr"
            placeholder="employee@agency.com"
            autoFocus
          />
        </Field>
        <Field label="كلمة المرور">
          <div className="flex gap-2">
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              dir="ltr"
              className="font-mono"
            />
            <button
              type="button"
              onClick={() => setPassword(generateRandomPassword())}
              disabled={pending}
              title="توليد كلمة مرور جديدة"
              aria-label="توليد كلمة مرور جديدة"
              className="rounded-lg border border-soft bg-card px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => copy(password, "password")}
              disabled={pending}
              title="نسخ"
              aria-label="نسخ كلمة المرور"
              className="rounded-lg border border-soft bg-card px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied === "password" ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            8 أحرف على الأقل. يُنصح بكلمة مرور قوية مُولَّدة عشوائيًا.
          </p>
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-soft px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          إلغاء
        </Button>
        <Button size="sm" onClick={submit} disabled={pending || !valid}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          إنشاء الحساب
        </Button>
      </div>
    </Modal>
  );
}

// Reset the password for an employee who already has a dashboard account.
function ResetPasswordDialog({
  employee,
  onClose,
  onDone,
}: {
  employee: EmployeeRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState(() => generateRandomPassword());
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ email: string | null; password: string } | null>(
    null,
  );
  const [copied, setCopied] = useState<"password" | "both" | null>(null);

  function copy(value: string, kind: "password" | "both") {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(kind);
        setTimeout(() => setCopied(null), 1500);
      },
      () => toast.error("تعذر النسخ"),
    );
  }

  function submit() {
    if (password.length < 8) {
      toast.error("كلمة المرور قصيرة جدًا");
      return;
    }
    start(async () => {
      const res = await resetEmployeePasswordAction({
        employeeId: employee.id,
        password,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم تغيير كلمة المرور");
      setDone({ email: res.email, password: res.password });
    });
  }

  if (done) {
    const combined = `البريد: ${done.email ?? "—"}\nكلمة المرور: ${done.password}`;
    return (
      <Modal onClose={onDone} title={`كلمة مرور جديدة: ${employee.full_name}`}>
        <div className="space-y-3 p-4">
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
            <p className="font-semibold">تم تغيير كلمة المرور</p>
            <p className="mt-1 text-amber-200/90">
              أرسل البيانات الجديدة للموظف عبر قناة آمنة. لن تظهر مرة أخرى.
            </p>
          </div>
          {done.email && (
            <CredentialField
              label="البريد"
              value={done.email}
              onCopy={() => copy(done.email!, "both")}
              copied={false}
            />
          )}
          <CredentialField
            label="كلمة المرور الجديدة"
            value={done.password}
            mono
            onCopy={() => copy(done.password, "password")}
            copied={copied === "password"}
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-soft px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => copy(combined, "both")}>
            {copied === "both" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            نسخ الكل
          </Button>
          <Button size="sm" onClick={onDone}>
            تم
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title={`تغيير كلمة المرور: ${employee.full_name}`}>
      <div className="space-y-3 p-4">
        <div className="rounded-lg border border-soft bg-soft-1/40 p-3 text-[11px] text-muted-foreground">
          سيتم تعيين كلمة مرور جديدة لحساب{" "}
          <span className="font-medium text-foreground" dir="ltr">
            {employee.email ?? employee.full_name}
          </span>
          . لن يتأثر البريد ولا الصلاحيات.
        </div>
        <Field label="كلمة المرور الجديدة">
          <div className="flex gap-2">
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              dir="ltr"
              className="font-mono"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setPassword(generateRandomPassword())}
              disabled={pending}
              title="توليد كلمة مرور جديدة"
              aria-label="توليد كلمة مرور جديدة"
              className="rounded-lg border border-soft bg-card px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => copy(password, "password")}
              disabled={pending}
              title="نسخ"
              aria-label="نسخ كلمة المرور"
              className="rounded-lg border border-soft bg-card px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied === "password" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">8 أحرف على الأقل.</p>
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-soft px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          إلغاء
        </Button>
        <Button size="sm" onClick={submit} disabled={pending || password.length < 8}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          تغيير كلمة المرور
        </Button>
      </div>
    </Modal>
  );
}

function CredentialField({
  label,
  value,
  onCopy,
  copied,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <div
          dir="ltr"
          className={cn(
            "flex-1 select-all rounded-lg border border-soft bg-input px-3 py-2 text-sm",
            mono && "font-mono",
          )}
        >
          {value}
        </div>
        <button
          type="button"
          onClick={onCopy}
          title="نسخ"
          aria-label={`نسخ ${label}`}
          className="rounded-lg border border-soft bg-card px-2 py-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-300" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// 12-char URL-safe-ish random password generated client-side for the
// admin's convenience. Server still validates length on submit.
function generateRandomPassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  let out = "";
  for (const n of arr) out += alphabet[n % alphabet.length];
  return out;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-soft bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-soft px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
