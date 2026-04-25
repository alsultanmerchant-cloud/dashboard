"use client";

import { useState, useEffect } from "react";
import { fetchEmployees, createEmployee, updateEmployee, deleteEmployee, fetchDeals, fetchTickets } from "@/lib/supabase/db";
import { useAuth } from "@/lib/auth-context";
import { EMPLOYEE_STATUSES } from "@/lib/utils/constants";
import { StatCard } from "@/components/ui/stat-card";
import { ColorBadge } from "@/components/ui/color-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Employee, Deal, Ticket } from "@/types";
import { Users, UserPlus, Pencil, Trash2, TrendingUp, Headphones, Calendar } from "lucide-react";
import { formatMoney } from "@/lib/utils/format";

/* ---------- helpers ---------- */

const STATUS_COLOR: Record<string, "green" | "amber" | "blue" | "red"> = {
  "نشط": "green",
  "مشغول": "amber",
  "متاح": "blue",
  "إجازة": "red",
};

function workloadColor(pct: number): string {
  if (pct > 85) return "bg-cc-red";
  if (pct >= 70) return "bg-amber";
  return "bg-cc-green";
}

function workloadTextColor(pct: number): string {
  if (pct > 85) return "text-cc-red";
  if (pct >= 70) return "text-amber";
  return "text-cc-green";
}

/* ---------- page ---------- */

export default function TeamPage() {
  const { activeOrgId: orgId } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<"day" | "week" | "month" | "all">("all");

  /* delete confirmation */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  /* form state */
  const [formName, setFormName] = useState("");
  const [formRole, setFormRole] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formStatus, setFormStatus] = useState<string>("نشط");

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchEmployees(), fetchDeals(), fetchTickets()])
      .then(([e, d, t]) => {
        setEmployees(e);
        setDeals(d);
        setTickets(t);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [orgId]);

  /* Period date range */
  const periodRange = (() => {
    if (periodFilter === "all") return null;
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    if (periodFilter === "day") return today;
    if (periodFilter === "week") {
      const dayOfWeek = now.getDay();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      return weekStart.toISOString().split("T")[0];
    }
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  })();

  /* Filter deals & tickets by period */
  const periodDeals = periodRange
    ? deals.filter((d) => (d.deal_date || d.created_at.split("T")[0]) >= periodRange)
    : deals;
  const periodTickets = periodRange
    ? tickets.filter((t) => (t.open_date || t.created_at.split("T")[0]) >= periodRange)
    : tickets;

  /* Stats per employee — trim names to handle whitespace mismatches */
  function getEmployeeStats(empName: string) {
    const name = empName.trim();
    const empDeals = periodDeals.filter((d) => d.assigned_rep_name?.trim() === name);
    const closedDeals = empDeals.filter((d) => d.stage === "مكتملة");
    const empTickets = periodTickets.filter((t) => t.assigned_agent_name?.trim() === name);
    const resolvedTickets = empTickets.filter((t) => t.status === "محلول");
    return {
      totalDeals: empDeals.length,
      closedDeals: closedDeals.length,
      dealsValue: closedDeals.reduce((s, d) => s + d.deal_value, 0),
      totalTickets: empTickets.length,
      resolvedTickets: resolvedTickets.length,
    };
  }

  const openAddModal = () => {
    setEditingEmployee(null);
    setFormName("");
    setFormRole("");
    setFormEmail("");
    setFormPhone("");
    setFormStatus("نشط");
    setModalOpen(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmployee(emp);
    setFormName(emp.name);
    setFormRole(emp.role || "");
    setFormEmail(emp.email || "");
    setFormPhone(emp.phone || "");
    setFormStatus(emp.status);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      if (editingEmployee) {
        const updated = await updateEmployee(editingEmployee.id, {
          name: formName,
          role: formRole,
          email: formEmail,
          phone: formPhone,
          status: formStatus,
        });
        setEmployees((prev) =>
          prev.map((e) => (e.id === editingEmployee.id ? updated : e))
        );
      } else {
        const created = await createEmployee({
          name: formName,
          role: formRole,
          email: formEmail,
          phone: formPhone,
          status: formStatus,
        });
        setEmployees((prev) => [...prev, created]);
      }
      setModalOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  function confirmDelete(id: string) {
    setDeleteId(id);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (deleteId) {
      try {
        await deleteEmployee(deleteId);
        setEmployees((prev) => prev.filter((e) => e.id !== deleteId));
      } catch (err) {
        console.error(err);
      }
    }
    setDeleteOpen(false);
    setDeleteId(null);
  }

  /* counts */
  const activeCount = employees.filter((e) => e.status === "نشط").length;
  const busyCount = employees.filter((e) => e.status === "مشغول").length;

  /* card filter */
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [nameSearch, setNameSearch] = useState("");
  const statusFilteredEmployees = statusFilter
    ? employees.filter((e) => e.status === statusFilter)
    : employees;
  const filteredEmployees = nameSearch
    ? statusFilteredEmployees.filter((e) => e.name.toLowerCase().includes(nameSearch.toLowerCase()))
    : statusFilteredEmployees;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-dim flex items-center justify-center">
            <Users className="w-4 h-4 text-cyan" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">
              {employees.length} عضو في الفريق
            </h1>
            <p className="text-xs text-muted-foreground">
              {activeCount} نشط &bull; {busyCount} مشغول
            </p>
          </div>
        </div>
        <Button onClick={openAddModal} className="gap-1.5">
          <UserPlus className="w-4 h-4" />
          إضافة عضو
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <TeamStatSkeleton key={index} />)
        ) : (
          <>
            <StatCard
              value={String(employees.length)}
              label="إجمالي الفريق"
              color="cyan"
              icon={<Users className="w-4 h-4 text-cyan" />}
              onClick={() => setStatusFilter(null)}
              active={statusFilter === null}
            />
            <StatCard
              value={String(activeCount)}
              label="أعضاء نشطين"
              color="green"
              onClick={() => setStatusFilter(statusFilter === "نشط" ? null : "نشط")}
              active={statusFilter === "نشط"}
            />
            <StatCard
              value={String(busyCount)}
              label="مشغول"
              color="amber"
              onClick={() => setStatusFilter(statusFilter === "مشغول" ? null : "مشغول")}
              active={statusFilter === "مشغول"}
            />
            <StatCard
              value={String(employees.filter((e) => e.status === "إجازة").length)}
              label="إجازة"
              color="red"
              onClick={() => setStatusFilter(statusFilter === "إجازة" ? null : "إجازة")}
              active={statusFilter === "إجازة"}
            />
          </>
        )}
      </div>

      {/* Period filter + Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-white/[0.03] rounded-xl p-1 border border-white/[0.06]">
          <Calendar className="w-4 h-4 text-muted-foreground mr-1.5 ml-1" />
          {([
            { key: "all" as const, label: "الكل" },
            { key: "day" as const, label: "اليوم" },
            { key: "week" as const, label: "الأسبوع" },
            { key: "month" as const, label: "الشهر" },
          ]).map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriodFilter(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                periodFilter === p.key
                  ? "bg-cyan/15 text-cyan border border-cyan/30"
                  : "text-muted-foreground hover:text-foreground border border-transparent"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Input
          value={nameSearch}
          onChange={(e) => setNameSearch(e.target.value)}
          placeholder="ابحث باسم العضو..."
          className="max-w-xs"
        />
      </div>

      {/* Team Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <TeamCardSkeleton key={index} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEmployees.map((emp) => {
            const stats = getEmployeeStats(emp.name);
            const initial = emp.name.charAt(0);
            const hasActivity = stats.totalDeals > 0 || stats.totalTickets > 0;

            return (
              <div
                key={emp.id}
                className="cc-card rounded-xl p-5 space-y-4"
              >
                {/* Top: avatar + info */}
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-full border-2 border-cyan bg-cyan-dim flex items-center justify-center text-cyan font-bold text-base shrink-0">
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">
                      {emp.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {emp.role}
                    </p>
                  </div>
                  <ColorBadge
                    text={emp.status}
                    color={STATUS_COLOR[emp.status] || "blue"}
                  />
                </div>

                {/* Performance Stats */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Sales stats */}
                  <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <TrendingUp className="w-3.5 h-3.5 text-cc-green" />
                      <span className="text-[10px] text-muted-foreground">المبيعات</span>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <span className="text-lg font-bold text-cc-green">{stats.closedDeals}</span>
                        <span className="text-[10px] text-muted-foreground mr-1">/ {stats.totalDeals}</span>
                      </div>
                    </div>
                    {stats.dealsValue > 0 && (
                      <p className="text-[10px] text-cyan font-semibold mt-1">{formatMoney(stats.dealsValue)}</p>
                    )}
                  </div>
                  {/* Support stats */}
                  <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Headphones className="w-3.5 h-3.5 text-cc-purple" />
                      <span className="text-[10px] text-muted-foreground">الدعم</span>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <span className="text-lg font-bold text-cc-purple">{stats.resolvedTickets}</span>
                        <span className="text-[10px] text-muted-foreground mr-1">/ {stats.totalTickets}</span>
                      </div>
                    </div>
                    {stats.totalTickets > 0 && (
                      <p className="text-[10px] text-amber font-semibold mt-1">
                        {stats.totalTickets > 0 ? Math.round((stats.resolvedTickets / stats.totalTickets) * 100) : 0}% حل
                      </p>
                    )}
                  </div>
                </div>

                {/* Activity bar */}
                {hasActivity && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] text-muted-foreground">الإنجاز</span>
                      <span className="text-[10px] font-bold text-cyan">
                        {stats.closedDeals + stats.resolvedTickets} منجز
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden flex">
                      {stats.closedDeals > 0 && (
                        <div
                          className="h-full bg-cc-green transition-all"
                          style={{ width: `${(stats.closedDeals / (stats.closedDeals + stats.resolvedTickets)) * 100}%` }}
                        />
                      )}
                      {stats.resolvedTickets > 0 && (
                        <div
                          className="h-full bg-cc-purple transition-all"
                          style={{ width: `${(stats.resolvedTickets / (stats.closedDeals + stats.resolvedTickets)) * 100}%` }}
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
                        <span className="w-2 h-2 rounded-full bg-cc-green" /> مبيعات
                      </span>
                      <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
                        <span className="w-2 h-2 rounded-full bg-cc-purple" /> دعم
                      </span>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 gap-1 text-xs"
                    onClick={() => openEditModal(emp)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    تعديل
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1 gap-1 text-xs"
                    onClick={() => confirmDelete(emp.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    حذف
                  </Button>
                </div>
              </div>
            );
          })}
          {employees.length === 0 && (
            <div className="col-span-3 text-center text-muted-foreground py-12">
              لا يوجد أعضاء في الفريق
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>تأكيد الحذف</DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف هذا العضو؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              إلغاء
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              حذف العضو
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingEmployee ? "تعديل العضو" : "إضافة عضو جديد"}
            </DialogTitle>
            <DialogDescription>
              {editingEmployee ? "قم بتحديث بيانات العضو" : "أدخل بيانات العضو الجديد"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>الاسم</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="اسم العضو"
              />
            </div>

            <div className="space-y-1.5">
              <Label>الدور</Label>
              <Input
                value={formRole}
                onChange={(e) => setFormRole(e.target.value)}
                placeholder="المسمى الوظيفي"
              />
            </div>

            <div className="space-y-1.5">
              <Label>البريد الإلكتروني</Label>
              <Input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="example@company.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label>الجوال</Label>
              <Input
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="05xxxxxxxx"
              />
            </div>

            <div className="space-y-1.5">
              <Label>الحالة</Label>
              <Select value={formStatus} onValueChange={(v) => v && setFormStatus(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "جاري الحفظ..." : editingEmployee ? "حفظ التعديلات" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TeamStatSkeleton() {
  return (
    <div className="cc-card rounded-xl p-4 border-t-2 border-t-muted">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-10" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="w-9 h-9 rounded-lg" />
      </div>
    </div>
  );
}

function TeamCardSkeleton() {
  return (
    <div className="cc-card rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Skeleton className="w-11 h-11 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <Skeleton className="h-8 flex-1 rounded-lg" />
        <Skeleton className="h-8 flex-1 rounded-lg" />
      </div>
    </div>
  );
}
