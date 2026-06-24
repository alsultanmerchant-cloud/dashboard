// Deep-link into the team's Odoo ("Rwasem") instance for a given task.
// During the migration phase the dashboard is view-only for agents; edits still
// happen in Rwasem, so the task page offers an "open in Rwasem" button.
//
// Example real link (project.task form):
//   https://skylight.rwasem.com/web#id=16681&menu_id=582&cids=1&action=804&model=project.task&view_type=form

const RWASEM_WEB_BASE = (process.env.ODOO_URL?.replace(/\/+$/, "") || "https://skylight.rwasem.com");

/**
 * Build the Rwasem form-view URL for an Odoo task. Returns null when the task
 * isn't sourced from Odoo (no external id) so callers can hide the link.
 */
export function rwasemTaskUrl(
  externalId: string | number | null | undefined,
  externalSource: string | null | undefined,
): string | null {
  if (externalId == null || String(externalId).trim() === "") return null;
  // Only Odoo-sourced tasks have a Rwasem record.
  if (externalSource && externalSource !== "odoo") return null;
  const id = String(externalId).trim();
  return `${RWASEM_WEB_BASE}/web#id=${id}&menu_id=582&cids=1&action=804&model=project.task&view_type=form`;
}
