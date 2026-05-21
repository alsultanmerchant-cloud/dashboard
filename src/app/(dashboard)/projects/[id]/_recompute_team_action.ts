"use server";

import { revalidatePath } from "next/cache";

import { requireSession, hasPermission } from "@/lib/auth-server";
import { recomputeProjectTeam } from "@/lib/workflows/recompute-project-team";

export async function recomputeProjectTeamAction(input: {
  projectId: string;
}): Promise<
  | { ok: true; taskCount: number; inserted: number; updated: number; deleted: number }
  | { ok: false; error: string }
> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, error: "unauthorized" };
  }
  if (!hasPermission(session, "projects.manage")) {
    return { ok: false, error: "forbidden" };
  }

  try {
    const result = await recomputeProjectTeam({
      projectId: input.projectId,
      organizationId: session.orgId,
      actorUserId: session.userId,
    });
    revalidatePath(`/projects/${input.projectId}`);
    return { ok: true, ...result };
  } catch (e) {
    console.error("[recomputeProjectTeamAction] failed:", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}
