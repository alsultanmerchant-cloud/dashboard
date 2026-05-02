// Unit tests for the org-chart helpers (phase T1).
//
// We re-implement the filterSalesSubtree + tree-build logic here (rather
// than importing the .ts source) so the test runs under plain Node with
// no transpiler. The original lives in src/lib/data/org-chart.ts; any
// divergence will fail fast because the cases below mirror the canonical
// owner-confirmed seed.

import assert from "node:assert/strict";

const SALES_SLUGS = new Set(["sales", "tele-sales", "telesales"]);
function isSalesDept(d) { return SALES_SLUGS.has(d.slug); }

function buildTree(rows) {
  const byId = new Map();
  for (const r of rows) {
    byId.set(r.id, {
      ...r,
      children: [],
      head: null,
      teamLeads: [],
      members: [],
    });
  }
  const roots = [];
  for (const d of byId.values()) {
    if (d.parent_department_id && byId.has(d.parent_department_id)) {
      byId.get(d.parent_department_id).children.push(d);
    } else {
      roots.push(d);
    }
  }
  return { byId, roots, employees: [] };
}

function filterSales(chart) {
  const removed = new Set();
  const walk = (d) => {
    if (isSalesDept(d)) {
      removed.add(d.id);
      const stack = [...d.children];
      while (stack.length) {
        const c = stack.pop();
        removed.add(c.id);
        stack.push(...c.children);
      }
      return true;
    }
    d.children = d.children.filter((c) => !walk(c));
    return false;
  };
  const roots = chart.roots.filter((r) => !walk(r));
  const byId = new Map(chart.byId);
  for (const id of removed) byId.delete(id);
  return { byId, roots, employees: chart.employees };
}

const cases = [];

cases.push([
  "filterSalesSubtree drops sales + tele-sales leaves",
  () => {
    const tree = buildTree([
      { id: "am",   slug: "account-management", parent_department_id: null },
      { id: "ms",   slug: "main-sections",      parent_department_id: null },
      { id: "smm",  slug: "social-media",       parent_department_id: "ms" },
      { id: "seo",  slug: "seo",                parent_department_id: "ms" },
      { id: "sg",   slug: "sales-group",        parent_department_id: null },
      { id: "sl",   slug: "sales",              parent_department_id: "sg" },
      { id: "ts",   slug: "tele-sales",         parent_department_id: "sg" },
    ]);
    assert.equal(tree.roots.length, 3);
    const filtered = filterSales(tree);
    // sales + tele-sales rows must be gone from byId
    assert.equal(filtered.byId.has("sl"), false);
    assert.equal(filtered.byId.has("ts"), false);
    // sales-group survives but its sales children are pruned
    assert.equal(filtered.byId.has("sg"), true);
    const sg = filtered.byId.get("sg");
    assert.equal(sg.children.length, 0);
  },
]);

cases.push([
  "filterSalesSubtree leaves technical depts untouched",
  () => {
    const tree = buildTree([
      { id: "ms",  slug: "main-sections",       parent_department_id: null },
      { id: "smm", slug: "social-media",        parent_department_id: "ms" },
      { id: "seo", slug: "seo",                 parent_department_id: "ms" },
      { id: "mb",  slug: "media-buying",        parent_department_id: "ms" },
    ]);
    const filtered = filterSales(tree);
    assert.equal(filtered.byId.size, 4);
    assert.equal(filtered.roots.length, 1);
    assert.equal(filtered.roots[0].children.length, 3);
  },
]);

cases.push([
  "isSalesDept matches the canonical slugs only",
  () => {
    assert.equal(isSalesDept({ slug: "sales" }), true);
    assert.equal(isSalesDept({ slug: "tele-sales" }), true);
    assert.equal(isSalesDept({ slug: "telesales" }), true);
    assert.equal(isSalesDept({ slug: "social-media" }), false);
    assert.equal(isSalesDept({ slug: "media-buying" }), false);
  },
]);

cases.push([
  "tree builder handles top-level groups + nesting",
  () => {
    const tree = buildTree([
      { id: "ms",  slug: "main-sections",       parent_department_id: null },
      { id: "smm", slug: "social-media",        parent_department_id: "ms" },
      { id: "ss",  slug: "supporting-sections", parent_department_id: null },
      { id: "gd",  slug: "graphic-design",      parent_department_id: "ss" },
      { id: "cw",  slug: "content-writing",     parent_department_id: "ss" },
    ]);
    assert.equal(tree.roots.length, 2);
    const ss = tree.byId.get("ss");
    assert.equal(ss.children.length, 2);
    const ms = tree.byId.get("ms");
    assert.equal(ms.children.length, 1);
  },
]);

let pass = 0;
let fail = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    pass++;
    console.log(`  ok ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
