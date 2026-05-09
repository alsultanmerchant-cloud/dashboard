import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MessagesInbox } from "./inbox";
import { MessageCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const session = await requirePagePermission("notifications.view");

  // Build a per-conversation summary: for each "other user" the caller has
  // exchanged messages with, return the latest message + unread count.
  // Cheap one-shot query against direct_messages limited to my org.
  const me = session.employeeId;
  const { data: rows } = await supabaseAdmin
    .from("direct_messages")
    .select(
      "id, sender_employee_id, recipient_employee_id, body, created_at, read_at, context_task_id, context_project_id",
    )
    .eq("organization_id", session.orgId)
    .or(
      `sender_employee_id.eq.${me},recipient_employee_id.eq.${me}`,
    )
    .order("created_at", { ascending: false })
    .limit(500);

  type Row = {
    id: string;
    sender_employee_id: string;
    recipient_employee_id: string;
    body: string | null;
    created_at: string;
    read_at: string | null;
    context_task_id: string | null;
    context_project_id: string | null;
  };

  const byOther = new Map<string, { latest: Row; unread: number }>();
  for (const r of (rows ?? []) as Row[]) {
    const other =
      r.sender_employee_id === me ? r.recipient_employee_id : r.sender_employee_id;
    const prev = byOther.get(other);
    if (!prev || prev.latest.created_at < r.created_at) {
      byOther.set(other, { latest: r, unread: prev?.unread ?? 0 });
    }
    if (r.recipient_employee_id === me && !r.read_at) {
      const slot = byOther.get(other)!;
      slot.unread = (slot.unread ?? 0) + 1;
    }
  }

  const otherEmployeeIds = Array.from(byOther.keys());
  type Emp = { id: string; full_name: string; avatar_url: string | null; job_title: string | null };
  const { data: emps } = otherEmployeeIds.length
    ? await supabaseAdmin
        .from("employee_profiles")
        .select("id, full_name, avatar_url, job_title")
        .eq("organization_id", session.orgId)
        .in("id", otherEmployeeIds)
    : { data: [] as Emp[] };
  const empById = new Map<string, Emp>();
  for (const e of (emps ?? []) as Emp[]) empById.set(e.id, e);

  const conversations = Array.from(byOther.entries())
    .map(([employeeId, { latest, unread }]) => {
      const e = empById.get(employeeId);
      if (!e) return null;
      return {
        otherEmployeeId: e.id,
        otherFullName: e.full_name,
        otherAvatarUrl: e.avatar_url,
        otherJobTitle: e.job_title,
        latestBody: latest.body,
        latestCreatedAt: latest.created_at,
        unread,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => (a.latestCreatedAt < b.latestCreatedAt ? 1 : -1));

  return (
    <div className="space-y-4">
      <PageHeader title="الرسائل" description="المحادثات الخاصة بينك وبين زملائك." />
      {conversations.length === 0 ? (
        <EmptyState
          icon={<MessageCircle className="size-6" />}
          title="لا توجد محادثات"
          description="انقر على أي زميل في صفحة المهمة أو المشروع لبدء محادثة."
        />
      ) : (
        <MessagesInbox conversations={conversations} />
      )}
    </div>
  );
}
