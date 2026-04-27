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

// Sky Light / Rwasem 8-stage workflow.
// Order matters — used to render the kanban left-to-right.
export const TASK_STAGES = [
  "new",
  "in_progress",
  "manager_review",
  "specialist_review",
  "ready_to_send",
  "sent_to_client",
  "client_changes",
  "done",
] as const;
export type TaskStage = (typeof TASK_STAGES)[number];

export const TASK_STAGE_LABELS: Record<TaskStage, string> = {
  new: "جديدة",
  in_progress: "قيد التنفيذ",
  manager_review: "مراجعة المدير",
  specialist_review: "مراجعة المتخصص",
  ready_to_send: "جاهزة للإرسال",
  sent_to_client: "أُرسلت للعميل",
  client_changes: "تعديلات العميل",
  done: "مكتملة",
};

export const TASK_STAGE_LABELS_EN: Record<TaskStage, string> = {
  new: "New",
  in_progress: "In Progress",
  manager_review: "Manager Review",
  specialist_review: "Specialist Review",
  ready_to_send: "Ready to Send",
  sent_to_client: "Sent to Client",
  client_changes: "Client Changes",
  done: "Done",
};

// Tailwind tokens for stage chips and column headers.
// Picked to read on the dark "command-center" surface.
export const TASK_STAGE_TONES: Record<TaskStage, string> = {
  new: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  in_progress: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  manager_review: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  specialist_review: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ready_to_send: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  sent_to_client: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  client_changes: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  done: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

// Sky Light role colors per the manual (Specialist=yellow, Manager=blue, Agent=green, AM=red).
export const TASK_ROLE_TYPES = [
  "specialist",
  "manager",
  "agent",
  "account_manager",
] as const;
export type TaskRoleType = (typeof TASK_ROLE_TYPES)[number];

export const TASK_ROLE_LABELS: Record<TaskRoleType, string> = {
  specialist: "المتخصص",
  manager: "المدير",
  agent: "المنفذ",
  account_manager: "مدير الحساب",
};

export const TASK_ROLE_TONES: Record<TaskRoleType, string> = {
  specialist: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  manager: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  agent: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  account_manager: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

// Sky Light org structure (PDF). Used to filter task role pickers and
// to render the grouped department picker on the employee invite form.
export const DEPARTMENT_KINDS = [
  "group",
  "account_management",
  "main_section",
  "supporting_section",
  "quality_control",
  "other",
] as const;
export type DepartmentKind = (typeof DEPARTMENT_KINDS)[number];

export const DEPARTMENT_KIND_LABELS: Record<DepartmentKind, string> = {
  group: "مجموعة",
  account_management: "إدارة الحسابات",
  main_section: "الأقسام الأساسية",
  supporting_section: "الأقسام المساندة",
  quality_control: "الجودة",
  other: "أخرى",
};

// Which department kinds each task role draws from per the PDF.
// AM talks to client; Specialist defines requirements (Social/SEO/Media);
// Agent executes (Design/Content/Video/Programming); Manager distributes
// work and is typically a head of a Main or Supporting section.
export const TASK_ROLE_ELIGIBLE_KINDS: Record<TaskRoleType, DepartmentKind[]> = {
  account_manager: ["account_management"],
  specialist: ["main_section"],
  manager: ["main_section", "supporting_section"],
  agent: ["supporting_section"],
};
