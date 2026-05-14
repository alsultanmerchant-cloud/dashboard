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

export const PROJECT_FIELDS: FieldDef[] = [
  // Relational fields first — the dialog opens on `fields[0]` and Odoo
  // defaults to "Project Manager", so do the same here.
  {
    name: "project_manager_employee_id",
    label: "Project Manager",
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "account_manager_employee_id",
    label: "Account Manager",
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "client_id",
    label: "Client",
    kind: "relational",
    relation: { model: "client" },
  },
  {
    name: "social_specialist_id",
    label: "Social Specialist",
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "media_specialist_id",
    label: "Media Specialist",
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "seo_specialist_id",
    label: "SEO Specialist",
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "social_manager_id",
    label: "Social Manager",
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "media_manager_id",
    label: "Media Manager",
    kind: "relational",
    relation: { model: "employee" },
  },
  {
    name: "seo_manager_id",
    label: "SEO Manager",
    kind: "relational",
    relation: { model: "employee" },
  },

  // Scalar columns — text first, then selection / date / number / boolean.
  { name: "name", label: "Name", kind: "text" },
  { name: "project_code", label: "Project Code", kind: "text" },
  { name: "description", label: "Description", kind: "text" },
  { name: "store_name", label: "Store Name", kind: "text" },
  { name: "target", label: "Target", kind: "text" },
  { name: "package_name", label: "Package", kind: "text" },
  { name: "duration_label", label: "Duration Label", kind: "text" },
  { name: "site_address_display", label: "Site Address", kind: "text" },

  {
    name: "status",
    label: "Status",
    kind: "selection",
    options: [
      { value: "active", label: "Active" },
      { value: "on_hold", label: "On Hold" },
      { value: "completed", label: "Completed" },
      { value: "cancelled", label: "Cancelled" },
    ],
  },
  {
    name: "priority",
    label: "Priority",
    kind: "selection",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "urgent", label: "Urgent" },
    ],
  },

  { name: "start_date", label: "Start Date", kind: "date" },
  { name: "end_date", label: "End Date", kind: "date" },
  { name: "next_renewal_date", label: "Next Renewal Date", kind: "date" },
  { name: "created_at", label: "Created On", kind: "datetime" },
  { name: "updated_at", label: "Last Updated On", kind: "datetime" },
  { name: "held_at", label: "Held On", kind: "datetime" },

  { name: "is_favorite", label: "Favorite", kind: "boolean" },
  { name: "cycle_length_months", label: "Cycle Length (months)", kind: "number" },
  { name: "total_progress", label: "Progress", kind: "number" },
  { name: "document_count", label: "Document Count", kind: "number" },
  { name: "color", label: "Color (0–11)", kind: "number" },
  { name: "task_seq", label: "Task Sequence", kind: "number" },
];

/** Quick lookup by column name. */
export const PROJECT_FIELD_MAP: Record<string, FieldDef> = Object.fromEntries(
  PROJECT_FIELDS.map((f) => [f.name, f]),
);

export function getProjectField(name: string): FieldDef | undefined {
  return PROJECT_FIELD_MAP[name];
}
