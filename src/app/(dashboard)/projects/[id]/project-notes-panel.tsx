"use client";

// Project log notes panel. Newest first. Authors and managers can edit/delete.
// Inline expand-to-edit pattern; no modal needed.

import { useState, useTransition } from "react";
import { Loader2, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createProjectNoteAction,
  updateProjectNoteAction,
  deleteProjectNoteAction,
} from "./_notes_actions";

export type ProjectNoteRow = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  edited: boolean;
  author: {
    user_id: string;
    full_name: string;
    avatar_url: string | null;
  };
  can_edit: boolean;
};

export function ProjectNotesPanel({
  projectId,
  notes,
  canCreate,
}: {
  projectId: string;
  notes: ProjectNoteRow[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pending, start] = useTransition();

  function submitNew() {
    if (draft.trim().length < 2) {
      toast.error("النص قصير جدًا");
      return;
    }
    start(async () => {
      const res = await createProjectNoteAction({
        projectId,
        body: draft.trim(),
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("أُضيفت الملاحظة");
      setDraft("");
      setComposing(false);
      router.refresh();
    });
  }

  function submitEdit(noteId: string) {
    if (editDraft.trim().length < 2) {
      toast.error("النص قصير جدًا");
      return;
    }
    start(async () => {
      const res = await updateProjectNoteAction({
        noteId,
        body: editDraft.trim(),
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم التحديث");
      setEditingId(null);
      router.refresh();
    });
  }

  function onDelete(noteId: string) {
    if (!window.confirm("حذف هذه الملاحظة؟")) return;
    start(async () => {
      const res = await deleteProjectNoteAction({ noteId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("حُذفت الملاحظة");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canCreate && (
        <div>
          {composing ? (
            <div className="space-y-2 rounded-xl border border-cyan/30 bg-cyan-dim/10 p-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="اكتب ملاحظة حول المشروع — اجتماعات، قرارات، عوائق..."
                rows={4}
                disabled={pending}
                className="w-full resize-y rounded-lg border border-soft bg-card px-3 py-2 text-sm outline-none focus:border-cyan/50"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setComposing(false);
                    setDraft("");
                  }}
                  disabled={pending}
                >
                  <X className="size-3.5" /> إلغاء
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={submitNew}
                  disabled={pending || draft.trim().length < 2}
                >
                  {pending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  حفظ الملاحظة
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setComposing(true)}
            >
              <Plus className="size-3.5" />
              إضافة ملاحظة
            </Button>
          )}
        </div>
      )}

      {notes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-soft-2 bg-soft-1/40 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            لا توجد ملاحظات للمشروع بعد
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            استخدم هذا المكان لتسجيل قرارات الاجتماعات، العوائق، وأي سياق عام
            للمشروع.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => {
            const isEditing = editingId === n.id;
            return (
              <li
                key={n.id}
                className={cn(
                  "rounded-xl border border-soft bg-card p-3",
                  isEditing && "border-cyan/40 bg-cyan-dim/10",
                )}
              >
                <div className="flex items-start gap-3">
                  <Avatar size="sm" className="shrink-0">
                    {n.author.avatar_url ? (
                      <AvatarImage src={n.author.avatar_url} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[10px]">
                      {n.author.full_name[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="text-xs font-medium">
                        {n.author.full_name}
                      </span>
                      <span
                        className="text-[10px] text-muted-foreground tabular-nums"
                        dir="ltr"
                      >
                        {new Date(n.created_at).toLocaleString("ar-EG", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        {n.edited && " · مُعدَّلة"}
                      </span>
                    </div>
                    {isEditing ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={4}
                          disabled={pending}
                          className="w-full resize-y rounded-lg border border-soft bg-card px-3 py-2 text-sm outline-none focus:border-cyan/50"
                          autoFocus
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                            disabled={pending}
                          >
                            <X className="size-3.5" /> إلغاء
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => submitEdit(n.id)}
                            disabled={pending || editDraft.trim().length < 2}
                          >
                            {pending ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            حفظ
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                        {n.body}
                      </p>
                    )}
                  </div>
                  {n.can_edit && !isEditing && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditDraft(n.body);
                          setEditingId(n.id);
                        }}
                        disabled={pending}
                        aria-label="تعديل"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(n.id)}
                        disabled={pending}
                        aria-label="حذف"
                        className="rounded p-1 text-muted-foreground hover:bg-cc-red/10 hover:text-cc-red"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
