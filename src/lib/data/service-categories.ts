import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type CategoryListRow = {
  id: string;
  key: string;
  name_ar: string;
  name_en: string | null;
  color: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  service_id: string | null;
  service_name: string | null;
  service_slug: string | null;
  template_count: number;
};

/**
 * List service_categories for an org with the linked service summary and
 * a quick template-count rollup. Used by /service-categories admin UI.
 */
export async function listServiceCategories(orgId: string): Promise<CategoryListRow[]> {
  const { data, error } = await supabaseAdmin
    .from("service_categories")
    .select(
      `id, key, name_ar, name_en, color, description, sort_order, is_active, service_id,
       service:services ( name, slug ),
       task_templates ( id )`,
    )
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true })
    .order("name_ar", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const service = Array.isArray(row.service) ? row.service[0] : row.service;
    const templates = Array.isArray(row.task_templates) ? row.task_templates : [];
    return {
      id: row.id,
      key: row.key,
      name_ar: row.name_ar,
      name_en: row.name_en,
      color: row.color,
      description: row.description,
      sort_order: row.sort_order ?? 0,
      is_active: row.is_active ?? true,
      service_id: row.service_id,
      service_name: service?.name ?? null,
      service_slug: service?.slug ?? null,
      template_count: templates.length,
    };
  });
}

/**
 * Read the templates + items needed to render the new-project preview pane.
 * Returns templates already filtered to the requested service-or-category set
 * and includes the items each will expand into.
 */
export type TemplateWithItems = {
  id: string;
  service_id: string;
  category_id: string | null;
  name: string;
  default_owner_position: string | null;
  deadline_offset_days: number | null;
  upload_offset_days: number | null;
  default_followers_positions: string[];
  items: {
    id: string;
    title: string;
    description: string | null;
    priority: string;
    default_role_key: string | null;
    default_department_id: string | null;
    offset_days_from_project_start: number | null;
    duration_days: number | null;
    upload_offset_days_before_deadline: number | null;
    week_index: number | null;
    order_index: number;
  }[];
};

export async function listTemplatesForServices(
  orgId: string,
  serviceIds: string[],
): Promise<TemplateWithItems[]> {
  if (serviceIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("task_templates")
    .select(
      `id, service_id, category_id, name, default_owner_position,
       deadline_offset_days, upload_offset_days, default_followers_positions,
       task_template_items (
         id, title, description, priority, default_role_key, default_department_id,
         offset_days_from_project_start, duration_days,
         upload_offset_days_before_deadline, week_index, order_index
       )`,
    )
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .in("service_id", serviceIds);
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id,
    service_id: t.service_id,
    category_id: t.category_id ?? null,
    name: t.name,
    default_owner_position: t.default_owner_position ?? null,
    deadline_offset_days: t.deadline_offset_days ?? null,
    upload_offset_days: t.upload_offset_days ?? null,
    default_followers_positions: Array.isArray(t.default_followers_positions)
      ? (t.default_followers_positions as string[])
      : [],
    items: (t.task_template_items ?? [])
      .map((it) => ({
        id: it.id,
        title: it.title,
        description: it.description,
        priority: it.priority ?? "medium",
        default_role_key: it.default_role_key ?? null,
        default_department_id: it.default_department_id ?? null,
        offset_days_from_project_start: it.offset_days_from_project_start ?? 0,
        duration_days: it.duration_days ?? 0,
        upload_offset_days_before_deadline: it.upload_offset_days_before_deadline ?? null,
        week_index: it.week_index ?? null,
        order_index: it.order_index ?? 0,
      }))
      .sort((a, b) => a.order_index - b.order_index),
  }));
}
