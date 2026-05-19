"use client";

// Per-service team assignment for the new-project wizard. For each selected
// service it lists the positions that service's task templates use, and lets
// the operator assign one employee per position. Extra people can be added —
// they join every task of that service. The result feeds project_service_team
// and, from there, task generation.

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";
import type { TemplateWithItems } from "@/lib/data/service-categories";

export type ServiceTeamEntry = {
  serviceId: string;
  positionSlug: string;
  employeeId: string;
  isExtra: boolean;
};

type PositionOpt = { slug: string; name: string; role: string };

let extraKeySeq = 0;

export function ServiceTeamPanel({
  selectedServiceIds,
  services,
  templates,
  positions,
  employeeOptions,
  onChange,
}: {
  selectedServiceIds: string[];
  services: { id: string; name: string }[];
  templates: TemplateWithItems[];
  positions: PositionOpt[];
  employeeOptions: SearchableOption[];
  onChange: (next: ServiceTeamEntry[]) => void;
}) {
  // serviceId → positionSlug → employeeId, for positions the templates use.
  const [assignments, setAssignments] = useState<
    Record<string, Record<string, string>>
  >({});
  // serviceId → extra rows (operator-added people).
  const [extras, setExtras] = useState<
    Record<string, { key: string; positionSlug: string; employeeId: string }[]>
  >({});

  const positionName = useMemo(
    () => new Map(positions.map((p) => [p.slug, p.name])),
    [positions],
  );

  // Distinct position slugs each selected service's templates reference.
  const templatePositionsByService = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const sid of selectedServiceIds) {
      const slugs = new Set<string>();
      for (const tpl of templates) {
        if (tpl.service_id !== sid) continue;
        for (const it of tpl.items) {
          if (it.default_role_key) slugs.add(it.default_role_key);
          const sop = it.stage_owner_positions;
          if (sop) for (const v of Object.values(sop)) if (v) slugs.add(v);
        }
      }
      out.set(sid, Array.from(slugs));
    }
    return out;
  }, [selectedServiceIds, templates]);

  // Recompute the flat payload whenever anything changes.
  useEffect(() => {
    const entries: ServiceTeamEntry[] = [];
    const seen = new Set<string>();
    for (const sid of selectedServiceIds) {
      const slugs = templatePositionsByService.get(sid) ?? [];
      for (const slug of slugs) {
        const empId = assignments[sid]?.[slug];
        if (!empId) continue;
        const key = `${sid}|${slug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ serviceId: sid, positionSlug: slug, employeeId: empId, isExtra: false });
      }
      for (const row of extras[sid] ?? []) {
        if (!row.positionSlug || !row.employeeId) continue;
        const key = `${sid}|${row.positionSlug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          serviceId: sid,
          positionSlug: row.positionSlug,
          employeeId: row.employeeId,
          isExtra: true,
        });
      }
    }
    onChange(entries);
  }, [assignments, extras, selectedServiceIds, templatePositionsByService, onChange]);

  if (selectedServiceIds.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-soft bg-soft-1/40 px-3 py-4 text-center text-xs text-muted-foreground">
        اختر خدمة أولًا لتعيين فريقها.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {selectedServiceIds.map((sid) => {
        const service = services.find((s) => s.id === sid);
        const slugs = templatePositionsByService.get(sid) ?? [];
        const serviceExtras = extras[sid] ?? [];
        return (
          <div
            key={sid}
            className="rounded-xl border border-soft bg-soft-1/40 p-3"
          >
            <div className="mb-2 text-[12px] font-semibold text-foreground">
              {service?.name ?? "خدمة"}
            </div>

            {slugs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                لا توجد مسميات محدّدة في قوالب هذه الخدمة.
              </p>
            ) : (
              <div className="space-y-2">
                {slugs.map((slug) => (
                  <div
                    key={slug}
                    className="grid grid-cols-[8rem_1fr] items-center gap-2"
                  >
                    <Label className="text-[11px] text-muted-foreground">
                      {positionName.get(slug) ?? slug}
                    </Label>
                    <SearchableSelect
                      value={assignments[sid]?.[slug] ?? ""}
                      onValueChange={(v) =>
                        setAssignments((prev) => ({
                          ...prev,
                          [sid]: { ...(prev[sid] ?? {}), [slug]: v },
                        }))
                      }
                      options={employeeOptions}
                      placeholder="— اختر الموظف —"
                      searchPlaceholder="ابحث في الموظفين…"
                    />
                  </div>
                ))}
              </div>
            )}

            {serviceExtras.length > 0 && (
              <div className="mt-2 space-y-2 border-t border-soft pt-2">
                {serviceExtras.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-[8rem_1fr_auto] items-center gap-2"
                  >
                    <select
                      value={row.positionSlug}
                      onChange={(e) =>
                        setExtras((prev) => ({
                          ...prev,
                          [sid]: (prev[sid] ?? []).map((r) =>
                            r.key === row.key
                              ? { ...r, positionSlug: e.target.value }
                              : r,
                          ),
                        }))
                      }
                      className="h-9 w-full rounded-lg border border-input bg-input px-2 text-xs"
                    >
                      <option value="">— المسمى —</option>
                      {positions.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <SearchableSelect
                      value={row.employeeId}
                      onValueChange={(v) =>
                        setExtras((prev) => ({
                          ...prev,
                          [sid]: (prev[sid] ?? []).map((r) =>
                            r.key === row.key ? { ...r, employeeId: v } : r,
                          ),
                        }))
                      }
                      options={employeeOptions}
                      placeholder="— اختر الموظف —"
                      searchPlaceholder="ابحث في الموظفين…"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setExtras((prev) => ({
                          ...prev,
                          [sid]: (prev[sid] ?? []).filter(
                            (r) => r.key !== row.key,
                          ),
                        }))
                      }
                      className="rounded p-1.5 text-muted-foreground hover:bg-cc-red/10 hover:text-cc-red"
                      aria-label="إزالة"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                setExtras((prev) => ({
                  ...prev,
                  [sid]: [
                    ...(prev[sid] ?? []),
                    {
                      key: `x${extraKeySeq++}`,
                      positionSlug: "",
                      employeeId: "",
                    },
                  ],
                }))
              }
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-cyan hover:underline"
            >
              <Plus className="size-3.5" />
              إضافة شخص
            </button>
          </div>
        );
      })}
    </div>
  );
}
