import type { FieldDef, FilterTree, Group, Node, Operator, Rule } from "./types";

// Render a filter tree as the human-readable pill text Odoo shows in the
// search bar, e.g. `Project Manager is in ( Administrator, John )` or
// `Status = active`. Nested groups become `( <child summary> )` with the
// group's own connector word between them.

type FieldLookup = (name: string) => FieldDef | undefined;
type LabelResolver = (model: string, id: string) => string | undefined;

const OP_LABELS: Record<Operator, string> = {
  "=": "=",
  "!=": "!=",
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
  "ilike": "contains",
  "not ilike": "does not contain",
  "in": "is in",
  "not in": "is not in",
  "between": "is between",
  "set": "is set",
  "not_set": "is not set",
};

function formatValue(field: FieldDef, op: Operator, value: unknown, labelLookup?: LabelResolver): string {
  if (op === "set" || op === "not_set") return "";
  if (op === "between") {
    const [from, to] = Array.isArray(value) ? value : ["", ""];
    return `${from || "?"} → ${to || "?"}`;
  }
  if (op === "in" || op === "not in") {
    const arr = Array.isArray(value) ? value : [];
    if (arr.length === 0) return "( … )";
    const labels = arr.map((v) => stringifyValue(field, v, labelLookup));
    return `( ${labels.join(", ")} )`;
  }
  return stringifyValue(field, value, labelLookup);
}

function stringifyValue(field: FieldDef, value: unknown, labelLookup?: LabelResolver): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.kind === "selection" && field.options) {
    const match = field.options.find((o) => o.value === String(value));
    if (match) return match.label;
  }
  if (field.kind === "relational" && field.relation && labelLookup) {
    const label = labelLookup(field.relation.model, String(value));
    if (label) return label;
  }
  if (field.kind === "boolean") return value ? "True" : "False";
  return String(value);
}

function formatRule(rule: Rule, lookup: FieldLookup, labelLookup?: LabelResolver): string {
  const field = lookup(rule.field);
  if (!field) return rule.field;
  const opLabel = OP_LABELS[rule.op] ?? rule.op;
  const valueLabel = formatValue(field, rule.op, rule.value, labelLookup);
  return valueLabel ? `${field.label} ${opLabel} ${valueLabel}` : `${field.label} ${opLabel}`;
}

function formatGroup(group: Group, lookup: FieldLookup, labelLookup?: LabelResolver): string {
  const parts = group.children.map((c) => formatNode(c, lookup, labelLookup)).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const joiner = group.connector === "and" ? " AND " : " OR ";
  return `( ${parts.join(joiner)} )`;
}

function formatNode(node: Node, lookup: FieldLookup, labelLookup?: LabelResolver): string {
  return node.type === "rule" ? formatRule(node, lookup, labelLookup) : formatGroup(node, lookup, labelLookup);
}

export function formatFilterTree(tree: FilterTree, lookup: FieldLookup, labelLookup?: LabelResolver): string {
  if (tree.children.length === 0) return "";
  if (tree.children.length === 1) {
    return formatNode(tree.children[0], lookup, labelLookup);
  }
  const joiner = tree.connector === "and" ? " AND " : " OR ";
  return tree.children
    .map((c) => formatNode(c, lookup, labelLookup))
    .filter(Boolean)
    .join(joiner);
}
