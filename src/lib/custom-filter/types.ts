// Custom-filter rule-tree types. Mirror Odoo's domain semantics so the JSON
// tree can be transparently round-tripped through the URL and (eventually)
// `user_saved_filters.body`.

export type FieldKind =
  | "text"
  | "number"
  | "date"
  | "datetime"
  | "boolean"
  | "selection" // enum-like (status, priority)
  | "relational"; // m2o / m2m → value(s) are uuids

export type FieldDef = {
  /** Column name in the underlying table (used to build the SQL/PostgREST filter). */
  name: string;
  /** Human label shown in the field combobox + in the filter pill. */
  label: string;
  kind: FieldKind;
  /** For `selection`: the allowed values + labels. */
  options?: { value: string; label: string }[];
  /** For `relational`: which model/table the value(s) reference. Drives the
   *  autocomplete API. */
  relation?: {
    /** Logical identifier the picker API understands (e.g. "employee", "client"). */
    model: string;
    /** Optional pre-applied filter context (e.g. "role=manager"). */
    context?: Record<string, string>;
  };
};

/** Every operator we surface in the UI. Names match Odoo for muscle-memory. */
export type Operator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "ilike"        // "contains"
  | "not ilike"    // "does not contain"
  | "in"           // "is in" — multi-value
  | "not in"       // "is not in" — multi-value
  | "between"      // numeric / date range
  | "set"          // "is set" — IS NOT NULL
  | "not_set";     // "is not set" — IS NULL

export type OperatorOption = { op: Operator; label: string };

/** Operator menus per field kind, in display order. Matches what Rwasem shows. */
export const OPERATORS_BY_KIND: Record<FieldKind, OperatorOption[]> = {
  text: [
    { op: "=", label: "=" },
    { op: "!=", label: "!=" },
    { op: "ilike", label: "contains" },
    { op: "not ilike", label: "does not contain" },
    { op: "in", label: "is in" },
    { op: "not in", label: "is not in" },
    { op: "set", label: "is set" },
    { op: "not_set", label: "is not set" },
  ],
  number: [
    { op: "=", label: "=" },
    { op: "!=", label: "!=" },
    { op: ">", label: ">" },
    { op: ">=", label: ">=" },
    { op: "<", label: "<" },
    { op: "<=", label: "<=" },
    { op: "between", label: "is between" },
    { op: "ilike", label: "contains" },
    { op: "not ilike", label: "does not contain" },
    { op: "set", label: "is set" },
    { op: "not_set", label: "is not set" },
  ],
  date: [
    { op: "=", label: "=" },
    { op: "!=", label: "!=" },
    { op: ">", label: ">" },
    { op: ">=", label: ">=" },
    { op: "<", label: "<" },
    { op: "<=", label: "<=" },
    { op: "between", label: "is between" },
    { op: "set", label: "is set" },
    { op: "not_set", label: "is not set" },
  ],
  datetime: [
    { op: "=", label: "=" },
    { op: "!=", label: "!=" },
    { op: ">", label: ">" },
    { op: ">=", label: ">=" },
    { op: "<", label: "<" },
    { op: "<=", label: "<=" },
    { op: "between", label: "is between" },
    { op: "set", label: "is set" },
    { op: "not_set", label: "is not set" },
  ],
  boolean: [
    { op: "set", label: "is set" },
    { op: "not_set", label: "is not set" },
  ],
  selection: [
    { op: "=", label: "=" },
    { op: "!=", label: "!=" },
    { op: "in", label: "is in" },
    { op: "not in", label: "is not in" },
    { op: "set", label: "is set" },
    { op: "not_set", label: "is not set" },
  ],
  relational: [
    { op: "in", label: "is in" },
    { op: "not in", label: "is not in" },
    { op: "=", label: "=" },
    { op: "!=", label: "!=" },
    { op: "ilike", label: "contains" },
    { op: "not ilike", label: "does not contain" },
    { op: "set", label: "is set" },
    { op: "not_set", label: "is not set" },
  ],
};

/** A leaf rule: `<field> <operator> <value>`. */
export type Rule = {
  type: "rule";
  field: string;
  op: Operator;
  /** Either a primitive, an array (for `in`/`not in`), or a [from, to] for `between`. */
  value: unknown;
};

/** A group node: `<connector> of [children]`. Recursive — children can themselves be groups. */
export type Group = {
  type: "group";
  connector: "and" | "or";
  children: Node[];
};

export type Node = Rule | Group;

/** Always wrap the top of the tree in a group so the connector toggle has a home. */
export type FilterTree = Group;

/** Convenience: a fresh tree with one empty rule. */
export function emptyTree(defaultField: FieldDef): FilterTree {
  return {
    type: "group",
    connector: "or", // Odoo defaults to "any" (OR) for new custom filters
    children: [emptyRule(defaultField)],
  };
}

export function emptyRule(field: FieldDef): Rule {
  const op = OPERATORS_BY_KIND[field.kind][0].op;
  return {
    type: "rule",
    field: field.name,
    op,
    value: defaultValueFor(field, op),
  };
}

export function defaultValueFor(field: FieldDef, op: Operator): unknown {
  if (op === "set" || op === "not_set") return null;
  if (op === "between") return field.kind === "date" || field.kind === "datetime" ? ["", ""] : [0, 0];
  if (op === "in" || op === "not in") return [];
  switch (field.kind) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "date":
    case "datetime":
      // Match Odoo: pre-fill with today (ISO date) so the picker isn't empty.
      return new Date().toISOString().slice(0, 10);
    case "selection":
      return field.options?.[0]?.value ?? "";
    case "relational":
      return null; // single uuid, or null
    default:
      return "";
  }
}

/** Does this operator need a value input rendered? */
export function operatorHasValue(op: Operator): boolean {
  return op !== "set" && op !== "not_set";
}
