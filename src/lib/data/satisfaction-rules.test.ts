import { describe, expect, test } from "bun:test";
import {
  isClientRelationshipActive,
  isContractPaymentComplete,
  isResolvedHistoricalHold,
  summarizeContractPayments,
} from "./satisfaction-rules";

// These tests lock the three fixes the Sky Light team asked never to recur on
// /satisfaction (see [[project_satisfaction_active_scope_fix]]). If a future
// edit re-breaks the bucketing or resurfaces a false "outstanding payment",
// one of these fails.

describe("isClientRelationshipActive", () => {
  test("live untagged project → active", () => {
    expect(
      isClientRelationshipActive({
        manualStatus: "active",
        projects: [{ status: "active", holdLost: false }],
        contractStatuses: [],
      }),
    ).toBe(true);
  });

  test("issue 3: only project is HOLD/LOST-tagged → lost (even active status)", () => {
    expect(
      isClientRelationshipActive({
        manualStatus: "active",
        projects: [{ status: "active", holdLost: true }],
        contractStatuses: [],
      }),
    ).toBe(false);
  });

  test("issue 3: HOLD/LOST tag beats even a live contract", () => {
    // Leora: HOLD-tagged project + an active contract — team wants it OUT.
    expect(
      isClientRelationshipActive({
        manualStatus: "active",
        projects: [{ status: "active", holdLost: true }],
        contractStatuses: ["active"],
      }),
    ).toBe(false);
  });

  test("multi-project: one live untagged project wins over a LOST sibling", () => {
    expect(
      isClientRelationshipActive({
        manualStatus: "active",
        projects: [
          { status: "active", holdLost: true },
          { status: "active", holdLost: false },
        ],
        contractStatuses: [],
      }),
    ).toBe(true);
  });

  test("all projects archived → lost", () => {
    expect(
      isClientRelationshipActive({
        manualStatus: "active",
        projects: [{ status: "archived", holdLost: false }],
        contractStatuses: ["active"],
      }),
    ).toBe(false);
  });

  test("issue 2: no project + all contracts closed/lost → lost", () => {
    expect(
      isClientRelationshipActive({
        manualStatus: "active",
        projects: [],
        contractStatuses: ["closed"],
      }),
    ).toBe(false);
    expect(
      isClientRelationshipActive({
        manualStatus: "active",
        projects: [],
        contractStatuses: ["lost", "closed"],
      }),
    ).toBe(false);
  });

  test("no project + expired contract (pending renewal) → stays active", () => {
    // مسار نجد: expired, no project — must NOT be auto-archived.
    expect(
      isClientRelationshipActive({
        manualStatus: "active",
        projects: [],
        contractStatuses: ["expired"],
      }),
    ).toBe(true);
  });

  test("no project + a live/renewable contract among dead ones → active", () => {
    expect(
      isClientRelationshipActive({
        manualStatus: "active",
        projects: [],
        contractStatuses: ["closed", "active"],
      }),
    ).toBe(true);
    expect(
      isClientRelationshipActive({
        manualStatus: "active",
        projects: [],
        contractStatuses: ["renewed"],
      }),
    ).toBe(true);
  });

  test("no project + no contract (sheet/duplicate) → keep active", () => {
    expect(
      isClientRelationshipActive({ manualStatus: "active", projects: [], contractStatuses: [] }),
    ).toBe(true);
  });

  test("manual archive always wins", () => {
    expect(
      isClientRelationshipActive({
        manualStatus: "archived",
        projects: [{ status: "active", holdLost: false }],
        contractStatuses: ["active"],
      }),
    ).toBe(false);
  });
});

describe("contract payment (issue 1)", () => {
  test("Complete is case-insensitive and outstanding=0 despite a stale paid gap", () => {
    expect(isContractPaymentComplete("Complete")).toBe(true);
    expect(isContractPaymentComplete("complete")).toBe(true);
    // paid_value lags total_value but payment is complete → NO due.
    const s = summarizeContractPayments([
      { paymentStatus: "Complete", totalValue: 5000, paidValue: 2500 },
    ]);
    expect(s.allComplete).toBe(true);
    expect(s.outstanding).toBe(0);
  });

  test("installments contribute their remaining balance", () => {
    const s = summarizeContractPayments([
      { paymentStatus: "Installments", totalValue: 5000, paidValue: 2500 },
    ]);
    expect(s.allComplete).toBe(false);
    expect(s.outstanding).toBe(2500);
  });

  test("mixed portfolio: only the incomplete contract counts", () => {
    const s = summarizeContractPayments([
      { paymentStatus: "Complete", totalValue: 8000, paidValue: 4000 },
      { paymentStatus: "Installments", totalValue: 5000, paidValue: 1000 },
    ]);
    expect(s.allComplete).toBe(false);
    expect(s.outstanding).toBe(4000);
  });

  test("no contracts → not all-complete, nothing outstanding", () => {
    const s = summarizeContractPayments([]);
    expect(s.allComplete).toBe(false);
    expect(s.outstanding).toBe(0);
  });
});

describe("historical HOLD reconciliation", () => {
  test("an ON HOLD event is resolved when its contract is active now", () => {
    expect(
      isResolvedHistoricalHold(
        {
          logType: "ON HOLD",
          contractCode: "C164-1",
          contractStatus: "active",
        },
        [{ contractCode: "C164-1", status: "active" }],
      ),
    ).toBe(true);
  });

  test("an ON HOLD event stays current when that contract is still held", () => {
    expect(
      isResolvedHistoricalHold(
        { logType: "Entered HOLD", contractCode: "C164-1" },
        [{ contractCode: "C164-1", status: "hold" }],
      ),
    ).toBe(false);
  });

  test("legacy event without a contract code resolves when no contract is held", () => {
    expect(
      isResolvedHistoricalHold(
        { logType: "ON HOLD" },
        [
          { contractCode: "C164-1", status: "active" },
          { contractCode: "C164-2", status: "active" },
        ],
      ),
    ).toBe(true);
  });

  test("HOLD LIFTED is not itself treated as an entered-hold event", () => {
    expect(
      isResolvedHistoricalHold(
        { logType: "HOLD LIFTED", contractCode: "C164-1" },
        [{ contractCode: "C164-1", status: "active" }],
      ),
    ).toBe(false);
  });
});
