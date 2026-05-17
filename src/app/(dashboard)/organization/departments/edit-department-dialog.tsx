"use client";

import { useState, useActionState, useEffect } from "react";
import { Pencil, Loader2 } from "lucide-react";
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
import { updateDepartmentAction, type DepartmentFormState } from "./_actions";

// #12: edit an existing department. Mirrors NewDepartmentDialog; carries the
// department id on a hidden input and pre-fills the validated fields.
export function EditDepartmentDialog({
  department,
}: {
  department: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<
    DepartmentFormState | undefined,
    FormData
  >(updateDepartmentAction, undefined);

  useEffect(() => {
    if (state?.ok) {
      toast.success("تم تحديث القسم");
      setOpen(false);
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-3.5" />
        تعديل القسم
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل القسم</DialogTitle>
          <DialogDescription>عدّل بيانات القسم في هيكل الوكالة.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="department_id" value={department.id} />
          <div className="space-y-1.5">
            <Label htmlFor="edit_dep_name">اسم القسم *</Label>
            <Input
              id="edit_dep_name"
              name="name"
              required
              defaultValue={department.name}
              placeholder="مثال: الإعلام الرقمي"
              aria-invalid={!!state?.fieldErrors?.name}
            />
            {state?.fieldErrors?.name && (
              <p className="text-xs text-cc-red">{state.fieldErrors.name}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit_dep_slug">المعرّف (slug) *</Label>
            <Input
              id="edit_dep_slug"
              name="slug"
              required
              defaultValue={department.slug}
              placeholder="digital-media"
              dir="ltr"
              aria-invalid={!!state?.fieldErrors?.slug}
            />
            <p className="text-[11px] text-muted-foreground">
              أحرف لاتينية صغيرة، أرقام، وشرطات فقط.
            </p>
            {state?.fieldErrors?.slug && (
              <p className="text-xs text-cc-red">{state.fieldErrors.slug}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit_dep_desc">الوصف</Label>
            <Textarea
              id="edit_dep_desc"
              name="description"
              rows={2}
              defaultValue={department.description ?? ""}
              placeholder="وصف اختياري للقسم…"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
  );
}
