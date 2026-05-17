"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, UserMinus } from "lucide-react";
import { EmployeeCombobox } from "@/components/forms/employee-combobox";
import { setOrgProjectManagerAction } from "./_actions";

type Employee = {
  id: string;
  full_name: string;
  job_title: string | null;
};

export function ProjectManagerPicker({
  current,
  employees,
}: {
  current: Employee | null;
  employees: Employee[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function commit(employeeId: string | null) {
    start(async () => {
      const res = await setOrgProjectManagerAction({ employeeId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم الحفظ");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Sparkles className="size-3.5 text-muted-foreground" />
      <EmployeeCombobox
        className="min-w-64"
        value={current?.id ?? null}
        onChange={(v) => commit(v)}
        options={employees}
        disabled={pending}
        placeholder="غير محدّد"
        clearLabel="غير محدّد"
        ariaLabel="مدير المشاريع"
      />
      {current && !pending && (
        <button
          type="button"
          onClick={() => commit(null)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-soft-2 hover:text-foreground"
          aria-label="إخلاء"
          title="إخلاء"
        >
          <UserMinus className="size-3.5" />
        </button>
      )}
      {pending && <Loader2 className="size-4 animate-spin opacity-70" />}
    </div>
  );
}
