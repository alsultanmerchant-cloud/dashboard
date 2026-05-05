"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, UserMinus } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
      <Select
        value={current?.id ?? ""}
        onValueChange={(v) => commit(v === "" ? null : v)}
        disabled={pending}
      >
        <SelectTrigger className="min-w-64 bg-card/50 border-soft-2 text-sm">
          <SelectValue placeholder="غير محدّد" />
        </SelectTrigger>
        <SelectContent>
          {employees.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.full_name}
              {e.job_title ? ` — ${e.job_title}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
