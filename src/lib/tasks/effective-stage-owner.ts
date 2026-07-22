export type StageOwnerPositions = Record<string, string | null>;

const EXECUTION_STAGES = ["in_progress", "client_changes"] as const;

/**
 * Execution ownership (In Progress / Client Changes) follows the منفّذ (agent)
 * who actually does the work, but the TEMPLATE stays the source of truth for
 * WHO is meant to execute a deliverable:
 *   • an active `agent` (المنفذ) is assigned → the agent owns execution, even
 *     when the template says `specialist`. A designer's in-progress/revisions
 *     must be billed to them, not the specialist.
 *   • the template gives execution to the `agent` (a منفّذ deliverable, e.g.
 *     designs) but no active agent is assigned → execution STAYS with the agent
 *     role (unassigned), it is NOT demoted onto the specialist. The team's rule
 *     is that design execution is never the social specialist's; a missing
 *     منفّذ is an assignment gap, not specialist work. (This is the fix for
 *     علية غنيم being billed for design قيد التنفيذ / تعديلات العميل.)
 *   • the template gives execution to the `specialist` (a specialist deliverable,
 *     e.g. content writing) → left as-is; the specialist rightly owns it.
 *
 * So the only rewrite is promotion specialist→agent when a منفّذ is assigned;
 * we never demote agent→specialist. Account-manager / manager ownership and all
 * review stages are never touched.
 */
export function withEffectiveExecutionOwner(
  owners: StageOwnerPositions,
  activeAssigneePositionRoles: ReadonlySet<string>,
): StageOwnerPositions {
  if (!activeAssigneePositionRoles.has("agent")) return owners;

  let resolved = owners;
  for (const stage of EXECUTION_STAGES) {
    if (owners[stage] !== "specialist") continue; // only promote specialist→agent
    if (resolved === owners) resolved = { ...owners };
    resolved[stage] = "agent";
  }
  return resolved;
}
