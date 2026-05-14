"use client";

import { useState } from "react";
import { Plus, Network, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  OPERATORS_BY_KIND,
  defaultValueFor,
  emptyRule,
  type FieldDef,
  type FilterTree,
  type Group,
  type Node,
  type Operator,
  type Rule,
} from "@/lib/custom-filter/types";
import { FieldCombobox } from "./field-combobox";
import { ValueInput } from "./value-input";

// Custom Filter dialog — the centerpiece of the feature.
//
// Tree-of-rules editor with parity to Odoo's "Add Custom Filter":
//   - "Match [any/all] of the following rules:" heading
//   - Each rule = (field, operator, value) + row actions (+ branch, branch
//     creates nested group, trash deletes the node)
//   - "New Rule" link appends a sibling rule
//   - Footer: Cancel / Add (Add applies the filter and closes)
//   - "Include archived" toggle (toggle prop owned by parent so it persists
//     in the URL the same way the existing `archived=1` param does)

export function CustomFilterDialog({
  open,
  onOpenChange,
  fields,
  initialTree,
  includeArchived,
  onIncludeArchivedChange,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: FieldDef[];
  initialTree: FilterTree | null;
  includeArchived: boolean;
  onIncludeArchivedChange: (next: boolean) => void;
  onApply: (tree: FilterTree | null) => void;
}) {
  const defaultField = fields[0];
  const [tree, setTree] = useState<FilterTree>(
    initialTree ?? { type: "group", connector: "or", children: [emptyRule(defaultField)] },
  );

  // Re-seed local state whenever the dialog reopens with a different tree.
  // We use a sentinel via the `open` toggle so editing-then-cancelling
  // doesn't leak state across sessions.
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const currentKey = open ? JSON.stringify(initialTree ?? null) : null;
  if (currentKey !== seededKey) {
    setSeededKey(currentKey);
    setTree(initialTree ?? { type: "group", connector: "or", children: [emptyRule(defaultField)] });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add Custom Filter</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 text-xs text-foreground">
              <span>Match</span>
              <ConnectorSelect
                value={tree.connector}
                onChange={(c) => setTree({ ...tree, connector: c })}
              />
              <span>of the following rules:</span>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                className="accent-cyan"
                checked={includeArchived}
                onChange={(e) => onIncludeArchivedChange(e.target.checked)}
              />
              Include archived
            </label>
          </div>

          <GroupBody
            group={tree}
            fields={fields}
            onChange={(next) => setTree(next as FilterTree)}
            depth={0}
          />

          <button
            type="button"
            onClick={() =>
              setTree({ ...tree, children: [...tree.children, emptyRule(defaultField)] })
            }
            className="text-xs font-medium text-cyan hover:underline"
          >
            + New Rule
          </button>
        </div>

        <DialogFooter className="mt-4 flex justify-start gap-2 sm:justify-start">
          <Button
            type="button"
            onClick={() => {
              onApply(tree);
              onOpenChange(false);
            }}
          >
            Add
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectorSelect({
  value,
  onChange,
}: {
  value: "and" | "or";
  onChange: (v: "and" | "or") => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as "and" | "or")}
      className="rounded-md border border-soft bg-card/50 px-1.5 py-0.5 text-xs text-cyan focus:border-cyan focus:outline-none"
    >
      <option value="or">any</option>
      <option value="and">all</option>
    </select>
  );
}

function GroupBody({
  group,
  fields,
  onChange,
  depth,
}: {
  group: Group;
  fields: FieldDef[];
  onChange: (next: Group) => void;
  depth: number;
}) {
  const setChild = (idx: number, next: Node | null) => {
    const nextChildren = [...group.children];
    if (next === null) nextChildren.splice(idx, 1);
    else nextChildren[idx] = next;
    onChange({ ...group, children: nextChildren });
  };

  const addRuleAfter = (idx: number) => {
    const nextChildren = [...group.children];
    nextChildren.splice(idx + 1, 0, emptyRule(fields[0]));
    onChange({ ...group, children: nextChildren });
  };

  const addBranchAfter = (idx: number) => {
    const nextChildren = [...group.children];
    nextChildren.splice(idx + 1, 0, {
      type: "group",
      connector: "and",
      children: [emptyRule(fields[0]), emptyRule(fields[0])],
    });
    onChange({ ...group, children: nextChildren });
  };

  return (
    <div className={cn("flex flex-col gap-2", depth > 0 && "ms-4 border-s-2 border-soft ps-3")}>
      {group.children.map((child, idx) =>
        child.type === "rule" ? (
          <RuleRow
            key={idx}
            rule={child}
            fields={fields}
            onChange={(next) => setChild(idx, next)}
            onDelete={() => setChild(idx, null)}
            onAddRule={() => addRuleAfter(idx)}
            onAddBranch={() => addBranchAfter(idx)}
          />
        ) : (
          <NestedGroup
            key={idx}
            group={child}
            fields={fields}
            onChange={(next) => setChild(idx, next)}
            onDelete={() => setChild(idx, null)}
            onAddRule={() => addRuleAfter(idx)}
            onAddBranch={() => addBranchAfter(idx)}
            depth={depth + 1}
          />
        ),
      )}
    </div>
  );
}

function NestedGroup({
  group,
  fields,
  onChange,
  onDelete,
  onAddRule,
  onAddBranch,
  depth,
}: {
  group: Group;
  fields: FieldDef[];
  onChange: (next: Group) => void;
  onDelete: () => void;
  onAddRule: () => void;
  onAddBranch: () => void;
  depth: number;
}) {
  return (
    <div className="rounded-md border border-soft bg-soft-1/40 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-foreground">
          <ConnectorSelect
            value={group.connector}
            onChange={(c) => onChange({ ...group, connector: c })}
          />
          <span>of:</span>
        </div>
        <RowActions onAddRule={onAddRule} onAddBranch={onAddBranch} onDelete={onDelete} />
      </div>
      <GroupBody group={group} fields={fields} onChange={onChange} depth={depth} />
      <button
        type="button"
        onClick={() => onChange({ ...group, children: [...group.children, emptyRule(fields[0])] })}
        className="mt-2 text-[11px] font-medium text-cyan hover:underline"
      >
        + New Rule
      </button>
    </div>
  );
}

function RuleRow({
  rule,
  fields,
  onChange,
  onDelete,
  onAddRule,
  onAddBranch,
}: {
  rule: Rule;
  fields: FieldDef[];
  onChange: (next: Rule) => void;
  onDelete: () => void;
  onAddRule: () => void;
  onAddBranch: () => void;
}) {
  const field = fields.find((f) => f.name === rule.field) ?? fields[0];
  const ops = OPERATORS_BY_KIND[field.kind];

  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <div className="min-w-[180px] flex-1">
          <FieldCombobox
            fields={fields}
            value={rule.field}
            onChange={(nextField) =>
              onChange({
                type: "rule",
                field: nextField.name,
                op: OPERATORS_BY_KIND[nextField.kind][0].op,
                value: defaultValueFor(nextField, OPERATORS_BY_KIND[nextField.kind][0].op),
              })
            }
          />
        </div>
        <div className="min-w-[120px]">
          <select
            value={rule.op}
            onChange={(e) =>
              onChange({
                ...rule,
                op: e.target.value as Operator,
                value: defaultValueFor(field, e.target.value as Operator),
              })
            }
            className="w-full rounded-md border border-soft bg-card/50 px-2 py-1.5 text-xs text-foreground focus:border-cyan focus:outline-none"
          >
            {ops.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[220px] flex-1">
          <ValueInput
            field={field}
            op={rule.op}
            value={rule.value}
            onChange={(next) => onChange({ ...rule, value: next })}
          />
        </div>
      </div>
      <RowActions onAddRule={onAddRule} onAddBranch={onAddBranch} onDelete={onDelete} />
    </div>
  );
}

function RowActions({
  onAddRule,
  onAddBranch,
  onDelete,
}: {
  onAddRule: () => void;
  onAddBranch: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 pt-1 text-muted-foreground">
      <button
        type="button"
        onClick={onAddRule}
        title="Add new rule"
        className="rounded p-1 transition-colors hover:bg-soft-1 hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onAddBranch}
        title="Add branch (nested group)"
        className="rounded p-1 transition-colors hover:bg-soft-1 hover:text-foreground"
      >
        <Network className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Delete"
        className="rounded p-1 transition-colors hover:bg-soft-1 hover:text-cc-red"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

// Bare-export the `<X>` chip used by the search bar pill — keeps import
// hygiene local.
export { X as PillCloseIcon };
