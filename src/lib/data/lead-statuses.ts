// Client-safe constants — pipeline stages with labels + ordering.

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "جديد",
  contacted: "تم التواصل",
  qualified: "مؤهَّل",
  proposal: "عرض مرسَل",
  won: "مُغلَق ربح",
  lost: "مُغلَق خسارة",
};

// Open stages = anything not won/lost
export const OPEN_LEAD_STATUSES: ReadonlyArray<LeadStatus> = [
  "new", "contacted", "qualified", "proposal",
];

// Color tone per stage for badges + bars
export const LEAD_STATUS_TONE: Record<
  LeadStatus,
  "default" | "info" | "warning" | "success" | "destructive" | "purple"
> = {
  new: "default",
  contacted: "info",
  qualified: "purple",
  proposal: "warning",
  won: "success",
  lost: "destructive",
};
