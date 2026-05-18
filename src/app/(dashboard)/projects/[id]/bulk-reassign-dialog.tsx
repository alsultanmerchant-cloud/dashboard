"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  EmployeeCombobox,
  type EmployeeComboboxOption,
} from "@/components/forms/employee-combobox";
import { bulkReassignAction } from "./_bulk_actions";

type EmployeeOption = { id: string; full_name: string; user_id: string | null; job_title: string | null };
type CategoryOption = { id: string; name: string };

const SELECT_CLASS =
  "h-9 rounded-md border bg-background px-2 text-sm w-full";

export function BulkReassignDialog({
  projectId,
  categories,
  employees,
}: {
  projectId: string;
  categories: CategoryOption[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const t = useTranslations("ProjectDetailPage.bulkReassign");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<"assignees" | "followers">("assignees");
  const [role, setRole] = useState<"specialist" | "manager" | "agent" | "account_manager">("agent");
  const [mode, setMode] = useState<"add" | "replace" | "clear">("add");
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set());
  const [actorIds, setActorIds] = useState<Set<string>>(new Set());

  const toggleCat = (id: string) =>
    setCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Followers must resolve to an auth user; employees without one are shown
  // but disabled (the combobox renders them greyed-out and unpickable).
  const employeeOptions: EmployeeComboboxOption[] = useMemo(
    () =>
      employees.map((e) => ({
        id: e.id,
        full_name: e.full_name,
        job_title: e.job_title,
        disabled: target === "followers" && !e.user_id,
      })),
    [employees, target],
  );

  const onSubmit = () =>
    start(async () => {
      // For followers, the action expects auth user_ids; map employee → user_id.
      const ids =
        target === "followers"
          ? Array.from(actorIds)
              .map((eid) => employees.find((e) => e.id === eid)?.user_id)
              .filter((u): u is string => !!u)
          : Array.from(actorIds);

      const res = await bulkReassignAction({
        projectId,
        categoryIds: Array.from(categoryIds),
        target,
        role: target === "assignees" ? role : undefined,
        mode,
        actorIds: ids,
      });
      if ("error" in res) return toast.error(res.error);
      toast.success(
        t("success", { tasks: res.tasks_affected, changes: res.rows_changed }),
      );
      setOpen(false);
      setActorIds(new Set());
      setCategoryIds(new Set());
      router.refresh();
    });

  const allowSubmit =
    !pending &&
    (mode === "clear" || actorIds.size > 0) &&
    (target === "followers" || role);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Users className="ml-1 size-3.5" />
        {t("trigger")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("targetLabel")}</label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as typeof target)}
                disabled={pending}
                className={SELECT_CLASS}
              >
                <option value="assignees">{t("targets.assignees")}</option>
                <option value="followers">{t("targets.followers")}</option>
              </select>
            </div>
            {target === "assignees" && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t("roleLabel")}</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as typeof role)}
                  disabled={pending}
                  className={SELECT_CLASS}
                >
                  {(["specialist", "manager", "agent", "account_manager"] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`roles.${k}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("actionLabel")}</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                disabled={pending}
                className={SELECT_CLASS}
              >
                <option value="add">{t("actions.add")}</option>
                <option value="replace">{t("actions.replace")}</option>
                <option value="clear">{t("actions.clear")}</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t("categoriesLabel")}
            </label>
            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-md border bg-muted/20 p-2">
              {categories.length === 0 ? (
                <span className="text-xs text-muted-foreground">{t("noCategories")}</span>
              ) : (
                categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCat(c.id)}
                    className={
                      "rounded-full border px-2 py-0.5 text-xs transition-colors " +
                      (categoryIds.has(c.id)
                        ? "border-cyan/60 bg-cyan/15 text-cyan"
                        : "border-border bg-background hover:bg-muted/40")
                    }
                  >
                    {c.name}
                  </button>
                ))
              )}
            </div>
          </div>

          {mode !== "clear" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {target === "followers" ? t("targets.followers") : t("employeesLabel")}
              </label>
              <EmployeeCombobox
                multiple
                value={Array.from(actorIds)}
                onChange={(next) => setActorIds(new Set(next))}
                options={employeeOptions}
                disabled={pending}
                placeholder={t("employeesLabel")}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={!allowSubmit}>
            {pending && <Loader2 className="ml-1 size-3.5 animate-spin" />}
            {t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
