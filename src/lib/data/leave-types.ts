// Client-safe constants for the HR leave module.

export const LEAVE_TYPES = [
  "annual",
  "sick",
  "unpaid",
  "maternity",
  "paternity",
  "compassionate",
  "other",
] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: "إجازة سنوية",
  sick: "إجازة مرضية",
  unpaid: "إجازة بدون راتب",
  maternity: "أمومة",
  paternity: "أبوّة",
  compassionate: "اضطرارية",
  other: "أخرى",
};

export const LEAVE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;

export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "قيد المراجعة",
  approved: "معتمدة",
  rejected: "مرفوضة",
  cancelled: "ملغاة",
};

export const LEAVE_STATUS_BADGE: Record<LeaveStatus, string> = {
  pending:   "border-amber/40 bg-amber-dim text-amber",
  approved:  "border-cc-green/40 bg-green-dim text-cc-green",
  rejected:  "border-cc-red/40 bg-red-dim text-cc-red",
  cancelled: "border-white/[0.08] bg-white/[0.02] text-muted-foreground",
};
