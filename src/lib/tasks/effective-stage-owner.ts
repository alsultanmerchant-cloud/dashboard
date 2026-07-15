export type StageOwnerPositions = Record<string, string | null>;

const EXECUTION_STAGES = ["in_progress", "client_changes"] as const;

/**
 * Odoo sometimes assigns only the Specialist to an execution task while the
 * template still says that an `agent` owns In Progress / Client Changes. In
 * that state the configured owner does not exist, so the task disappears from
 * every employee desk.
 *
 * Keep the configured owner whenever an active assignee can fulfil it. Only
 * fall back from `agent` to the assigned Specialist for execution stages; this
 * preserves real agent-owned work and all review/account-manager ownership.
 */
export function withEffectiveExecutionOwner(
  owners: StageOwnerPositions,
  activeAssigneePositionRoles: ReadonlySet<string>,
): StageOwnerPositions {
  if (
    activeAssigneePositionRoles.has("agent") ||
    !activeAssigneePositionRoles.has("specialist")
  ) {
    return owners;
  }

  let resolved = owners;
  for (const stage of EXECUTION_STAGES) {
    if (owners[stage] !== "agent") continue;
    if (resolved === owners) resolved = { ...owners };
    resolved[stage] = "specialist";
  }
  return resolved;
}
