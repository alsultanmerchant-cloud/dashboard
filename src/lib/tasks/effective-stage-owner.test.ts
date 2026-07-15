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
});
