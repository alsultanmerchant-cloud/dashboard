"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil } from "lucide-react";
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
import { updateTaskTemplateItemAction } from "./_actions";

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

export type EditableTemplateItem = {
  id: string;
  title: string;
  description: string | null;
  default_role_key: string | null;
  default_department_id: string | null;
  offset_days_from_project_start: number;
  duration_days: number;
  priority: (typeof PRIORITY_KEYS)[number];
};

// #10: edit an existing template item in place — Rwasem's project.category
// task tree is editable; ours was add/delete-only.
export function EditTemplateItemDialog({
  item,
  departments,
}: {
  item: EditableTemplateItem;
  departments: DepartmentOpt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [role, setRole] = useState<string>(item.default_role_key ?? "");
  const [departmentId, setDepartmentId] = useState<string>(
    item.default_department_id ?? "",
  );
  const [offset, setOffset] = useState<string>(
    String(item.offset_days_from_project_start),
  );
  const [duration, setDuration] = useState<string>(String(item.duration_days));
  const [priority, setPriority] = useState<(typeof PRIORITY_KEYS)[number]>(
    item.priority,
  );

  // Re-sync local state to the row whenever the dialog is (re)opened so a
  // stale edit from a prior cancel never lingers.
  const resetToItem = () => {
    setTitle(item.title);
    setDescription(item.description ?? "");
    setRole(item.default_role_key ?? "");
    setDepartmentId(item.default_department_id ?? "");
    setOffset(String(item.offset_days_from_project_start));
    setDuration(String(item.duration_days));
    setPriority(item.priority);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      if (title.trim().length < 2) {
        toast.error("اكتب عنوان المهمة");
        return;
      }
      const res = await updateTaskTemplateItemAction({
        itemId: item.id,
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
      toast.success("حُدّثت مهمة القالب");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          resetToItem();
          setOpen(true);
        }}
        aria-label={`تعديل ${item.title}`}
      >
        <Pencil className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>تعديل مهمة القالب</DialogTitle>
            <DialogDescription>
              تُطبَّق التعديلات على المشاريع الجديدة التي تُنشأ من هذا القالب.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit_item_title">عنوان المهمة *</Label>
              <Input
                id="edit_item_title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                disabled={pending}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_item_description">الوصف</Label>
              <Textarea
                id="edit_item_description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit_item_dept">القسم المسؤول</Label>
                <select
                  id="edit_item_dept"
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
                <Label htmlFor="edit_item_role">الدور المسؤول</Label>
                <select
                  id="edit_item_role"
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
                <Label htmlFor="edit_item_offset">
                  الإزاحة من بداية المشروع (يوم)
                </Label>
                <Input
                  id="edit_item_offset"
                  type="number"
                  min={0}
                  value={offset}
                  onChange={(e) => setOffset(e.target.value)}
                  disabled={pending}
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit_item_duration">المدة (يوم)</Label>
                <Input
                  id="edit_item_duration"
                  type="number"
                  min={1}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  disabled={pending}
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit_item_priority">الأولوية</Label>
                <select
                  id="edit_item_priority"
                  className={SELECT_CLASS}
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as (typeof PRIORITY_KEYS)[number])
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
                حفظ التعديلات
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
