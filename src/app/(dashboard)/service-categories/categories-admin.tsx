"use client";

import { useState, useTransition, useActionState, useEffect } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Pencil, Power } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { CategoryListRow } from "@/lib/data/service-categories";
import { reorderCategoryAction, upsertCategoryAction, type CategoryActionState } from "./_actions";

const SELECT_CLASS =
  "flex h-10 w-full rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type ServiceOpt = { id: string; name: string; slug: string };

export function CategoriesAdmin({
  categories, services,
}: {
  categories: CategoryListRow[];
  services: ServiceOpt[];
}) {
  const [editing, setEditing] = useState<CategoryListRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus />
          إضافة تصنيف
        </Button>
      </div>

      {categories.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-white/[0.06]">
              {categories.map((c, i) => (
                <CategoryRow
                  key={c.id}
                  cat={c}
                  isFirst={i === 0}
                  isLast={i === categories.length - 1}
                  onEdit={() => setEditing(c)}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <CategoryDialog
        open={creating || editing !== null}
        category={editing}
        services={services}
        onClose={() => { setCreating(false); setEditing(null); }}
      />
    </div>
  );
}

function CategoryRow({
  cat, isFirst, isLast, onEdit,
}: {
  cat: CategoryListRow;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const move = (direction: "up" | "down") => {
    startTransition(async () => {
      const r = await reorderCategoryAction({ id: cat.id, direction });
      if (r?.error) toast.error(r.error);
      else router.refresh();
    });
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3 text-sm">
      <div className="flex flex-col">
        <button
          type="button"
          aria-label="تحريك للأعلى"
          onClick={() => move("up")}
          disabled={isFirst || pending}
          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-soft-2 disabled:opacity-30 transition-colors"
        >
          <ArrowUp className="size-3" />
        </button>
        <button
          type="button"
          aria-label="تحريك للأسفل"
          onClick={() => move("down")}
          disabled={isLast || pending}
          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-soft-2 disabled:opacity-30 transition-colors"
        >
          <ArrowDown className="size-3" />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{cat.name_ar}</span>
          {!cat.is_active && (
            <span className="rounded-full border border-soft px-1.5 py-0.5 text-[10px] text-muted-foreground">
              معطّل
            </span>
          )}
          <span className="text-[11px] text-muted-foreground" dir="ltr">{cat.key}</span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {cat.service_name ?? "بدون خدمة افتراضية"} · {cat.template_count} قالب
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onEdit}>
        <Pencil className="size-3.5" />
        تعديل
      </Button>
    </li>
  );
}

function CategoryDialog({
  open, category, services, onClose,
}: {
  open: boolean;
  category: CategoryListRow | null;
  services: ServiceOpt[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<CategoryActionState | undefined, FormData>(
    upsertCategoryAction,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(category ? "تم تحديث التصنيف" : "تم إنشاء التصنيف");
      onClose();
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, category, onClose, router]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{category ? "تعديل التصنيف" : "تصنيف جديد"}</DialogTitle>
          <DialogDescription>
            التصنيفات تُجمع قوالب المهام لكل خدمة. مثال: «Social Media — لايت» و«Social Media — برو».
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          {category && <input type="hidden" name="id" value={category.id} />}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat_key">المفتاح *</Label>
              <Input id="cat_key" name="key" defaultValue={category?.key ?? ""} required dir="ltr" />
              {state?.fieldErrors?.key && (<p className="text-xs text-cc-red">{state.fieldErrors.key}</p>)}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat_name_ar">الاسم بالعربية *</Label>
              <Input id="cat_name_ar" name="name_ar" defaultValue={category?.name_ar ?? ""} required />
              {state?.fieldErrors?.name_ar && (<p className="text-xs text-cc-red">{state.fieldErrors.name_ar}</p>)}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat_name_en">الاسم بالإنجليزية</Label>
              <Input id="cat_name_en" name="name_en" defaultValue={category?.name_en ?? ""} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat_service">الخدمة المرتبطة</Label>
              <select id="cat_service" name="service_id" defaultValue={category?.service_id ?? ""} className={SELECT_CLASS}>
                <option value="">— بدون —</option>
                {services.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat_description">الوصف</Label>
            <Textarea id="cat_description" name="description" rows={2} defaultValue={category?.description ?? ""} />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" name="is_active" value="true" defaultChecked={category?.is_active ?? true} className="size-3.5 accent-cyan" />
            <Power className="size-3" />
            مُفعَّل
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>إلغاء</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

