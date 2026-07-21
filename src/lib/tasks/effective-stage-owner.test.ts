import { describe, expect, test } from "bun:test";
import { withEffectiveExecutionOwner } from "./effective-stage-owner";

const owners = {
  new: "specialist",
  in_progress: "agent",
  client_changes: "agent",
  manager_review: "manager",
  specialist_review: "specialist",
};

describe("withEffectiveExecutionOwner", () => {
  test("falls back to the specialist when no active agent is assigned", () => {
    expect(withEffectiveExecutionOwner(owners, new Set(["specialist", "manager"]))).toEqual({
      ...owners,
      in_progress: "specialist",
      client_changes: "specialist",
    });
  });

  test("keeps agent ownership when an active agent is assigned", () => {
    expect(withEffectiveExecutionOwner(owners, new Set(["agent", "specialist"]))).toBe(owners);
  });

  test("does not invent an owner when neither agent nor specialist is assigned", () => {
    expect(withEffectiveExecutionOwner(owners, new Set(["manager"]))).toBe(owners);
  });

  test("does not change review-stage ownership", () => {
    const reviewOwners = { ...owners, in_progress: "specialist" };
    const resolved = withEffectiveExecutionOwner(reviewOwners, new Set(["specialist"]));
    expect(resolved.manager_review).toBe("manager");
    expect(resolved.specialist_review).toBe("specialist");
  });

  test("gives execution to the agent (المنفذ) when one is assigned, even if the template says specialist", () => {
    const specialistExecution = { ...owners, in_progress: "specialist", client_changes: "specialist" };
    expect(withEffectiveExecutionOwner(specialistExecution, new Set(["agent", "specialist"]))).toEqual({
      ...owners,
      in_progress: "agent",
      client_changes: "agent",
    });
  });

  test("never reassigns account-manager-owned execution to a doer role", () => {
    const amExecution = { ...owners, in_progress: "account_manager", client_changes: "account_manager" };
    const resolved = withEffectiveExecutionOwner(amExecution, new Set(["agent", "specialist"]));
    expect(resolved.in_progress).toBe("account_manager");
    expect(resolved.client_changes).toBe("account_manager");
  });
});
