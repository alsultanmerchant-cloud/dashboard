"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { Shield, Plus, Pencil, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// All available pages with Arabic labels
const ALL_PAGES = [
  { slug: "dashboard", label: "نظرة عامة" },
  { slug: "sales", label: "المبيعات" },
  { slug: "renewals", label: "التجديدات" },
  { slug: "satisfaction", label: "رضا العملاء" },
  { slug: "support", label: "الدعم" },
  { slug: "development", label: "التطويرات" },
  { slug: "partnerships", label: "الشراكات" },
  { slug: "team", label: "الفريق" },
  { slug: "finance", label: "المالية" },
  { slug: "upload", label: "رفع البيانات" },
  { slug: "agent", label: "المساعد الذكي" },
];

interface UserProfile {
  id: string;
  email: string;
  name: string;
  org_id: string;
  role_id: string;
  is_super_admin: boolean;
  roles: { id: string; name: string; slug: string; allowed_pages: string[] };
  organizations: { name: string; name_ar: string };
}

export default function UsersPage() {
  const { user, orgs } = useAuth();
  const router = useRouter();

  // Redirect non-super-admin
  useEffect(() => {
    if (user && !user.isSuperAdmin) {
      router.replace("/dashboard");
    }
  }, [user, router]);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // User dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userOrgId, setUserOrgId] = useState("");
  const [userPages, setUserPages] = useState<string[]>(["dashboard"]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Expanded user (to show pages inline)
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user?.isSuperAdmin) fetchData();
  }, [user, fetchData]);

  function openDialog(u?: UserProfile) {
    setFormError("");
    if (u) {
      setEditingUser(u);
      setUserName(u.name);
      setUserEmail(u.email);
      setUserPassword("");
      setUserOrgId(u.org_id);
      setUserPages(u.roles?.allowed_pages || ["dashboard"]);
    } else {
      setEditingUser(null);
      setUserName("");
      setUserEmail("");
      setUserPassword("");
      setUserOrgId(orgs[0]?.id || "");
      setUserPages(["dashboard"]);
    }
    setDialogOpen(true);
  }

  async function saveUser() {
    setSaving(true);
    setFormError("");

    const body: Record<string, unknown> = {
      name: userName,
      email: userEmail,
      org_id: userOrgId,
      allowed_pages: userPages,
    };

    if (!editingUser) {
      body.password = userPassword;
    }

    const url = editingUser ? `/api/users/${editingUser.id}` : "/api/users";
    const method = editingUser ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setDialogOpen(false);
      fetchData();
    } else {
      const data = await res.json().catch(() => ({}));
      setFormError(data.error || "حدث خطأ أثناء الحفظ");
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/users/${deleteTarget.id}`, { method: "DELETE" });
    if (res.ok) {
      setDeleteOpen(false);
      setDeleteTarget(null);
      fetchData();
    }
    setDeleting(false);
  }

  function togglePage(slug: string) {
    setUserPages((prev) =>
      prev.includes(slug) ? prev.filter((p) => p !== slug) : [...prev, slug]
    );
  }

  function getPageLabel(slug: string) {
    return ALL_PAGES.find((p) => p.slug === slug)?.label || slug;
  }

  if (!user?.isSuperAdmin) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-dim">
            <Shield className="w-5 h-5 text-cyan" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">إدارة المستخدمين</h2>
            <p className="text-sm text-muted-foreground">إنشاء المستخدمين وتحديد صلاحياتهم</p>
          </div>
        </div>
        <Button onClick={() => openDialog()}>
          <Plus className="w-4 h-4 ml-1.5" />
          مستخدم جديد
        </Button>
      </div>

      {/* Users list */}
      <div className="rounded-2xl border border-white/6 bg-white/[0.02] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">جاري التحميل...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">لا يوجد مستخدمون</div>
        ) : (
          <div className="divide-y divide-white/6">
            {users.map((u) => {
              const isExpanded = expandedUserId === u.id;
              const pages = u.roles?.allowed_pages || [];
              return (
                <div key={u.id}>
                  <div
                    className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer"
                    onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                  >
                    <div className="w-9 h-9 rounded-xl bg-cyan-dim flex items-center justify-center text-cyan text-xs font-bold ring-1 ring-cyan/20 shrink-0">
                      {u.name?.[0] || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{u.name}</p>
                        {u.is_super_admin && (
                          <Badge variant="outline" className="text-[10px] border-cyan/30 text-cyan">مدير عام</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">{u.email}</span>
                        <span className="text-white/10 hidden sm:inline">·</span>
                        <span className="text-[11px] text-muted-foreground hidden sm:inline">{u.organizations?.name_ar}</span>
                        <span className="text-white/10 hidden sm:inline">·</span>
                        <span className="text-[11px] text-cyan/70 hidden sm:inline">
                          {u.is_super_admin ? "كل الصفحات" : `${pages.length} صفحة`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); openDialog(u); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {u.id !== user?.id && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({ id: u.id, name: u.name });
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </Button>
                      )}
                      <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform mr-1", isExpanded && "rotate-180")} />
                    </div>
                  </div>

                  {/* Expanded: show page permissions */}
                  {isExpanded && (
                    <div className="px-4 sm:px-5 pb-3 pt-0">
                      <div className="rounded-xl bg-white/[0.02] border border-white/6 p-3">
                        <p className="text-[11px] text-muted-foreground mb-2">الصفحات المسموح بها:</p>
                        {u.is_super_admin ? (
                          <p className="text-xs text-cyan">كل الصفحات (مدير عام)</p>
                        ) : pages.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {pages.map((slug) => (
                              <span
                                key={slug}
                                className="text-[11px] bg-cyan/10 text-cyan border border-cyan/20 rounded-lg px-2 py-1"
                              >
                                {getPageLabel(slug)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">لا توجد صلاحيات</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============ USER DIALOG ============ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingUser ? "تعديل المستخدم" : "مستخدم جديد"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "تعديل بيانات المستخدم وصلاحياته" : "إنشاء مستخدم جديد وتحديد الصفحات المسموح بها"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>الاسم</Label>
              <Input
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="اسم المستخدم"
              />
            </div>

            <div className="space-y-1.5">
              <Label>البريد الإلكتروني</Label>
              <Input
                type="email"
                dir="ltr"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </div>

            {!editingUser && (
              <div className="space-y-1.5">
                <Label>كلمة المرور</Label>
                <Input
                  type="password"
                  dir="ltr"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>المنظمة</Label>
              <Select value={userOrgId} onValueChange={(v) => v && setUserOrgId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر المنظمة">
                    {orgs.find((o) => o.id === userOrgId)?.nameAr || "اختر المنظمة"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.nameAr}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Page permissions — directly in user dialog */}
            <div className="space-y-2">
              <Label>الصفحات المسموح بها</Label>
              <div className="grid grid-cols-3 gap-2">
                {ALL_PAGES.map((page) => (
                  <button
                    key={page.slug}
                    type="button"
                    onClick={() => togglePage(page.slug)}
                    className={cn(
                      "rounded-xl border px-2.5 py-2 text-xs font-medium transition-all text-right",
                      userPages.includes(page.slug)
                        ? "bg-cyan/15 border-cyan/30 text-cyan"
                        : "bg-white/[0.02] border-white/6 text-muted-foreground hover:bg-white/[0.04]"
                    )}
                  >
                    {page.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                المستخدم سيتمكن فقط من رؤية الصفحات المحددة
              </p>
            </div>

            {formError && (
              <p className="text-sm text-red-400 bg-red-500/10 rounded-xl px-3 py-2 border border-red-500/20">
                {formError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={saveUser}
              disabled={saving || !userName || !userEmail || !userOrgId || userPages.length === 0 || (!editingUser && !userPassword)}
            >
              {saving ? "جاري الحفظ..." : editingUser ? "حفظ التعديلات" : "إنشاء المستخدم"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ DELETE DIALOG ============ */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>تأكيد الحذف</DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف المستخدم &quot;{deleteTarget?.name}&quot;؟
              لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>إلغاء</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "جاري الحذف..." : "حذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
