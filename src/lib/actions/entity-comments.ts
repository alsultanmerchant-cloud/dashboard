"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { extractMentions, resolveMentions } from "@/lib/workflows/mentions";

const Schema = z.object({
  entityType: z.enum(["contract", "client"]),
  entityId: z.string().uuid(),
  body: z.string().trim().min(1).max(8000),
  isInternal: z.boolean().optional(),
  attachments: z
    .array(
      z.object({
        storage_path: z.string(),
        filename: z.string(),
        mimetype: z.string().nullable().optional(),
        size_bytes: z.number().nullable().optional(),
      }),
    )
    .optional(),
});

export type AddEntityCommentResult =
  | { ok: true; id: string; mentionsResolved: number }
  | { error: string };

const VIEW_PERM: Record<"contract" | "client", string> = {
  contract: "contract.view",
  client: "clients.view",
};

export async function addEntityCommentAction(input: {
  entityType: "contract" | "client";
  entityId: string;
  body: string;
  isInternal?: boolean;
  attachments?: {
    storage_path: string;
    filename: string;
    mimetype?: string | null;
    size_bytes?: number | null;
  }[];
}): Promise<AddEntityCommentResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }
  const { entityType, entityId, body, isInternal, attachments } = parsed.data;

  let session;
  try {
    session = await requirePermission(VIEW_PERM[entityType]);
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Verify the entity belongs to this org (so a comment can't be attached to
  // an arbitrary id the caller can't see).
  const table = entityType === "contract" ? "contracts" : "clients";
  const { data: ent } = await supabaseAdmin
    .from(table)
    .select("id")
    .eq("id", entityId)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!ent) return { error: "العنصر غير موجود" };

  const { data: comment, error } = await supabaseAdmin
    .from("entity_comments")
    .insert({
      organization_id: session.orgId,
      entity_type: entityType,
      entity_id: entityId,
      author_user_id: session.userId,
      body,
      is_internal: isInternal ?? true,
    })
    .select("id")
    .single();
  if (error || !comment) return { error: error?.message ?? "تعذر إضافة الملاحظة" };

  // Attachments — path-scoped under entity-comments/{entityType}/{entityId}/.
  const atts = attachments ?? [];
  if (atts.length > 0) {
    const prefix = `entity-comments/${entityType}/${entityId}/`;
    const valid = atts.filter((a) => a.storage_path.startsWith(prefix));
    if (valid.length > 0) {
      const { error: attErr } = await supabaseAdmin
        .from("entity_comment_attachments")
        .insert(
          valid.map((a) => ({
            comment_id: comment.id,
            storage_path: a.storage_path,
            filename: a.filename,
            mimetype: a.mimetype ?? null,
            size_bytes: a.size_bytes ?? null,
          })),
        );
      if (attErr) console.warn("[entity_comment_attachments] insert failed:", attErr.message);
    }
  }

  // @mentions
  const resolved = await resolveMentions({
    organizationId: session.orgId,
    tokens: extractMentions(body),
  });
  if (resolved.length > 0) {
    await supabaseAdmin.from("entity_comment_mentions").insert(
      resolved.map((r) => ({
        comment_id: comment.id,
        mentioned_employee_id: r.employeeId,
      })),
    );
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "entity_comment.create",
    entityType,
    entityId,
    metadata: { comment_id: comment.id, mentions: resolved.length },
  });

  revalidatePath(entityType === "contract" ? `/contracts/${entityId}` : `/clients/${entityId}`);

  return { ok: true, id: comment.id, mentionsResolved: resolved.length };
}
