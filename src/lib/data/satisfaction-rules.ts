// =========================================================================
// Satisfaction classification rules — PURE, side-effect-free, unit-testable.
//
// This module is the single source of truth for two decisions the team gave
// explicit feedback on (see [[project_satisfaction_active_scope_fix]]). It has
// NO `server-only` / supabase imports on purpose so the rules can be locked by
// `satisfaction-rules.test.ts` and can never silently regress:
//   1. Active-vs-lost bucketing on the /satisfaction board.
//   2. Whether a contract still has money outstanding (payment_status is the
//      source of truth — paid_value LAGS on installment contracts).
// Both the data layer (getSatisfactionRows) and the AI prompt (satisfaction-
// analyze) import from here so the page, the churn scope, the executive index,
// and the model all agree.
// =========================================================================

// ---- Rule 1: active vs lost/archived -------------------------------------

export interface ClientProjectSignal {
  status: string | null; // projects.status — only 'active' | 'archived' exist today
  holdLost: boolean; // carries an Odoo HOLD or LOST project tag
}

export interface ClientActivitySignals {
  // clients.status — an explicit operator override ('archived'/'lost'/... != 'active').
  manualStatus: string | null;
  // Every project associated with the client: those it OWNS + those reached via
  // its WhatsApp group links (a duplicate/twin may hold the real project).
  projects: ClientProjectSignal[];
  // Contract statuses (lowercased) across the client's full identity (merged
  // twins folded in). Only consulted when the client has NO project at all.
  contractStatuses: string[];
}

// A contract status that means the relationship has ended for good. `expired`
// and `renewed` are intentionally NOT here — an expired contract may still be
// awaiting a renewal decision, so it must not auto-archive the client.
const DEAD_CONTRACT_STATUSES = new Set(["closed", "lost"]);

// True → the client belongs in the ACTIVE bucket; false → lost/archived.
export function isClientRelationshipActive(s: ClientActivitySignals): boolean {
  // (a) Manual archive/cancel is an explicit override and always wins.
  if (s.manualStatus && s.manualStatus !== "active") return false;

  // (b) A project counts as LIVE only when it is non-archived AND not tagged
  //     HOLD/LOST. The HOLD/LOST tag is a hard "left active delivery" signal even
  //     before Rawasm archives the project. Any one live project → active.
  const hasLiveProject = s.projects.some((p) => p.status !== "archived" && !p.holdLost);
  if (hasLiveProject) return true;

  // (c) The client HAS projects but none is live (all archived / HOLD / LOST) →
  //     the delivery relationship is dead → lost bucket.
  if (s.projects.length > 0) return false;

  // (d) No Rawasm project at all → fall back to contracts (many clients live only
  //     on the contracts sheet). Lost only when EVERY contract is closed/lost; a
  //     single live/renewable contract — or no contract signal — keeps it active.
  if (s.contractStatuses.length > 0) {
    const allDead = s.contractStatuses.every((c) => DEAD_CONTRACT_STATUSES.has(c));
    return !allDead;
  }
  return true; // genuine no-signal (duplicate/sheet row) → keep active
}

// ---- Rule 1b: historical HOLD events -------------------------------------

export interface ContractLifecycleStatus {
  contractCode?: string | null;
  status: string | null;
}

export interface ContractLifecycleEventStatus {
  logType: string;
  contractCode?: string | null;
  // Current status joined from the event's contract row, when available.
  contractStatus?: string | null;
}

// `ON HOLD` is an event in history, not a durable current-state flag. It is
// resolved when that same contract is no longer `hold`; for old analysis
// snapshots that did not store contractCode, the safe portfolio fallback is:
// no currently-held contract means every old HOLD event has been lifted/ended.
export function isResolvedHistoricalHold(
  event: ContractLifecycleEventStatus,
  currentContracts: ContractLifecycleStatus[],
): boolean {
  const isEnteredHold =
    /(?:ON|ENTERED) HOLD/i.test(event.logType) &&
    !/(?:LIFTED|LEFT) HOLD/i.test(event.logType);
  if (!isEnteredHold) return false;

  const isHold = (status: string | null | undefined) =>
    (status ?? "").trim().toLowerCase() === "hold";

  if (event.contractCode) {
    const current = currentContracts.find(
      (contract) => contract.contractCode === event.contractCode,
    );
    if (current) return !isHold(current.status);
  }

  if (event.contractStatus) return !isHold(event.contractStatus);
  return currentContracts.length > 0 && !currentContracts.some((c) => isHold(c.status));
}

// ---- Rule 2: contract payment (no false "outstanding dues") ---------------

export interface ContractPaymentInput {
  paymentStatus: string | null; // 'Complete' | 'Installments' | null (sheet flag)
  totalValue: number;
  paidValue: number;
}

// The sheet's own collection flag is authoritative. When it says the payment is
// complete there is NOTHING outstanding, regardless of a stale paid_value that
// still trails total_value — surfacing that gap produced false "client owes X"
// claims (team feedback, issue 1).
export function isContractPaymentComplete(paymentStatus: string | null): boolean {
  return (paymentStatus ?? "").toLowerCase() === "complete";
}

export interface ContractPaymentSummary {
  // Every listed contract's payment is marked complete → no dues at all.
  allComplete: boolean;
  // Remaining balance summed ONLY over not-yet-complete contracts. Completed
  // contracts never contribute, so a stale paid_value can't invent a debt.
  outstanding: number;
}

export function summarizeContractPayments(
  contracts: ContractPaymentInput[],
): ContractPaymentSummary {
  const notComplete = contracts.filter((c) => !isContractPaymentComplete(c.paymentStatus));
  return {
    allComplete: contracts.length > 0 && notComplete.length === 0,
    outstanding: notComplete.reduce((sum, c) => sum + Math.max(0, c.totalValue - c.paidValue), 0),
  };
}
