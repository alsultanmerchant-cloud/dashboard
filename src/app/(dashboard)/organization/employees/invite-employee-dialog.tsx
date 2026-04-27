"use client";

import { useState, useActionState, useEffect } from "react";
import { UserPlus, Loader2, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { inviteEmployeeAction, type EmployeeInviteState } from "./_actions";
import { DEPARTMENT_KIND_LABELS, type DepartmentKind } from "@/lib/labels";

type Option = { id: string; label: string };
type DepartmentOption = Option & {
  kind: DepartmentKind;
  parent_department_id: string | null;
};

export function InviteEmployeeDialog({
  departments, roles,
}: {
  departments: DepartmentOption[];
  roles: Option[];
}) {
  // Group leaf departments under their parent group; back-office "other"
  // and standalone kinds (account_management, quality_control) are bucketed
  // under their own DEPARTMENT_KIND_LABELS heading. Skips "group" rows
  // themselves — those are headings, not assignable departments.
  const departmentGroups = (() => {
    const groupNameById = new Map<string, string>();
    for (const d of departments) {
      if (d.kind === "group") groupNameById.set(d.id, d.label);
    }
    const buckets = new Map<string, { label: string; items: DepartmentOption[] }>();
    for (const d of departments) {
      if (d.kind === "group") continue;
      const heading = d.parent_department_id
        ? groupNameById.get(d.parent_department_id) ?? DEPARTMENT_KIND_LABELS[d.kind]
        : DEPARTMENT_KIND_LABELS[d.kind];
      const bucket = buckets.get(heading) ?? { label: heading, items: [] };
      bucket.items.push(d);
      buckets.set(heading, bucket);
    }
    return Array.from(buckets.values());
  })();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<EmployeeInviteState | undefined, FormData>(
    inviteEmployeeAction,
    undefined,
  );
  const [credsOpen, setCredsOpen] = useState(false);
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state?.ok && state.generatedPassword) {
      const form = document.querySelector<HTMLFormElement>("form#invite-employee-form");
      const email = (form?.elements.namedItem("email") as HTMLInputElement)?.value ?? "";
      setCreds({ email, password: state.generatedPassword });
      setCredsOpen(true);
      setOpen(false);
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button />}>
          <UserPlus />
          دعوة موظف
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>دعوة موظف جديد</DialogTitle>
            <DialogDescription>سيتم إنشاء حساب وصول وكلمة مرور تُعرض مرة واحدة فقط للنسخ.</DialogDescription>
          </DialogHeader>
          <form id="invite-employee-form" action={formAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="emp_name">الاسم الكامل *</Label>
              <Input id="emp_name" name="full_name" required placeholder="مثال: نورة المالكي" aria-invalid={!!state?.fieldErrors?.full_name} />
              {state?.fieldErrors?.full_name && <p className="text-xs text-cc-red">{state.fieldErrors.full_name}</p>}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="emp_email">البريد الإلكتروني *</Label>
                <Input id="emp_email" name="email" type="email" required dir="ltr" placeholder="name@agency.com" aria-invalid={!!state?.fieldErrors?.email} />
                {state?.fieldErrors?.email && <p className="text-xs text-cc-red">{state.fieldErrors.email}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp_phone">الهاتف</Label>
                <Input id="emp_phone" name="phone" placeholder="+966 5x xxx xxxx" dir="ltr" />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="emp_title">المسمى الوظيفي</Label>
                <Input id="emp_title" name="job_title" placeholder="مثال: مدير حساب" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp_dept">القسم</Label>
                <select
                  id="emp_dept"
                  name="department_id"
                  defaultValue=""
                  className="flex h-10 w-full rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">— غير محدد —</option>
                  {departmentGroups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((d) => (
                        <option key={d.id} value={d.id}>{d.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp_role">الدور *</Label>
              <select
                id="emp_role"
                name="role_id"
                required
                defaultValue=""
                className="flex h-10 w-full rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="" disabled>اختر دورًا</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              {state?.fieldErrors?.role_id && <p className="text-xs text-cc-red">{state.fieldErrors.role_id}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                إنشاء الحساب
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={credsOpen} onOpenChange={setCredsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-cc-green" />
              تم إنشاء الحساب
            </DialogTitle>
            <DialogDescription>
              انسخ كلمة المرور الآن — لن تظهر مرة أخرى. شارِكها مع الموظف بقناة آمنة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>البريد</Label>
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-2.5 font-mono text-sm" dir="ltr">
                {creds?.email}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>كلمة المرور</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg border border-cyan/30 bg-cyan-dim p-2.5 font-mono text-sm text-cyan" dir="ltr">
                  {creds?.password}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    if (!creds?.password) return;
                    navigator.clipboard.writeText(creds.password);
                    setCopied(true);
                    toast.success("تم النسخ");
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <CheckCircle2 className="size-4 text-cc-green" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setCredsOpen(false)}>تم</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
