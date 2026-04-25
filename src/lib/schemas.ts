import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const arabicEmail = z.string().trim().toLowerCase().email({ message: "بريد إلكتروني غير صالح" });

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
  client_id: z.string().uuid({ message: "اختر العميل" }),
  name: z.string().trim().min(3, { message: "اسم المشروع قصير جدًا" }),
  description: optionalString,
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  status: z.enum(["active", "on_hold", "completed", "cancelled"]).default("active"),
  start_date: z.union([z.literal(""), z.string()]).optional().nullable().transform((v) => v || null),
  end_date: z.union([z.literal(""), z.string()]).optional().nullable().transform((v) => v || null),
  account_manager_employee_id: z
    .union([z.literal(""), z.string().uuid()])
    .optional()
    .nullable()
    .transform((v) => v || null),
  service_ids: z.array(z.string().uuid()).default([]),
  generate_tasks: z.boolean().default(true),
});
export type ProjectCreateInput = z.infer<typeof ProjectCreateSchema>;

export const TaskStatusUpdateSchema = z.object({
  task_id: z.string().uuid(),
  status: z.enum(["todo", "in_progress", "review", "blocked", "done", "cancelled"]),
});

export const TaskCommentSchema = z.object({
  task_id: z.string().uuid(),
  body: z.string().trim().min(1, { message: "اكتب التعليق" }).max(4000),
  is_internal: z.boolean().default(true),
});
