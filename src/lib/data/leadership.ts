// Single source of truth for the "agents-only" rule used by every performance
// comparison in the app (accountability scorecard + reviewer rigor, reports
// leaderboards, executive team-capacity, team-activity). Leadership — department
// managers, CSO, and team/supporting leads — is excluded so these tables rank
// individual contributors only.
//
// IMPORTANT: `positions.role` conflates org rank with task-attribution role
// (e.g. the Technical Dept Manager carries role='specialist'), so the
// dept-manager/CSO tier is matched by position NAME; the cleanly-roled leads by
// role. Keep this list in sync if leadership position names change.
export const LEADERSHIP_POSITION_NAMES = [
  "مدير القسم التقني",
  "مدير القسم الرئيسي",
  "مدير القسم المساند",
  "مدير قسم إدارة المبيعات",
  "مدير قسم إدارة الحسابات",
  "CSO",
] as const;

// Position.role values that are always leadership regardless of name.
export const LEADERSHIP_ROLES = ["manager", "team_lead", "supporting_lead"] as const;

// JS-side equivalent for PostgREST queries that embed the position rather than
// run raw SQL. Pass the employee's joined position ({ role, name }); a missing
// position is NOT leadership (unknown ≠ leadership), matching nonLeadershipFilter.
export function isLeadershipPosition(
  pos: { role?: string | null; name?: string | null } | null | undefined,
): boolean {
  if (!pos) return false;
  if (pos.role && (LEADERSHIP_ROLES as readonly string[]).includes(pos.role)) return true;
  if (pos.name && (LEADERSHIP_POSITION_NAMES as readonly string[]).includes(pos.name.trim()))
    return true;
  return false;
}

// SQL boolean — true when the position joined at `alias` is leadership.
export function isLeadershipSql(alias: string): string {
  const roles = LEADERSHIP_ROLES.map((r) => `'${r}'`).join(", ");
  const names = LEADERSHIP_POSITION_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ");
  return `(${alias}.role in (${roles}) or trim(${alias}.name) in (${names}))`;
}

// SQL predicate — KEEP only non-leadership rows. A null position (no position
// set) is kept: unknown ≠ leadership.
export function nonLeadershipFilter(alias: string): string {
  return `coalesce(${isLeadershipSql(alias)}, false) = false`;
}
