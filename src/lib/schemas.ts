import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const arabicEmail = z.string().trim().toLowerCase().email({ message: "بريد إلكتروني غير صالح" });

// Zod's strict `.uuid()` rejects our seeded fixture UUIDs (variant nibble != 8/9/a/b).
// We accept any 36-char hex+hyphen pattern to keep both gen_random_uuid() rows AND
// our nice-looking seed UUIDs (e.g. 22222222-1111-1111-1111-000000000001) valid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidLoose = z.string().regex(UUID_RE, { message: "معرّف غير صالح" });

export const ClientCreateSchema = z.object({
  name: z.string().trim().min(2, { message: "اسم العميل قصير جدًا" }),
  contact_name: optionalString,
  phone: optionalString,
  email: z.union([z.literal(""), arabicEmail]).optional().nullable().transform((v) => v || null),
  company_website: optionalString,
  source: optionalString,
  status: z.enum(["active", "inactive", "lead"]).default("active"),
  notes: optionalString,
});
export type ClientCreateInput = z.infer<typeof ClientCreateSchema>;

export const ProjectCreateSchema = z.object({
  client_id: uuidLoose,
  name: z.string().trim().min(3, { message: "اسم المشروع قصير جدًا" }),
  description: optionalString,
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  status: z.enum(["active", "on_hold", "completed", "cancelled"]).default("active"),
  start_date: z.union([z.literal(""), z.string()]).optional().nullable().transform((v) => v || null),
  end_date: z.union([z.literal(""), z.string()]).optional().nullable().transform((v) => v || null),
  account_manager_employee_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
  service_ids: z.array(uuidLoose).default([]),
  generate_tasks: z.boolean().default(true),
});
export type ProjectCreateInput = z.infer<typeof ProjectCreateSchema>;

export const TaskStatusUpdateSchema = z.object({
  task_id: uuidLoose,
  status: z.enum(["todo", "in_progress", "review", "blocked", "done", "cancelled"]),
});

export const TaskCommentSchema = z.object({
  task_id: uuidLoose,
  body: z.string().trim().min(1, { message: "اكتب التعليق" }).max(4000),
  is_internal: z.boolean().default(true),
});

export const HandoverSubmitSchema = z.object({
  client_name: z.string().trim().min(2, { message: "اسم العميل قصير" }),
  client_contact_name: optionalString,
  client_phone: optionalString,
  client_email: z
    .union([z.literal(""), arabicEmail])
    .optional()
    .nullable()
    .transform((v) => v || null),
  selected_service_ids: z
    .array(uuidLoose)
    .min(1, { message: "اختر خدمة واحدة على الأقل" }),
  package_details: optionalString,
  project_start_date: z
    .union([z.literal(""), z.string()])
    .optional()
    .nullable()
    .transform((v) => v || null),
  urgency_level: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  sales_notes: optionalString,
  assigned_account_manager_employee_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
});
export type HandoverSubmitInput = z.infer<typeof HandoverSubmitSchema>;
