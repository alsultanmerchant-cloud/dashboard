"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Link2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createTaskLinkAction,
  updateTaskLinkAction,
  deleteTaskLinkAction,
} from "../../projects/[id]/_link_actions";

type DepType = "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish";

export type TaskLinkRow = {
  id: string;
  dependency_type: DepType;
  lag_days: number;
  direction: "outgoing" | "incoming";
  other_task: { id: string; title: string; task_code: string | null };
};

export function TaskLinksPanel({
  taskId,
  projectId,
  links,
  candidates,
  canManage,
}: {
  taskId: string;
  projectId: string;
  links: TaskLinkRow[];
  candidates: { id: string; title: string; task_code: string | null }[];
  canManage: boolean;
}) {
  const t = useTranslations("TaskDetailPage.linksPanel");
  const typeLabels: Record<DepType, string> = {
    finish_to_start: t("types.finish_to_start"),
    start_to_start: t("types.start_to_start"),
    finish_to_finish: t("types.finish_to_finish"),
    start_to_finish: t("types.start_to_finish"),
  };
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [depType, setDepType] = useState<DepType>("finish_to_start");
  const [lag, setLag] = useState<number>(0);

  const onAdd = () =>
    start(async () => {
      if (!targetId) {
        toast.error(t("pickTask"));
        return;
      }
      const res = await createTaskLinkAction({
        projectId,
        sourceTaskId: taskId,
        targetTaskId: targetId,
        dependencyType: depType,
        lagDays: lag,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.created"));
      setAdding(false);
      setTargetId("");
      setLag(0);
      setDepType("finish_to_start");
      router.refresh();
    });

  const onUpdate = (linkId: string, patch: { dependency_type?: DepType; lag_days?: number }) =>
    start(async () => {
      const res = await updateTaskLinkAction({
        linkId,
        dependencyType: patch.dependency_type,
        lagDays: patch.lag_days,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.updated"));
      router.refresh();
    });

  const onDelete = (linkId: string) =>
    start(async () => {
      const res = await deleteTaskLinkAction({ linkId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.deleted"));
      router.refresh();
    });

  const outgoing = links.filter((l) => l.direction === "outgoing");
  const incoming = links.filter((l) => l.direction === "incoming");

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4 text-muted-foreground" />
            {t("title")}
          </h3>
          {canManage && !adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="ml-1 size-3.5" />
              {t("add")}
            </Button>
          )}
        </div>

        {adding && (
          <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("dependentTask")}</label>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                disabled={pending}
              >
                <option value="">{t("pick")}</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.task_code ? `${c.task_code} · ` : ""}
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("type")}</label>
              <select
                value={depType}
                onChange={(e) => setDepType(e.target.value as DepType)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                disabled={pending}
              >
                {Object.entries(typeLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("lagDays")}</label>
              <Input
                type="number"
                value={lag}
                onChange={(e) => setLag(Number(e.target.value))}
                className="h-9 w-20 text-sm"
                disabled={pending}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={onAdd} disabled={pending} size="sm">
                {pending ? <Loader2 className="ml-1 size-3.5 animate-spin" /> : null}
                {t("save")}
              </Button>
              <Button onClick={() => setAdding(false)} disabled={pending} size="sm" variant="ghost">
                {t("cancel")}
              </Button>
            </div>
          </div>
        )}

        <LinkSection
          title={t("outgoingTitle")}
          subtitle={t("outgoingSubtitle")}
          rows={outgoing}
          canManage={canManage}
          pending={pending}
          onUpdate={onUpdate}
          onDelete={onDelete}
          typeLabels={typeLabels}
          empty={t("empty")}
        />

        <LinkSection
          title={t("incomingTitle")}
          subtitle={t("incomingSubtitle")}
          rows={incoming}
          canManage={canManage}
          pending={pending}
          onUpdate={onUpdate}
          onDelete={onDelete}
          typeLabels={typeLabels}
          empty={t("empty")}
        />
      </CardContent>
    </Card>
  );
}

function LinkSection({
  title,
  subtitle,
  rows,
  canManage,
  pending,
  onUpdate,
  onDelete,
  typeLabels,
  empty,
}: {
  title: string;
  subtitle: string;
  rows: TaskLinkRow[];
  canManage: boolean;
  pending: boolean;
  onUpdate: (id: string, p: { dependency_type?: DepType; lag_days?: number }) => void;
  onDelete: (id: string) => void;
  typeLabels: Record<DepType, string>;
  empty: string;
}) {
  return (
    <div>
      <div className="mb-1.5">
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {rows.map((l) => (
            <li
              key={l.id}
              className="grid grid-cols-1 items-center gap-2 rounded-md border bg-background/50 px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto_auto]"
            >
              <Link
                href={`/tasks/${l.other_task.id}`}
                className="truncate hover:text-cyan transition-colors"
              >
                {l.other_task.task_code && (
                  <span
                    className="me-1.5 inline-flex shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 align-middle font-mono text-[10px] text-muted-foreground"
                    dir="ltr"
                  >
                    {l.other_task.task_code}
                  </span>
                )}
                {l.other_task.title}
              </Link>
              <select
                value={l.dependency_type}
                onChange={(e) =>
                  canManage && onUpdate(l.id, { dependency_type: e.target.value as DepType })
                }
                disabled={!canManage || pending}
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                {Object.entries(typeLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <Input
                type="number"
                defaultValue={l.lag_days}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (canManage && v !== l.lag_days) onUpdate(l.id, { lag_days: v });
                }}
                disabled={!canManage || pending}
                className="h-8 w-16 text-xs"
              />
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(l.id)}
                  disabled={pending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
