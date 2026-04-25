// Status / enum → Arabic label maps. Keep aligned with DB CHECK constraints.

export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "review",
  "blocked",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "قيد الانتظار",
  in_progress: "قيد التنفيذ",
  review: "قيد المراجعة",
  blocked: "متوقفة",
  done: "مكتملة",
  cancelled: "ملغاة",
};

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  urgent: "عاجلة",
};

export const PROJECT_STATUSES = ["active", "on_hold", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "نشط",
  on_hold: "متوقف مؤقتًا",
  completed: "مكتمل",
  cancelled: "ملغى",
};

export const HANDOVER_STATUSES = ["submitted", "in_review", "accepted", "rejected"] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];
export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  submitted: "تم الإرسال",
  in_review: "قيد المراجعة",
  accepted: "مقبول",
  rejected: "مرفوض",
};

export const URGENCY_LEVELS = ["low", "normal", "high", "critical"] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];
export const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  low: "منخفض",
  normal: "عادي",
  high: "عالٍ",
  critical: "حرج",
};

export const CLIENT_STATUSES = ["active", "inactive", "lead"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: "نشط",
  inactive: "غير نشط",
  lead: "محتمل",
};

export const EMPLOYMENT_STATUSES = [
  "active",
  "on_leave",
  "suspended",
  "terminated",
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  active: "على رأس العمل",
  on_leave: "في إجازة",
  suspended: "موقوف",
  terminated: "خارج الخدمة",
};

export const AI_EVENT_LABELS: Record<string, string> = {
  HANDOVER_SUBMITTED: "تسليم جديد من المبيعات",
  PROJECT_CREATED: "مشروع جديد",
  PROJECT_SERVICE_ATTACHED: "إضافة خدمة لمشروع",
  TASK_CREATED: "مهمة جديدة",
  TASK_STATUS_CHANGED: "تغيير حالة مهمة",
  TASK_COMMENT_ADDED: "تعليق جديد على مهمة",
  MENTION_CREATED: "إشارة لموظف",
  NOTIFICATION_CREATED: "تنبيه جديد",
  TASK_OVERDUE_DETECTED: "مهمة متأخرة",
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "المالك",
  admin: "مسؤول النظام",
  manager: "مدير",
  sales: "مبيعات",
  account_manager: "مدير حساب",
  specialist: "متخصص",
  designer: "مصمم",
  viewer: "قارئ فقط",
};
