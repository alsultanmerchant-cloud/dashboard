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
  social_specialist_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
  media_specialist_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
  seo_specialist_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
  // Section heads per specialty (PDF §9 tier 4 — accountable for quality).
  social_manager_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
  media_manager_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
  seo_manager_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
  service_ids: z.array(uuidLoose).default([]),
  generate_tasks: z.boolean().default(true),
  // New-project wizard additions:
  package_name: optionalString,
  duration_label: optionalString,
  /** Followers picked at create time (employee_profiles.id list). */
  follower_employee_ids: z.array(uuidLoose).default([]),
  /** When set, every auto-generated task gets this employee as an extra
   *  agent assignee (in addition to the role inferred from the template). */
  constant_assignee_employee_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
  // Per-service overrides (T4 categories engine). Keyed by service_id.
  // `weeks` only honored when `week_split` is true; clamped to 1..12.
  service_week_splits: z
    .array(
      z.object({
        service_id: uuidLoose,
        week_split: z.boolean().default(false),
        weeks: z.number().int().min(1).max(12).nullable().default(null),
        category_id: z.union([z.literal(""), uuidLoose]).optional().nullable().transform((v) => v || null),
      }),
    )
    .default([]),
});
export type ProjectCreateInput = z.infer<typeof ProjectCreateSchema>;

export const TaskStatusUpdateSchema = z.object({
  task_id: uuidLoose,
  status: z.enum(["todo", "in_progress", "review", "blocked", "done", "cancelled"]),
});

export const TASK_STAGE_VALUES = [
  "new",
  "in_progress",
  "manager_review",
  "specialist_review",
  "ready_to_send",
  "sent_to_client",
  "client_changes",
  "done",
] as const;

export const TaskStageUpdateSchema = z.object({
  task_id: uuidLoose,
  stage: z.enum(TASK_STAGE_VALUES),
});

export const TASK_ROLE_VALUES = ["specialist", "manager", "agent", "account_manager"] as const;

// Set/clear a task assignee for a single named slot.
// employee_id = null clears the slot.
export const TaskRoleAssignSchema = z.object({
  task_id: uuidLoose,
  role_type: z.enum(TASK_ROLE_VALUES),
  employee_id: z
    .union([z.literal(""), z.null(), uuidLoose])
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
});

// Sky Light WhatsApp group upsert.
export const WhatsAppGroupUpsertSchema = z.object({
  project_id: uuidLoose,
  kind: z.enum(["client", "internal"]),
  name: z.string().trim().min(2, { message: "اسم القروب قصير جدًا" }).max(200),
  invite_url: optionalString,
  whatsapp_chat_id: optionalString,
  notes: optionalString,
});

export const TaskCommentAttachmentSchema = z.object({
  storage_path: z.string().min(1).max(1024),
  filename: z.string().trim().min(1).max(512),
  mimetype: z.string().trim().max(255).optional().nullable(),
  size_bytes: z.number().int().nonnegative().max(50 * 1024 * 1024).optional().nullable(),
});

export const TaskCommentSchema = z.object({
  task_id: uuidLoose,
  body: z.string().trim().min(1, { message: "اكتب التعليق" }).max(4000),
  is_internal: z.boolean().default(true),
  kind: z
    .enum(["note", "requirements", "modification"])
    .default("note"),
  attachments: z.array(TaskCommentAttachmentSchema).max(10).optional().default([]),
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

const slugRegex = /^[a-z0-9-]+$/;

export const DepartmentCreateSchema = z.object({
  name: z.string().trim().min(2, { message: "اسم القسم قصير جدًا" }),
  slug: z.string().trim().min(2).regex(slugRegex, { message: "أحرف لاتينية صغيرة وأرقام وشرطات فقط" }),
  description: optionalString,
  parent_department_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
});
export type DepartmentCreateInput = z.infer<typeof DepartmentCreateSchema>;

export const EmployeeInviteSchema = z.object({
  full_name: z.string().trim().min(2, { message: "الاسم قصير جدًا" }),
  email: arabicEmail,
  phone: optionalString,
  position_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
  department_id: z
    .union([z.literal(""), uuidLoose])
    .optional()
    .nullable()
    .transform((v) => v || null),
  role_id: uuidLoose,
});
export type EmployeeInviteInput = z.infer<typeof EmployeeInviteSchema>;
