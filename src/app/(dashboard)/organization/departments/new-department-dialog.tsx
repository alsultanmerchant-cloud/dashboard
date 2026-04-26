"use client";

import { useState, useActionState, useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
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
import { createDepartmentAction, type DepartmentFormState } from "./_actions";

export function NewDepartmentDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<DepartmentFormState | undefined, FormData>(
    createDepartmentAction,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success("تم إنشاء القسم");
      setOpen(false);
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        قسم جديد
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>قسم جديد</DialogTitle>
          <DialogDescription>أضف قسمًا جديدًا لهيكل الوكالة.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dep_name">اسم القسم *</Label>
            <Input id="dep_name" name="name" required placeholder="مثال: الإعلام الرقمي" aria-invalid={!!state?.fieldErrors?.name} />
            {state?.fieldErrors?.name && <p className="text-xs text-cc-red">{state.fieldErrors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dep_slug">المعرّف (slug) *</Label>
            <Input id="dep_slug" name="slug" required placeholder="digital-media" dir="ltr" aria-invalid={!!state?.fieldErrors?.slug} />
            <p className="text-[11px] text-muted-foreground">أحرف لاتينية صغيرة، أرقام، وشرطات فقط.</p>
            {state?.fieldErrors?.slug && <p className="text-xs text-cc-red">{state.fieldErrors.slug}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dep_desc">الوصف</Label>
            <Textarea id="dep_desc" name="description" rows={2} placeholder="وصف اختياري للقسم…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              حفظ القسم
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
