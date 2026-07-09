// Client-safe case-status vocabulary (the store that reads/writes these is
// server-only, so the shared types/labels live here for the UI to import).

export type CaseStatus = "open" | "under_review" | "excused" | "warned" | "resolved";

export const CASE_STATUSES: CaseStatus[] = [
  "open",
  "under_review",
  "excused",
  "warned",
  "resolved",
];

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  open: "جديدة",
  under_review: "قيد المراجعة",
  excused: "مبرَّرة",
  warned: "أُنذِر",
  resolved: "انتهت",
};

export interface PersistedCaseMeta {
  status: CaseStatus;
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}
