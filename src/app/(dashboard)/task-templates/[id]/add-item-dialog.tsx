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
import { createTaskTemplateItemAction } from "./_actions";

export type PositionLite = { slug: string; name: string };

const SELECT_CLASS =
  "flex h-10 w-full rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input dark:text-foreground";

const PRIORITY_KEYS = ["low", "medium", "high", "urgent"] as const;

const PRIORITY_LABELS: Record<(typeof PRIORITY_KEYS)[number], string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  urgent: "عاجلة",
};

// The 8-stage Sky Light workflow — each phase carries its own responsible
// role, copied onto every task generated from this template item.
const STAGES: {
  key: string;
  label: string;
  badgeTone: string;
  rowTone: string;
}[] = [
  {
    key: "new",
    label: "جديدة",
    badgeTone: "border-slate-300 bg-slate-100 text-slate-700",
    rowTone: "border-slate-200 bg-slate-50/80",
  },
  {
    key: "in_progress",
    label: "قيد التنفيذ",
    badgeTone: "border-sky-300 bg-sky-100 text-sky-700",
    rowTone: "border-sky-200 bg-sky-50/80",
  },
  {
    key: "manager_review",
    label: "مراجعة المدير",
    badgeTone: "border-violet-300 bg-violet-100 text-violet-700",
    rowTone: "border-violet-200 bg-violet-50/80",
  },
  {
    key: "specialist_review",
    label: "مراجعة المتخصص",
    badgeTone: "border-amber-300 bg-amber-100 text-amber-700",
    rowTone: "border-amber-200 bg-amber-50/80",
  },
  {
    key: "ready_to_send",
    label: "جاهزة للإرسال",
    badgeTone: "border-teal-300 bg-teal-100 text-teal-700",
    rowTone: "border-teal-200 bg-teal-50/80",
  },
  {
    key: "sent_to_client",
    label: "أرسلت للعميل",
    badgeTone: "border-indigo-300 bg-indigo-100 text-indigo-700",
    rowTone: "border-indigo-200 bg-indigo-50/80",
  },
  {
    key: "client_changes",
    label: "تعديلات العميل",
    badgeTone: "border-rose-300 bg-rose-100 text-rose-700",
    rowTone: "border-rose-200 bg-rose-50/80",
  },
  {
    key: "done",
    label: "مكتملة",
    badgeTone: "border-emerald-300 bg-emerald-100 text-emerald-700",
    rowTone: "border-emerald-200 bg-emerald-50/80",
  },
];

type DepartmentOpt = { id: string; name: string };

export function AddTemplateItemDialog({
  templateId,
  departments,
  positions,
}: {
  templateId: string;
  departments: DepartmentOpt[];
  positions: PositionLite[];
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
  const [stageOwners, setStageOwners] = useState<Record<string, string>>({});

  const reset = () => {
    setTitle("");
    setDescription("");
    setRole("");
    setDepartmentId("");
    setOffset("0");
    setDuration("1");
    setPriority("medium");
    setStageOwners({});
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
          role && positions.some((p) => p.slug === role) ? role : null,
        default_department_id: departmentId || null,
        offset_days_from_project_start: Number(offset) || 0,
        duration_days: Math.max(1, Number(duration) || 1),
        priority,
        // Omit entirely when untouched so the column default applies.
        stage_owner_positions: STAGES.some((s) => stageOwners[s.key])
          ? Object.fromEntries(
              STAGES.map((s) => [s.key, stageOwners[s.key] || null]),
            )
          : null,
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
                  {positions.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
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
            <div className="space-y-1.5 rounded-lg border border-soft bg-soft-1/40 p-3">
              <Label>الدور المسؤول عن كل مرحلة</Label>
              <p className="text-[11px] text-muted-foreground">
                يُحدَّد لكل مرحلة الدور المسؤول عنها، ويُنسخ تلقائيًا إلى كل
                مهمة تُنشأ من هذا القالب. اتركها فارغة لاستخدام الإعداد
                الافتراضي.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {STAGES.map((s) => (
                  <div
                    key={s.key}
                    className={`grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-2 rounded-xl border p-2 ${s.rowTone}`}
                  >
                    <span
                      className={`inline-flex min-w-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold text-start ${s.badgeTone}`}
                    >
                      {s.label}
                    </span>
                    <select
                      className={SELECT_CLASS + " h-9 w-full"}
                      value={stageOwners[s.key] ?? ""}
                      onChange={(e) =>
                        setStageOwners((m) => ({
                          ...m,
                          [s.key]: e.target.value,
                        }))
                      }
                      disabled={pending}
                      aria-label={`الدور المسؤول عن مرحلة ${s.label}`}
                    >
                      <option value="">— بدون —</option>
                      {positions.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                    </select>
                  </div>
                ))}
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
