"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw, Check, Loader2, MessageSquare, Wrench, Ban, Users, Link2, History } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  mapWaGroupAction,
  syncWaGroupsAction,
  autoLinkWaProjectsAction,
  refreshWaMembersAction,
  importWaHistoryAction,
} from "../_actions";
import type { WaGroupLink, GroupKind } from "@/lib/data/satisfaction";

interface Props {
  links: WaGroupLink[];
  options: { value: string; label: string }[];
  projectOptions: { value: string; label: string }[];
}

export function WaGroupsWorkspace({ links, options, projectOptions }: Props) {
  const t = useTranslations("SatisfactionPage");
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [autoLinking, setAutoLinking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const busy = syncing || autoLinking || refreshing || importing;

  const sync = async () => {
    setMsg(null);
    setSyncing(true);
    const res = await syncWaGroupsAction();
    setSyncing(false);
    if (res.error) setMsg(res.error);
    else {
      setMsg(t("groups.synced", { n: res.found ?? 0 }));
      router.refresh();
    }
  };

  const refreshMembers = async () => {
    setMsg(null);
    setRefreshing(true);
    const res = await refreshWaMembersAction();
    setRefreshing(false);
    if (res.error) setMsg(res.error);
    else {
      setMsg(t("groups.membersRefreshed", { n: res.refreshed ?? 0, r: res.remaining ?? 0 }));
      router.refresh();
    }
  };

  const autoLink = async () => {
    setMsg(null);
    setAutoLinking(true);
    const res = await autoLinkWaProjectsAction();
    setAutoLinking(false);
    if (res.error) setMsg(res.error);
    else {
      setMsg(t("groups.autoLinked", { n: res.linked ?? 0, k: res.classified ?? 0 }));
      router.refresh();
    }
  };

  const importHistory = async () => {
    setMsg(null);
    setImporting(true);
    const res = await importWaHistoryAction();
    setImporting(false);
    if (res.error) setMsg(res.error);
    else {
      setMsg(t("groups.historyImported", { n: res.imported ?? 0, g: res.groups ?? 0 }));
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={sync} disabled={busy}>
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {t("groups.sync")}
        </Button>
        <Button variant="outline" size="sm" onClick={autoLink} disabled={busy}>
          {autoLinking ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          {t("groups.autoLink")}
        </Button>
        <Button variant="outline" size="sm" onClick={refreshMembers} disabled={busy}>
          {refreshing ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}
          {t("groups.refreshMembers")}
        </Button>
        <Button variant="outline" size="sm" onClick={importHistory} disabled={busy}>
          {importing ? <Loader2 className="size-4 animate-spin" /> : <History className="size-4" />}
          {t("groups.importHistory")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("groups.syncHint")}</span>
        {msg && <span className="text-xs text-cyan">{msg}</span>}
      </div>

      {links.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("groups.empty")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="p-3 text-start font-medium">{t("groups.col.group")}</th>
                    <th className="p-3 text-center font-medium">{t("groups.col.members")}</th>
                    <th className="p-3 text-center font-medium">{t("groups.col.messages")}</th>
                    <th className="p-3 text-start font-medium">{t("groups.col.client")}</th>
                    <th className="p-3 text-start font-medium">{t("groups.col.project")}</th>
                    <th className="p-3 text-center font-medium">{t("groups.col.kind")}</th>
                    <th className="p-3 text-center font-medium">{t("groups.col.active")}</th>
                    <th className="p-3 text-center font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <GroupRow key={link.id} link={link} options={options} projectOptions={projectOptions} t={t} onSaved={() => router.refresh()} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GroupRow({
  link,
  options,
  projectOptions,
  t,
  onSaved,
}: {
  link: WaGroupLink;
  options: { value: string; label: string }[];
  projectOptions: { value: string; label: string }[];
  t: ReturnType<typeof useTranslations>;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState(link.clientId ?? "");
  const [projectId, setProjectId] = useState(link.projectId ?? "");
  const [kind, setKind] = useState<GroupKind | "">(link.groupKind ?? "");
  const [active, setActive] = useState(link.isActive);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync with server data after router.refresh() — without this, rows kept
  // showing (and on the next persist, WRITING BACK) values from page load,
  // which wiped links that sync/auto-link/another tab had set in the meantime.
  // Render-time reset (React's "adjusting state when props change" pattern).
  const [prevLink, setPrevLink] = useState(link);
  if (
    prevLink.clientId !== link.clientId ||
    prevLink.projectId !== link.projectId ||
    prevLink.groupKind !== link.groupKind ||
    prevLink.isActive !== link.isActive
  ) {
    setPrevLink(link);
    setClientId(link.clientId ?? "");
    setProjectId(link.projectId ?? "");
    setKind(link.groupKind ?? "");
    setActive(link.isActive);
  }

  // Auto-save: each control change persists immediately (no Save button).
  // Only the changed field is sent — the action has PATCH semantics, so an
  // out-of-date row can never overwrite the other columns.
  const persist = (patch: {
    clientId?: string;
    projectId?: string;
    kind?: GroupKind | "";
    active?: boolean;
  }) => {
    if (patch.clientId !== undefined) setClientId(patch.clientId);
    if (patch.projectId !== undefined) setProjectId(patch.projectId);
    if (patch.kind !== undefined) setKind(patch.kind);
    if (patch.active !== undefined) setActive(patch.active);

    setError(null);
    startTransition(async () => {
      const res = await mapWaGroupAction({
        chatId: link.chatId,
        ...(patch.clientId !== undefined ? { clientId: patch.clientId || null } : {}),
        ...(patch.projectId !== undefined ? { projectId: patch.projectId || null } : {}),
        ...(patch.kind !== undefined ? { groupKind: (patch.kind || null) as GroupKind | null } : {}),
        ...(patch.active !== undefined ? { isActive: patch.active } : {}),
      });
      if (res.error) {
        setError(res.error);
        // Revert the optimistic change on failure.
        setClientId(link.clientId ?? "");
        setProjectId(link.projectId ?? "");
        setKind(link.groupKind ?? "");
        setActive(link.isActive);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
        onSaved();
      }
    });
  };

  return (
    <tr className="border-b border-border/60">
      <td className="p-3">
        <p className="font-medium">{link.chatName ?? "—"}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{link.chatId}</p>
      </td>
      <td className="p-3 text-center">
        {link.memberCount != null ? (
          <div className="inline-flex flex-col items-center leading-tight">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="size-3.5 text-muted-foreground" />
              {link.memberCount}
            </span>
            {link.adminCount != null && link.adminCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {t("groups.membersAdmins", { n: link.adminCount })}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-3 text-center tabular-nums text-muted-foreground">{link.messageCount}</td>
      <td className="p-3 min-w-[180px]">
        <SearchableSelect
          value={clientId}
          onValueChange={(v) => persist({ clientId: v })}
          options={options}
          placeholder={t("groups.unmapped")}
          searchPlaceholder={t("searchClient")}
          emptyMessage={t("noClients")}
          ariaLabel={t("groups.col.client")}
          clearable
          clearLabel={t("groups.unmapped")}
        />
      </td>
      <td className="p-3 min-w-[200px]">
        <SearchableSelect
          value={projectId}
          onValueChange={(v) => persist({ projectId: v })}
          options={projectOptions}
          placeholder={t("groups.unmappedProject")}
          searchPlaceholder={t("groups.searchProject")}
          emptyMessage={t("groups.noProjects")}
          ariaLabel={t("groups.col.project")}
          clearable
          clearLabel={t("groups.unmappedProject")}
        />
      </td>
      <td className="p-3 text-center">
        <div className="inline-flex gap-1">
          <KindBtn active={kind === "client"} onClick={() => persist({ kind: kind === "client" ? "" : "client" })} icon={<MessageSquare className="size-3.5" />} label={t("clientGroup")} />
          <KindBtn active={kind === "technical"} onClick={() => persist({ kind: kind === "technical" ? "" : "technical" })} icon={<Wrench className="size-3.5" />} label={t("technicalGroup")} />
        </div>
      </td>
      <td className="p-3 text-center">
        <button
          type="button"
          onClick={() => persist({ active: !active })}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-md border",
            active ? "border-cc-green/40 bg-green-dim text-cc-green" : "border-border text-muted-foreground",
          )}
          aria-label={t("groups.col.active")}
        >
          {active ? <Check className="size-3.5" /> : <Ban className="size-3.5" />}
        </button>
      </td>
      <td className="p-3 text-center">
        {/* Auto-save status (no Save button) */}
        {pending ? (
          <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
        ) : error ? (
          <span className="text-[10px] text-cc-red" title={error}>تعذّر الحفظ</span>
        ) : saved ? (
          <Check className="mx-auto size-4 text-cc-green" />
        ) : (
          <span className="text-[10px] text-muted-foreground/50">—</span>
        )}
      </td>
    </tr>
  );
}

function KindBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md border transition-colors",
        active ? "border-cyan/40 bg-soft-2 text-cyan" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
}
