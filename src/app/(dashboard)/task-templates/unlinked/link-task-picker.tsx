"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { linkTaskToTemplate } from "./_actions";

export type ItemOption = {
  id: string;
  title: string;
  serviceId: string | null;
  serviceName: string | null;
};

// Inline per-row picker for the unlinked queue: choosing a template item links
// the task immediately (status='manual') and records an alias so future
// same-title tasks auto-link. Options are scoped to the task's own service (the
// right item lives there — the title just drifted); when the task has no service
// (or that service has no template items) we fall back to the full catalogue.
export function LinkTaskPicker({
  taskId,
  serviceId,
  options,
  labels,
}: {
  taskId: string;
  serviceId: string | null;
  options: ItemOption[];
  labels: {
    trigger: string;
    search: string;
    empty: string;
    success: string;
  };
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  const opts = useMemo(() => {
    const scoped = serviceId
      ? options.filter((o) => o.serviceId === serviceId)
      : options;
    const base = scoped.length > 0 ? scoped : options;
    return base.map((o) => ({
      value: o.id,
      label: o.title,
      hint: o.serviceName,
      keywords: o.serviceName,
    }));
  }, [options, serviceId]);

  function onPick(id: string) {
    if (!id) return;
    setValue(id);
    startTransition(async () => {
      const res = await linkTaskToTemplate({
        taskId,
        templateItemId: id,
        createAlias: true,
      });
      if (res.ok) {
        toast.success(labels.success);
        router.refresh();
      } else {
        toast.error(res.error);
        setValue("");
      }
    });
  }

  return (
    <SearchableSelect
      value={value}
      onValueChange={onPick}
      options={opts}
      placeholder={labels.trigger}
      searchPlaceholder={labels.search}
      emptyMessage={labels.empty}
      disabled={pending}
      className="min-w-[180px]"
      ariaLabel={labels.trigger}
    />
  );
}
