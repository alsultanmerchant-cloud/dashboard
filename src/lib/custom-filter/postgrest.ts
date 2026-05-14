import type { FieldDef, FilterTree, Group, Node, Operator, Rule } from "./types";

// Translate a FilterTree into a single PostgREST `or=()` / `and=()` clause
// suitable for `query.or(clause)` / `query.and(clause)` (we always emit a
// top-level clause and apply it once).
//
// Reference: https://postgrest.org/en/stable/references/api/tables_views.html#logical-operators
//   - `or=(field.op.value,field.op.value)`
//   - `and=(field.op.value,or(field.op.value,…))`
//   - Values are url-safe inside the parens but commas / parens INSIDE values
//     must be quoted: `"foo,bar"`.
//
// The translator is whitelist-driven by `fieldLookup`: any rule referencing a
// field that isn't in the catalog is silently dropped (defence-in-depth — we
// never want a malicious URL pushing arbitrary column names into the query).

type FieldLookup = (name: string) => FieldDef | undefined;

const OP_MAP: Partial<Record<Operator, string>> = {
  "=": "eq",
  "!=": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  "ilike": "ilike",
  "not ilike": "not.ilike",
  "in": "in",
  "not in": "not.in",
};

function quote(value: string): string {
  // PostgREST treats `,()` as syntax; wrap values containing them in quotes.
  // It also requires escaping double-quotes inside quoted values with `\"`.
  if (/[\s,()"]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function valueToScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function ilikePattern(value: unknown): string {
  // "contains" wraps the user input with `%`. Empty strings → match-all (`%%`).
  const raw = valueToScalar(value);
  return `*${raw}*`;
}

function compileRule(rule: Rule, lookup: FieldLookup): string | null {
  const field = lookup(rule.field);
  if (!field) return null;

  switch (rule.op) {
    case "set":
      // IS NOT NULL → `field=not.is.null`
      return `${rule.field}.not.is.null`;
    case "not_set":
      return `${rule.field}.is.null`;
    case "in":
    case "not in": {
      const values = Array.isArray(rule.value) ? rule.value : [];
      if (values.length === 0) return null;
      const list = values.map((v) => quote(valueToScalar(v))).join(",");
      const opPath = rule.op === "in" ? "in" : "not.in";
      return `${rule.field}.${opPath}.(${list})`;
    }
    case "between": {
      const [from, to] = Array.isArray(rule.value) ? rule.value : ["", ""];
      const fromStr = valueToScalar(from);
      const toStr = valueToScalar(to);
      if (!fromStr && !toStr) return null;
      if (!fromStr) return `${rule.field}.lte.${quote(toStr)}`;
      if (!toStr) return `${rule.field}.gte.${quote(fromStr)}`;
      return `and(${rule.field}.gte.${quote(fromStr)},${rule.field}.lte.${quote(toStr)})`;
    }
    case "ilike":
    case "not ilike": {
      const pattern = ilikePattern(rule.value);
      const opPath = rule.op === "ilike" ? "ilike" : "not.ilike";
      return `${rule.field}.${opPath}.${quote(pattern)}`;
    }
    default: {
      const pgOp = OP_MAP[rule.op];
      if (!pgOp) return null;
      const v = valueToScalar(rule.value);
      if (!v && rule.op !== "=" && rule.op !== "!=") return null;
      return `${rule.field}.${pgOp}.${quote(v)}`;
    }
  }
}

function compileGroup(group: Group, lookup: FieldLookup): string | null {
  const parts: string[] = [];
  for (const child of group.children) {
    const compiled = compileNode(child, lookup);
    if (compiled) parts.push(compiled);
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const joiner = group.connector === "and" ? "and" : "or";
  return `${joiner}(${parts.join(",")})`;
}

function compileNode(node: Node, lookup: FieldLookup): string | null {
  return node.type === "rule" ? compileRule(node, lookup) : compileGroup(node, lookup);
}

/**
 * Compile the tree into a single PostgREST clause body suitable for
 * `query.or(clause)`. Supabase-js doesn't expose a `.and()` builder, so we
 * always emit through `.or()` — when the top-level connector is "and" we
 * wrap the children in `and(...)` so the resulting URL still evaluates
 * correctly (an OR over a single AND group is identity).
 *
 * Returns null when the tree contains no usable rules (e.g. an empty `in`
 * value or a field that isn't in the catalog).
 */
export type CompiledFilter = {
  clause: string;
};

export function compileFilterTree(tree: FilterTree, lookup: FieldLookup): CompiledFilter | null {
  if (tree.children.length === 0) return null;
  const childClauses: string[] = [];
  for (const child of tree.children) {
    const c = compileNode(child, lookup);
    if (c) childClauses.push(c);
  }
  if (childClauses.length === 0) return null;
  if (tree.connector === "and") {
    // Wrap in an AND group; .or() will treat it as a single member.
    if (childClauses.length === 1) return { clause: childClauses[0] };
    return { clause: `and(${childClauses.join(",")})` };
  }
  // OR: just a comma-joined list (which is what .or() expects natively).
  return { clause: childClauses.join(",") };
}
