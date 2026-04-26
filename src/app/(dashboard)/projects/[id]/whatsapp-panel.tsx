"use client";

// Sky Light WhatsApp groups panel.
// Shows the two conventional groups (Client + Internal) per project.
// Each row has: editable name (defaulted to the manual's convention),
// optional invite link, copy-to-clipboard, and save/clear controls.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, MessageCircle, Users, Save, Copy, ExternalLink, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  upsertWhatsAppGroupAction,
  deleteWhatsAppGroupAction,
} from "./_whatsapp_actions";

type Kind = "client" | "internal";

export type WhatsAppGroupRow = {
  id: string | null;
  kind: Kind;
  name: string;
  invite_url: string | null;
};

const KIND_META: Record<Kind, { label: string; helper: string; tone: string; icon: React.ReactNode }> = {
  client: {
    label: "قروب العميل",
    helper: "للتواصل الرسمي مع العميل وتسليم الأعمال والاعتمادات.",
    tone: "border-cyan/30 bg-cyan-dim/40",
    icon: <MessageCircle className="size-4 text-cyan" />,
  },
  internal: {
    label: "القروب الداخلي",
    helper: "للتنسيق بين الفريق ومتابعة التاسكات.",
    tone: "border-emerald-500/30 bg-emerald-500/10",
    icon: <Users className="size-4 text-emerald-300" />,
  },
};

export function WhatsAppPanel({
  projectId,
  rows,
}: {
  projectId: string;
  rows: WhatsAppGroupRow[];
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {(["client", "internal"] as Kind[]).map((kind) => {
        const row = rows.find((r) => r.kind === kind) ?? {
          id: null,
          kind,
          name: rows.find((r) => r.kind === kind)?.name ?? "",
          invite_url: null,
        };
        return (
          <GroupCard
            key={kind}
            projectId={projectId}
            initial={row}
          />
        );
      })}
    </div>
  );
}

function GroupCard({
  projectId,
  initial,
}: {
  projectId: string;
  initial: WhatsAppGroupRow;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [invite, setInvite] = useState(initial.invite_url ?? "");
  const [pending, start] = useTransition();
  const meta = KIND_META[initial.kind];

  const dirty =
    name.trim() !== initial.name.trim() ||
    (invite.trim() || null) !== (initial.invite_url ?? null);

  function save() {
    if (!name.trim()) {
      toast.error("الاسم مطلوب");
      return;
    }
    start(async () => {
      const res = await upsertWhatsAppGroupAction({
        projectId,
        kind: initial.kind,
        name: name.trim(),
        inviteUrl: invite.trim() || null,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم الحفظ");
      router.refresh();
    });
  }

  function remove() {
    if (!initial.id) return;
    if (!confirm("حذف القروب؟")) return;
    start(async () => {
      const res = await deleteWhatsAppGroupAction({
        projectId,
        groupId: initial.id!,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم الحذف");
      router.refresh();
    });
  }

  function copy(value: string, label: string) {
    if (!value) return;
    navigator.clipboard?.writeText(value).then(
      () => toast.success(`تم نسخ ${label}`),
      () => toast.error("تعذر النسخ"),
    );
  }

  return (
    <Card className={cn("border", meta.tone)}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {meta.icon}
            <h4 className="text-sm font-semibold">{meta.label}</h4>
          </div>
          {initial.id && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
              مُسجَّل
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{meta.helper}</p>

        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
            اسم القروب
          </label>
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              dir="auto"
              className="flex-1 rounded-lg border border-white/10 bg-card/60 px-2.5 py-1.5 text-sm focus:border-cyan/40 focus:outline-none"
              placeholder={initial.kind === "client" ? "إدارة نشاط | اسم العميل" : "اسم العميل"}
            />
            <button
              type="button"
              onClick={() => copy(name, "الاسم")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
              aria-label="نسخ"
              title="نسخ"
            >
              <Copy className="size-3.5" />
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
            رابط الدعوة (اختياري)
          </label>
          <div className="flex items-center gap-2">
            <input
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              dir="ltr"
              className="flex-1 rounded-lg border border-white/10 bg-card/60 px-2.5 py-1.5 text-xs focus:border-cyan/40 focus:outline-none"
              placeholder="https://chat.whatsapp.com/…"
            />
            {invite && (
              <a
                href={invite}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                aria-label="فتح"
                title="فتح"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={pending || !dirty}
            className="gap-1.5"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            حفظ
          </Button>
          {initial.id && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={remove}
              disabled={pending}
              className="gap-1.5 text-cc-red hover:text-cc-red"
            >
              <Trash2 className="size-3.5" />
              حذف
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
