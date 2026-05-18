import {
  getOperatorLabel,
  type FieldDef,
  type FilterTree,
  type Group,
  type Node,
  type Operator,
  type Rule,
} from "./types";

// Render a filter tree as the human-readable pill text Odoo shows in the
// search bar, e.g. `Project Manager is in ( Administrator, John )` or
// `Status = active`. Nested groups become `( <child summary> )` with the
// group's own connector word between them.

type FieldLookup = (name: string) => FieldDef | undefined;
type LabelResolver = (model: string, id: string) => string | undefined;

type FormatLabels = {
  operatorLabel?: (op: Operator) => string;
  booleanTrue?: string;
  booleanFalse?: string;
  and?: string;
  or?: string;
};

function formatValue(
  field: FieldDef,
  op: Operator,
  value: unknown,
  labelLookup?: LabelResolver,
  labels?: FormatLabels,
): string {
  if (op === "set" || op === "not_set") return "";
  if (op === "between") {
    const [from, to] = Array.isArray(value) ? value : ["", ""];
    return `${from || "?"} → ${to || "?"}`;
  }
  if (op === "in" || op === "not in") {
    const arr = Array.isArray(value) ? value : [];
    if (arr.length === 0) return "( … )";
    const valueLabels = arr.map((v) => stringifyValue(field, v, labelLookup, labels));
    return `( ${valueLabels.join(", ")} )`;
  }
  return stringifyValue(field, value, labelLookup, labels);
}

function stringifyValue(
  field: FieldDef,
  value: unknown,
  labelLookup?: LabelResolver,
  labels?: FormatLabels,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.kind === "selection" && field.options) {
    const match = field.options.find((o) => o.value === String(value));
    if (match) return match.label;
  }
  if (field.kind === "relational" && field.relation && labelLookup) {
    const label = labelLookup(field.relation.model, String(value));
    if (label) return label;
  }
  if (field.kind === "boolean") {
    return value
      ? (labels?.booleanTrue ?? "True")
      : (labels?.booleanFalse ?? "False");
  }
  return String(value);
}

function formatRule(
  rule: Rule,
  lookup: FieldLookup,
  labelLookup?: LabelResolver,
  labels?: FormatLabels,
): string {
  const field = lookup(rule.field);
  if (!field) return rule.field;
  const opLabel = labels?.operatorLabel?.(rule.op) ?? getOperatorLabel(rule.op);
  const valueLabel = formatValue(field, rule.op, rule.value, labelLookup, labels);
  return valueLabel ? `${field.label} ${opLabel} ${valueLabel}` : `${field.label} ${opLabel}`;
}

function formatGroup(
  group: Group,
  lookup: FieldLookup,
  labelLookup?: LabelResolver,
  labels?: FormatLabels,
): string {
  const parts = group.children
    .map((c) => formatNode(c, lookup, labelLookup, labels))
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const joiner = group.connector === "and"
    ? ` ${labels?.and ?? "AND"} `
    : ` ${labels?.or ?? "OR"} `;
  return `( ${parts.join(joiner)} )`;
}

function formatNode(
  node: Node,
  lookup: FieldLookup,
  labelLookup?: LabelResolver,
  labels?: FormatLabels,
): string {
  return node.type === "rule"
    ? formatRule(node, lookup, labelLookup, labels)
    : formatGroup(node, lookup, labelLookup, labels);
}

export function formatFilterTree(
  tree: FilterTree,
  lookup: FieldLookup,
  labelLookup?: LabelResolver,
  labels?: FormatLabels,
): string {
  if (tree.children.length === 0) return "";
  if (tree.children.length === 1) {
    return formatNode(tree.children[0], lookup, labelLookup, labels);
  }
  const joiner = tree.connector === "and"
    ? ` ${labels?.and ?? "AND"} `
    : ` ${labels?.or ?? "OR"} `;
  return tree.children
    .map((c) => formatNode(c, lookup, labelLookup, labels))
    .filter(Boolean)
    .join(joiner);
}
