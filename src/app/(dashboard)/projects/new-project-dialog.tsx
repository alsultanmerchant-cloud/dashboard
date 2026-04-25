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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createProjectAction, type ProjectFormState } from "./_actions";

type Option = { id: string; label: string };

export function NewProjectDialog({
  clients, services, accountManagers,
}: {
  clients: Option[];
  services: { id: string; name: string; slug: string }[];
  accountManagers: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [accountManagerId, setAccountManagerId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [generateTasks, setGenerateTasks] = useState(true);
  const [state, formAction, pending] = useActionState<ProjectFormState | undefined, FormData>(
    createProjectAction,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(`تم إنشاء المشروع${state.taskCount ? ` وتوليد ${state.taskCount} مهمة` : ""}`);
      setOpen(false);
      setClientId("");
      setAccountManagerId("");
      setPriority("medium");
      setSelectedServices(new Set());
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
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="account_manager_employee_id" value={accountManagerId} />
          <input type="hidden" name="priority" value={priority} />
          {Array.from(selectedServices).map((id) => (
            <input key={id} type="hidden" name="service_ids" value={id} />
          ))}
          <input type="hidden" name="generate_tasks" value={generateTasks ? "true" : "false"} />

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>العميل *</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر العميل" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                        : "border-white/[0.06] bg-card text-muted-foreground hover:text-foreground",
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
              <Label>الأولوية</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">منخفضة</SelectItem>
                  <SelectItem value="medium">متوسطة</SelectItem>
                  <SelectItem value="high">عالية</SelectItem>
                  <SelectItem value="urgent">عاجلة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>مدير الحساب</Label>
            <Select value={accountManagerId} onValueChange={setAccountManagerId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="اختياري — يمكن تعيينه لاحقًا" />
              </SelectTrigger>
              <SelectContent>
                {accountManagers.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Button type="submit" disabled={pending || !clientId || !formIsValid({ clientId, selectedServices })}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              إنشاء المشروع
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formIsValid({ clientId }: { clientId: string; selectedServices: Set<string> }) {
  return clientId.length > 0;
}
