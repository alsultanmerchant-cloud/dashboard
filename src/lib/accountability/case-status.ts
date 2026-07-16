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
  // How many DAYS the materializer detected this case (bumped once per Riyadh
  // day) — a polling counter, NOT a recurrence count. 42 of 52 live cases sit
  // at the same value because they have simply existed since tracking began,
  // so it differentiates nothing. Never label this "تكرّرت N×": that reads as
  // "the complaint recurred N times", which it does not mean. For real
  // recurrence use `reopenCount`; for age use `firstSeenAt` (floored by the
  // store's start date, so it is a LOWER BOUND).
  timesSeen: number;
  // Times this case was resolved and then detected again — the honest "it came
  // back" signal, and the only one that earns an alarm badge.
  reopenCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}
