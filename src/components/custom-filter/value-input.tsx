"use client";

import { useTranslations } from "next-intl";
import { RelationalPicker } from "./relational-picker";
import type { FieldDef, Operator } from "@/lib/custom-filter/types";
import { operatorHasValue } from "@/lib/custom-filter/types";

// Renders the value widget(s) for a single rule, dispatching on field kind +
// operator. `set` / `not_set` render nothing (no value needed).

export function ValueInput({
  field,
  op,
  value,
  onChange,
}: {
  field: FieldDef;
  op: Operator;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const t = useTranslations("CustomFilter");
  if (!operatorHasValue(op)) return null;

  // "is between" → two inputs of the matching type.
  if (op === "between") {
    const arr = Array.isArray(value) ? value : ["", ""];
    return (
      <div className="flex items-center gap-1">
        <ScalarInput
          field={field}
          value={arr[0]}
          onChange={(v) => onChange([v, arr[1]])}
          textPlaceholder={t("valuePlaceholder")}
          trueLabel={t("boolean.true")}
          falseLabel={t("boolean.false")}
        />
        <span className="text-[10px] text-muted-foreground">→</span>
        <ScalarInput
          field={field}
          value={arr[1]}
          onChange={(v) => onChange([arr[0], v])}
          textPlaceholder={t("valuePlaceholder")}
          trueLabel={t("boolean.true")}
          falseLabel={t("boolean.false")}
        />
      </div>
    );
  }

  // "is in" / "is not in" → list of values. For relational, that's the
  // chip picker (multiple). For everything else, a comma-separated chip
  // input via the SelectionMulti / TextMulti widget.
  if (op === "in" || op === "not in") {
    if (field.kind === "relational" && field.relation) {
      const values = Array.isArray(value) ? (value as string[]) : [];
      return (
        <RelationalPicker
          model={field.relation.model}
          values={values}
          onChange={onChange}
          multiple
        />
      );
    }
    if (field.kind === "selection") {
      const values = Array.isArray(value) ? (value as string[]) : [];
      return (
        <SelectionMulti field={field} values={values} onChange={onChange} />
      );
    }
    // Text / number multi: free-form chip input.
    const values = Array.isArray(value) ? (value as (string | number)[]) : [];
    return <ChipMulti values={values} onChange={onChange} placeholder={t("multiValuePlaceholder")} />;
  }

  // Single-value operators (=, !=, >, contains, …).
  if (field.kind === "relational" && field.relation) {
    const arr = value ? [value as string] : [];
    return (
      <RelationalPicker
        model={field.relation.model}
        values={arr}
        onChange={(next) => onChange(next[0] ?? null)}
        multiple={false}
      />
    );
  }
  return (
    <ScalarInput
      field={field}
      value={value}
      onChange={onChange}
      textPlaceholder={t("valuePlaceholder")}
      trueLabel={t("boolean.true")}
      falseLabel={t("boolean.false")}
    />
  );
}

function ScalarInput({
  field,
  value,
  onChange,
  textPlaceholder,
  trueLabel,
  falseLabel,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  textPlaceholder: string;
  trueLabel: string;
  falseLabel: string;
}) {
  const baseInput =
    "min-w-0 flex-1 rounded-md border border-soft bg-card/50 px-2 py-1.5 text-xs text-foreground focus:border-cyan focus:outline-none";
  switch (field.kind) {
    case "boolean":
      return (
        <select
          value={value ? "true" : "false"}
          onChange={(e) => onChange(e.target.value === "true")}
          className={baseInput}
        >
          <option value="true">{trueLabel}</option>
          <option value="false">{falseLabel}</option>
        </select>
      );
    case "number":
      return (
        <input
          type="number"
          value={value == null ? "" : String(value)}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : Number(v));
          }}
          className={baseInput}
        />
      );
    case "date":
      return (
        <input
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
        />
      );
    case "datetime":
      return (
        <input
          type="datetime-local"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
        />
      );
    case "selection":
      return (
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
          placeholder={textPlaceholder}
        />
      );
  }
}

function SelectionMulti({
  field,
  values,
  onChange,
}: {
  field: FieldDef;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  // Render checkable chips inline — small enough that a full multi-select
  // dropdown isn't worth the complexity.
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-soft bg-card/50 px-2 py-1">
      {field.options?.map((o) => {
        const active = values.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            onClick={() =>
              onChange(active ? values.filter((v) => v !== o.value) : [...values, o.value])
            }
            className={
              active
                ? "rounded-full bg-cyan-dim px-2 py-0.5 text-[11px] font-medium text-cyan"
                : "rounded-full border border-soft px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ChipMulti({
  values,
  onChange,
  placeholder,
}: {
  values: (string | number)[];
  onChange: (next: (string | number)[]) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      value={values.join(", ")}
      onChange={(e) => {
        const next = e.target.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        onChange(next);
      }}
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded-md border border-soft bg-card/50 px-2 py-1.5 text-xs text-foreground focus:border-cyan focus:outline-none"
    />
  );
}
