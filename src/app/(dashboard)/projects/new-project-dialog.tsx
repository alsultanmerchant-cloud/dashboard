"use client";

import { useState, useActionState, useEffect } from "react";
import { Plus, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { createProjectAction, type ProjectFormState } from "./_actions";

type Option = { id: string; label: string };

const SELECT_CLASS =
  "flex h-10 w-full rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function NewProjectDialog({
  clients, services, accountManagers,
}: {
  clients: Option[];
  services: { id: string; name: string; slug: string }[];
  accountManagers: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [generateTasks, setGenerateTasks] = useState(true);
  const [state, formAction, pending] = useActionState<ProjectFormState | undefined, FormData>(
    createProjectAction,
    undefined,
  );
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (state?.ok) {
      toast.success(`تم إنشاء المشروع${state.taskCount ? ` وتوليد ${state.taskCount} مهمة` : ""}`);
      setOpen(false);
      setSelectedServices(new Set());
      setResetKey((k) => k + 1);
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  const toggleService = (id: string) =>
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        مشروع جديد
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>مشروع جديد</DialogTitle>
          <DialogDescription>اختر العميل والخدمات. ستُولَّد المهام تلقائيًا من قوالب الخدمات المحددة.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3" key={resetKey}>
          {Array.from(selectedServices).map((id) => (
            <input key={id} type="hidden" name="service_ids" value={id} />
          ))}
          <input type="hidden" name="generate_tasks" value={generateTasks ? "true" : "false"} />

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="proj_client">العميل *</Label>
              <select id="proj_client" name="client_id" required defaultValue="" className={SELECT_CLASS}>
                <option value="" disabled>اختر العميل</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
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

          <div className="space-y-1.5">
            <Label>الخدمات المتفق عليها</Label>
            <div className="grid sm:grid-cols-3 gap-2">
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
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start_date">تاريخ البدء</Label>
              <Input id="start_date" name="start_date" type="date" dir="ltr" />
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
              {accountManagers.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">وصف المشروع</Label>
            <Textarea id="description" name="description" rows={2} placeholder="ملخص قصير عن المشروع…" />
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-cyan/15 bg-cyan-dim/40 px-3 py-2.5 text-xs text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={generateTasks}
              onChange={(e) => setGenerateTasks(e.target.checked)}
              className="size-3.5 accent-cyan"
            />
            توليد المهام تلقائيًا من قوالب الخدمات المحددة
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="submit" disabled={pending || selectedServices.size === 0}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              إنشاء المشروع
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
