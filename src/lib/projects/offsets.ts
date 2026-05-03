/**
 * Sky Light / Rwasem offset-computation engine (phase T4).
 *
 * Translates `task_template_items` (and the new `task_templates.*offset*`
 * columns) into concrete (deadline, upload_due) date pairs for a given
 * project start_date.
 *
 * Sources of truth:
 *   - docs/SPEC_FROM_PDF.md §11 — upload-deadline rules per service.
 *   - existing migration 0014 — seeded offsets for the 3 active services.
 *   - this phase's migration 0024 — adds template-level overrides for
 *     deadline_offset_days + upload_offset_days that win over per-item
 *     values when present.
 *
 * Convention (matches generate-tasks.ts which is already in production):
 *   deadline = project.start_date + offset_days_from_project_start + duration_days
 *   upload   = deadline - upload_offset_days_before_deadline
 *
 * Week split: when a project_services row has week_split=true and weeks=N,
 * each template-item with a non-null `week_index` is replicated for weeks
 * 1..N. Items with `week_index` already set are honored as-is and shifted
 * by (weekIndex - 1) * 7 days. Items with no week_index are NOT replicated
 * (they are once-per-cycle: strategy, monthly approval, scheduling, report).
 */

export type TemplateItemInput = {
  id?: string;
  title: string;
  default_role_key?: string | null;
  default_department_id?: string | null;
  description?: string | null;
  priority?: string | null;
  offset_days_from_project_start: number | null;
  duration_days: number | null;
  upload_offset_days_before_deadline: number | null;
  week_index: number | null;
  order_index?: number | null;
};

export type TemplateInput = {
  id: string;
  service_id: string;
  category_id?: string | null;
  default_owner_position?: string | null;
  deadline_offset_days?: number | null;
  upload_offset_days?: number | null;
  default_followers_positions?: string[] | null;
  items: TemplateItemInput[];
};

export type GeneratedTask = {
  templateId: string;
  templateItemId: string | undefined;
  serviceId: string;
  categoryId: string | null;
  title: string;
  description: string | null;
  priority: string;
  defaultRoleKey: string | null;
  defaultDepartmentId: string | null;
  defaultOwnerPosition: string | null;
  defaultFollowersPositions: string[];
  /** ISO YYYY-MM-DD */
  deadline: string;
  /** ISO YYYY-MM-DD or null when no upload offset is defined */
  uploadDue: string | null;
  weekIndex: number | null;
  orderIndex: number;
};

export type ExpandInput = {
  template: TemplateInput;
  projectStartDate: Date | string;
  /** When true, items with non-null week_index are fanned out for 1..weeks. */
  weekSplit?: boolean;
  weeks?: number | null;
};

const ONE_DAY = 86400000;

function toDate(d: Date | string): Date {
  if (d instanceof Date) return new Date(d.getTime());
  // accept "YYYY-MM-DD" or full ISO; normalise to UTC midnight to keep
  // arithmetic stable across timezones.
  const iso = d.length === 10 ? d + "T00:00:00.000Z" : d;
  return new Date(iso);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * ONE_DAY);
}

/**
 * Compute (deadline, uploadDue) for a single template item, given the
 * concrete week (1-based; 0 means "not weekly").
 */
export function computeItemDeadlines(args: {
  start: Date;
  item: TemplateItemInput;
  templateDeadlineOffsetDays?: number | null;
  templateUploadOffsetDays?: number | null;
  weekIndex: number;
}): { deadline: string; uploadDue: string | null } {
  const offset = args.item.offset_days_from_project_start ?? 0;
  const duration = args.item.duration_days ?? 0;
  // Template-level deadline_offset_days, when present, replaces per-item
  // (offset + duration). Otherwise we sum the two as generate-tasks.ts does.
  const baseDays =
    typeof args.templateDeadlineOffsetDays === "number"
      ? args.templateDeadlineOffsetDays
      : offset + duration;

  const weekShift = args.weekIndex > 0 ? (args.weekIndex - 1) * 7 : 0;
  const deadline = addDays(args.start, baseDays + weekShift);

  const uploadOffset =
    typeof args.templateUploadOffsetDays === "number"
      ? args.templateUploadOffsetDays
      : args.item.upload_offset_days_before_deadline;

  let uploadDue: string | null = null;
  if (typeof uploadOffset === "number") {
    uploadDue = toISO(addDays(deadline, -uploadOffset));
  }

  return { deadline: toISO(deadline), uploadDue };
}

/**
 * Expand one template into the concrete tasks it would generate for a
 * project starting on `projectStartDate`.
 *
 * - Items with `week_index = null` are emitted once.
 * - Items with `week_index = k` are emitted once at week k.
 * - When weekSplit is on AND weeks > 0, items whose `week_index` is null
 *   AND whose title contains a recognisable "weekly" hint are NOT replicated
 *   (we trust the seed data). Items with `week_index` set are replicated for
 *   1..weeks ONLY when their original week_index = 1 (treat as a template
 *   week-1 row); otherwise honoured as-is.
 */
export function expandTemplate(args: ExpandInput): GeneratedTask[] {
  const start = toDate(args.projectStartDate);
  const out: GeneratedTask[] = [];
  const items = [...args.template.items].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
  );

  const weeks = args.weekSplit && args.weeks && args.weeks > 0 ? args.weeks : 0;

  for (const item of items) {
    if (item.week_index != null) {
      // Per-week item from the seed; honour as-is.
      const { deadline, uploadDue } = computeItemDeadlines({
        start,
        item,
        templateDeadlineOffsetDays: args.template.deadline_offset_days,
        templateUploadOffsetDays: args.template.upload_offset_days,
        weekIndex: item.week_index,
      });
      out.push(buildTask(args.template, item, deadline, uploadDue, item.week_index, out.length));
      continue;
    }

    if (weeks > 0 && shouldReplicateForWeeks(item)) {
      for (let w = 1; w <= weeks; w++) {
        const { deadline, uploadDue } = computeItemDeadlines({
          start,
          item,
          templateDeadlineOffsetDays: args.template.deadline_offset_days,
          templateUploadOffsetDays: args.template.upload_offset_days,
          weekIndex: w,
        });
        out.push(buildTask(args.template, item, deadline, uploadDue, w, out.length));
      }
      continue;
    }

    const { deadline, uploadDue } = computeItemDeadlines({
      start,
      item,
      templateDeadlineOffsetDays: args.template.deadline_offset_days,
      templateUploadOffsetDays: args.template.upload_offset_days,
      weekIndex: 0,
    });
    out.push(buildTask(args.template, item, deadline, uploadDue, null, out.length));
  }

  return out;
}

function buildTask(
  template: TemplateInput,
  item: TemplateItemInput,
  deadline: string,
  uploadDue: string | null,
  weekIndex: number | null,
  orderIndex: number,
): GeneratedTask {
  return {
    templateId: template.id,
    templateItemId: item.id,
    serviceId: template.service_id,
    categoryId: template.category_id ?? null,
    title: weekIndex != null && !/الأسبوع/.test(item.title)
      ? `${item.title} — الأسبوع ${weekIndex}`
      : item.title,
    description: item.description ?? null,
    priority: item.priority ?? "medium",
    defaultRoleKey: item.default_role_key ?? null,
    defaultDepartmentId: item.default_department_id ?? null,
    defaultOwnerPosition: template.default_owner_position ?? null,
    defaultFollowersPositions: template.default_followers_positions ?? [],
    deadline,
    uploadDue,
    weekIndex,
    orderIndex,
  };
}

/**
 * Heuristic — items without an explicit `week_index` that should still fan
 * out across weeks. Currently nothing: the existing seeds already encode
 * per-week items via `week_index`, so non-weekly rows are once-per-cycle.
 * Kept as a function so future templates (e.g. the Odoo import) can opt in.
 */
function shouldReplicateForWeeks(_item: TemplateItemInput): boolean {
  return false;
}

/**
 * Multi-template expansion — used by createProject. Sorts the resulting
 * tasks by deadline ascending so the UI preview reads naturally.
 */
export function expandTemplates(
  inputs: ExpandInput[],
): GeneratedTask[] {
  const all = inputs.flatMap((i) => expandTemplate(i));
  all.sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : a.orderIndex - b.orderIndex));
  return all;
}
