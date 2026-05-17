import type { FieldDef } from "./types";

// Field catalog for the `projects` table. The ORDER here matters: the first
// entry is used as the default field on a freshly-opened "Add Custom Filter"
// dialog (the `emptyTree` helper picks `fields[0]`). Odoo defaults a fresh
// custom filter to "Project Manager · is in" — so we put the relational
// columns at the top of the list to match that muscle memory, and the
// scalar columns (Name, Status, …) come after.
//
// Inside the field combobox the list is alphabetised for search-ability, so
// this order only affects the initial-row default; the user sees A→Z when
// they open the picker.
//
// Field kinds drive both the operator menu and the value widget. Relational
// fields point at a `model` slug consumed by `/api/custom-filter/options`.

type Translate = (key: string) => string;

export function buildProjectFields(t: Translate): FieldDef[] {
  return [
  // Relational fields first — the dialog opens on `fields[0]` and Odoo
  // defaults to "Project Manager", so do the same here.
  {
    name: "project_manager_employee_id",
    label: t("fields.projectManager"),
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "account_manager_employee_id",
    label: t("fields.accountManager"),
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "client_id",
    label: t("fields.client"),
    kind: "relational",
    relation: { model: "client" },
  },
  {
    name: "social_specialist_id",
    label: t("fields.socialSpecialist"),
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "media_specialist_id",
    label: t("fields.mediaSpecialist"),
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "seo_specialist_id",
    label: t("fields.seoSpecialist"),
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "social_manager_id",
    label: t("fields.socialManager"),
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "media_manager_id",
    label: t("fields.mediaManager"),
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "seo_manager_id",
    label: t("fields.seoManager"),
    kind: "relational",
    relation: { model: "employee" },
  },

  // Scalar columns — text first, then selection / date / number / boolean.
  { name: "name", label: t("fields.name"), kind: "text" },
  { name: "project_code", label: t("fields.projectCode"), kind: "text" },
  { name: "description", label: t("fields.description"), kind: "text" },
  { name: "store_name", label: t("fields.storeName"), kind: "text" },
  { name: "target", label: t("fields.target"), kind: "text" },
  { name: "package_name", label: t("fields.package"), kind: "text" },
  { name: "duration_label", label: t("fields.durationLabel"), kind: "text" },
  { name: "site_address_display", label: t("fields.siteAddress"), kind: "text" },

  {
    name: "status",
    label: t("fields.status"),
    kind: "selection",
    options: [
      { value: "active", label: t("options.status.active") },
      { value: "on_hold", label: t("options.status.onHold") },
      { value: "completed", label: t("options.status.completed") },
      { value: "cancelled", label: t("options.status.cancelled") },
    ],
  },
  {
    name: "priority",
    label: t("fields.priority"),
    kind: "selection",
    options: [
      { value: "low", label: t("options.priority.low") },
      { value: "medium", label: t("options.priority.medium") },
      { value: "high", label: t("options.priority.high") },
      { value: "urgent", label: t("options.priority.urgent") },
    ],
  },
  // PR-F (#3): origin saved-filter chip. `external_source` is "odoo" for
  // rows synced from the Odoo deployment and NULL for rows created in the
  // dashboard. The "Dashboard" option is a sentinel — the postgrest compiler
  // rewrites `external_source = __dashboard__` into `is null` (see
  // postgrest.ts) so the picklist can offer both origins like Odoo does.
  {
    name: "external_source",
    label: t("fields.externalSource"),
    kind: "selection",
    options: [
      { value: "odoo", label: t("options.externalSource.odoo") },
      { value: "__dashboard__", label: t("options.externalSource.dashboard") },
    ],
  },

  { name: "start_date", label: t("fields.startDate"), kind: "date" },
  { name: "end_date", label: t("fields.endDate"), kind: "date" },
  { name: "next_renewal_date", label: t("fields.nextRenewalDate"), kind: "date" },
  { name: "created_at", label: t("fields.createdOn"), kind: "datetime" },
  { name: "updated_at", label: t("fields.lastUpdatedOn"), kind: "datetime" },
  { name: "held_at", label: t("fields.heldOn"), kind: "datetime" },

  { name: "is_favorite", label: t("fields.favorite"), kind: "boolean" },
  { name: "cycle_length_months", label: t("fields.cycleLengthMonths"), kind: "number" },
  { name: "total_progress", label: t("fields.progress"), kind: "number" },
  { name: "document_count", label: t("fields.documentCount"), kind: "number" },
  { name: "color", label: t("fields.color"), kind: "number" },
  { name: "task_seq", label: t("fields.taskSequence"), kind: "number" },
];
}

export function getProjectField(
  name: string,
  t: Translate,
): FieldDef | undefined {
  return buildProjectFields(t).find((field) => field.name === name);
}
