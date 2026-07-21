export type StageOwnerPositions = Record<string, string | null>;

const EXECUTION_STAGES = ["in_progress", "client_changes"] as const;

/**
 * Execution ownership (In Progress / Client Changes) follows the ROLE that
 * actually does the work on the task, not just the template default:
 *   • an active `agent` (المنفذ) is assigned → the agent owns execution. A
 *     designer's in-progress/revisions must never be billed to the specialist,
 *     even when the template (or a service-mode fallback) says `specialist`.
 *   • else an active `specialist` is assigned → the specialist owns execution.
 *     Odoo often assigns only the specialist while the template says `agent`;
 *     without this the task would fall off every desk.
 *   • neither is assigned → leave the template untouched.
 *
 * Only execution stages the template gives to a DOER role (agent/specialist)
 * are reassigned — account-manager / manager ownership and all review stages are
 * never touched.
 */
export function withEffectiveExecutionOwner(
  owners: StageOwnerPositions,
  activeAssigneePositionRoles: ReadonlySet<string>,
): StageOwnerPositions {
  const preferred = activeAssigneePositionRoles.has("agent")
    ? "agent"
    : activeAssigneePositionRoles.has("specialist")
      ? "specialist"
      : null;
  if (!preferred) return owners;

  let resolved = owners;
  for (const stage of EXECUTION_STAGES) {
    const current = owners[stage];
    if (current !== "agent" && current !== "specialist") continue;
    if (current === preferred) continue;
    if (resolved === owners) resolved = { ...owners };
    resolved[stage] = preferred;
  }
  return resolved;
}
