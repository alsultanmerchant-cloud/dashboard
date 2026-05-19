"use client";

// Job-title picker for the employee form. Pick an existing position, or add
// a new one inline — a new position must be tagged with one of the 7
// structural roles so task auto-assignment knows how to resolve it.

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TASK_OWNER_ROLE_KEYS, TASK_OWNER_ROLE_LABELS } from "@/lib/labels";
import { createPositionAction } from "@/app/(dashboard)/organization/employees/_actions";

export type PositionOption = {
  id: string;
  slug: string;
  name: string;
  role: string;
  is_system: boolean;
};

export function PositionPicker({
  positions,
  value,
  onChange,
  onPositionCreated,
  disabled,
  name,
}: {
  positions: PositionOption[];
  value: string;
  onChange: (positionId: string) => void;
  onPositionCreated: (position: PositionOption) => void;
  disabled?: boolean;
  /** When set, renders a hidden input so a parent <form> picks up the value. */
  name?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] =
    useState<(typeof TASK_OWNER_ROLE_KEYS)[number]>("specialist");
  const [pending, start] = useTransition();

  const options = [
    { value: "", label: "— بدون —" },
    ...positions.map((p) => ({
      value: p.id,
      label: p.name,
      hint: TASK_OWNER_ROLE_LABELS[
        p.role as (typeof TASK_OWNER_ROLE_KEYS)[number]
      ] ?? p.role,
    })),
  ];

  const submitNew = () => {
    if (draftName.trim().length < 2) {
      toast.error("اكتب اسم المسمى الوظيفي");
      return;
    }
    start(async () => {
      const res = await createPositionAction({
        name: draftName.trim(),
        role: draftRole,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      onPositionCreated(res.position);
      onChange(res.position.id);
      setCreating(false);
      setDraftName("");
      toast.success("أُضيف المسمى الوظيفي");
    });
  };

  if (creating) {
    return (
      <div className="space-y-2 rounded-lg border border-soft bg-soft-1/40 p-2">
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="اسم المسمى الوظيفي"
          disabled={pending}
          autoFocus
        />
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">
            الرول المرتبط (يحدد كيف يُسنَد تلقائيًا)
          </span>
          <select
            value={draftRole}
            onChange={(e) =>
              setDraftRole(
                e.target.value as (typeof TASK_OWNER_ROLE_KEYS)[number],
              )
            }
            disabled={pending}
            className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm"
          >
            {TASK_OWNER_ROLE_KEYS.map((r) => (
              <option key={r} value={r}>
                {TASK_OWNER_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCreating(false)}
            disabled={pending}
          >
            إلغاء
          </Button>
          <Button type="button" size="sm" onClick={submitNew} disabled={pending}>
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            إضافة
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {name && <input type="hidden" name={name} value={value} />}
      <SearchableSelect
        value={value}
        onValueChange={onChange}
        options={options}
        disabled={disabled}
        placeholder="— بدون —"
        searchPlaceholder="ابحث عن مسمى وظيفي..."
        emptyMessage="لا توجد مسميات"
        ariaLabel="المسمى الوظيفي"
        onCreateNew={(query) => {
          setDraftName(query);
          setCreating(true);
        }}
        createLabel="إضافة مسمى جديد"
      />
    </>
  );
}
