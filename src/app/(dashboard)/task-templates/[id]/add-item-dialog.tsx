"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROLE_LABELS } from "@/lib/labels";
import { createTaskTemplateItemAction } from "./_actions";

const SELECT_CLASS =
  "flex h-10 w-full rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const ROLE_KEYS = [
  "specialist",
  "manager",
  "agent",
  "account_manager",
  "supporting_lead",
  "supporting_agent",
] as const;

const PRIORITY_KEYS = ["low", "medium", "high", "urgent"] as const;

const PRIORITY_LABELS: Record<(typeof PRIORITY_KEYS)[number], string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  urgent: "عاجلة",
};

type DepartmentOpt = { id: string; name: string };

export function AddTemplateItemDialog({
  templateId,
  departments,
}: {
  templateId: string;
  departments: DepartmentOpt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState<string>("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [offset, setOffset] = useState<string>("0");
  const [duration, setDuration] = useState<string>("1");
  const [priority, setPriority] =
    useState<(typeof PRIORITY_KEYS)[number]>("medium");

  const reset = () => {
    setTitle("");
    setDescription("");
    setRole("");
    setDepartmentId("");
    setOffset("0");
    setDuration("1");
    setPriority("medium");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      if (title.trim().length < 2) {
        toast.error("اكتب عنوان المهمة");
        return;
      }
      const res = await createTaskTemplateItemAction({
        templateId,
        title: title.trim(),
        description: description.trim() || null,
        default_role_key:
          role && (ROLE_KEYS as readonly string[]).includes(role)
            ? (role as (typeof ROLE_KEYS)[number])
            : null,
        default_department_id: departmentId || null,
        offset_days_from_project_start: Number(offset) || 0,
        duration_days: Math.max(1, Number(duration) || 1),
        priority,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("أُضيفت مهمة القالب");
      reset();
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        إضافة مهمة قالب
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) reset();
          setOpen(v);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>مهمة قالب جديدة</DialogTitle>
            <DialogDescription>
              ستُنشأ هذه المهمة تلقائيًا مع كل مشروع جديد يستخدم هذا القالب.
              تطابق النمط في Odoo (project.category → task_ids).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="item_title">عنوان المهمة *</Label>
              <Input
                id="item_title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: تصميم منشور الإطلاق"
                maxLength={200}
                disabled={pending}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item_description">الوصف</Label>
              <Textarea
                id="item_description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="item_dept">القسم المسؤول</Label>
                <select
                  id="item_dept"
                  className={SELECT_CLASS}
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  disabled={pending}
                >
                  <option value="">— بدون —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item_role">الدور المسؤول</Label>
                <select
                  id="item_role"
                  className={SELECT_CLASS}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  disabled={pending}
                >
                  <option value="">— بدون —</option>
                  {ROLE_KEYS.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r] ?? r}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="item_offset">الإزاحة من بداية المشروع (يوم)</Label>
                <Input
                  id="item_offset"
                  type="number"
                  min={0}
                  value={offset}
                  onChange={(e) => setOffset(e.target.value)}
                  disabled={pending}
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item_duration">المدة (يوم)</Label>
                <Input
                  id="item_duration"
                  type="number"
                  min={1}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  disabled={pending}
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item_priority">الأولوية</Label>
                <select
                  id="item_priority"
                  className={SELECT_CLASS}
                  value={priority}
                  onChange={(e) =>
                    setPriority(
                      e.target.value as (typeof PRIORITY_KEYS)[number],
                    )
                  }
                  disabled={pending}
                >
                  {PRIORITY_KEYS.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
