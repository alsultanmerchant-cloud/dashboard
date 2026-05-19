import type { FieldDef } from "./types";

// Field catalog for the `tasks` table — drives the "Add Custom Filter" rule
// builder on the /tasks search bar (Rwasem parity). The first entry is the
// default field on a freshly-opened dialog (see `emptyTree`), so the
// relational "Project" column leads, matching Odoo's muscle memory.
//
// Field kinds drive both the operator menu and the value widget. Relational
// fields point at a `model` slug consumed by `/api/custom-filter/options`.
// Every `name` here is a real column on `public.tasks` so the compiled
// PostgREST clause resolves correctly.

type Translate = (key: string) => string;

export function buildTaskFields(t: Translate): FieldDef[] {
  return [
    // Relational columns first — the dialog opens on `fields[0]`.
    {
      name: "project_id",
      label: t("cf.fields.project"),
      kind: "relational",
      relation: { model: "project" },
    },
    {
      name: "service_id",
      label: t("cf.fields.service"),
      kind: "relational",
      relation: { model: "service" },
    },

    // Text columns.
    { name: "title", label: t("cf.fields.title"), kind: "text" },
    { name: "task_code", label: t("cf.fields.taskCode"), kind: "text" },
    { name: "description", label: t("cf.fields.description"), kind: "text" },

    // Selection columns.
    {
      name: "stage",
      label: t("cf.fields.stage"),
      kind: "selection",
      options: [
        { value: "new", label: t("cf.options.stage.new") },
        { value: "in_progress", label: t("cf.options.stage.inProgress") },
        { value: "manager_review", label: t("cf.options.stage.managerReview") },
        { value: "specialist_review", label: t("cf.options.stage.specialistReview") },
        { value: "ready_to_send", label: t("cf.options.stage.readyToSend") },
        { value: "sent_to_client", label: t("cf.options.stage.sentToClient") },
        { value: "client_changes", label: t("cf.options.stage.clientChanges") },
        { value: "done", label: t("cf.options.stage.done") },
      ],
    },
    {
      name: "priority",
      label: t("cf.fields.priority"),
      kind: "selection",
      options: [
        { value: "low", label: t("cf.options.priority.low") },
        { value: "medium", label: t("cf.options.priority.medium") },
        { value: "high", label: t("cf.options.priority.high") },
        { value: "urgent", label: t("cf.options.priority.urgent") },
      ],
    },
    // `external_source` is "odoo" for synced rows and NULL for dashboard rows.
    // The "__dashboard__" sentinel is rewritten to `is null` by postgrest.ts.
    {
      name: "external_source",
      label: t("cf.fields.externalSource"),
      kind: "selection",
      options: [
        { value: "odoo", label: t("cf.options.externalSource.odoo") },
        { value: "__dashboard__", label: t("cf.options.externalSource.dashboard") },
      ],
    },

    // Date columns.
    { name: "due_date", label: t("cf.fields.dueDate"), kind: "date" },
    { name: "planned_date", label: t("cf.fields.plannedDate"), kind: "date" },
    { name: "actual_done_date", label: t("cf.fields.actualDoneDate"), kind: "date" },
    { name: "start_date", label: t("cf.fields.startDate"), kind: "date" },
    { name: "created_at", label: t("cf.fields.createdOn"), kind: "datetime" },
    { name: "stage_entered_at", label: t("cf.fields.stageEnteredAt"), kind: "datetime" },

    // Number columns.
    { name: "progress_percent", label: t("cf.fields.progress"), kind: "number" },
    { name: "delay_days", label: t("cf.fields.delayDays"), kind: "number" },

    // Boolean columns.
    { name: "is_overdue", label: t("cf.fields.isOverdue"), kind: "boolean" },
    { name: "is_important", label: t("cf.fields.isImportant"), kind: "boolean" },
    { name: "approval_required", label: t("cf.fields.approvalRequired"), kind: "boolean" },
  ];
}

export function getTaskField(
  name: string,
  t: Translate,
): FieldDef | undefined {
  return buildTaskFields(t).find((field) => field.name === name);
}
