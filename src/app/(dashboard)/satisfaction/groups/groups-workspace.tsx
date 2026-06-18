"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  RefreshCw,
  Check,
  Loader2,
  MessageSquare,
  Wrench,
  Ban,
  Users,
  Link2,
  Smartphone,
  History,
  X,
  AlertTriangle,
  FolderX,
} from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { MetricInfo } from "@/components/metric-info";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  mapWaGroupAction,
  syncWaGroupsAction,
  autoLinkWaProjectsAction,
  refreshWaMembersAction,
  importWaHistoryAction,
  confirmWaSuggestionAction,
  rejectWaSuggestionAction,
} from "../_actions";
import type {
  WaGroupLink,
  GroupKind,
  WaLinkSuggestion,
  ProjectCoverageGap,
} from "@/lib/data/satisfaction";

interface Props {
  links: WaGroupLink[];
  options: { value: string; label: string }[];
  projectOptions: { value: string; label: string }[];
  suggestions: WaLinkSuggestion[];
  coverageGaps: ProjectCoverageGap[];
}

export function WaGroupsWorkspace({
  links,
  options,
  projectOptions,
  suggestions,
  coverageGaps,
}: Props) {
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
      const base = t("groups.autoLinked", { n: res.linked ?? 0, k: res.classified ?? 0 });
      setMsg(
        res.suggested
          ? `${base} — ${t("groups.autoSuggested", { s: res.suggested })}`
          : base,
      );
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

      {suggestions.length > 0 && (
        <SuggestionsSection
          suggestions={suggestions}
          t={t}
          onChanged={() => router.refresh()}
        />
      )}

      {coverageGaps.length > 0 && (
        <CoverageSection
          gaps={coverageGaps}
          groupOptions={links.map((l) => ({
            value: l.chatId,
            label: l.chatName ?? l.chatId,
          }))}
          t={t}
          onLinked={() => router.refresh()}
        />
      )}

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
                    <th className="p-3 text-center font-medium">
                      <span className="inline-flex items-center justify-center gap-1">
                        {t("groups.col.members")}
                        <MetricInfo
                          text={t("metricTooltips.groups_members")}
                          label={t("groups.col.members")}
                        />
                      </span>
                    </th>
                    <th className="p-3 text-center font-medium">
                      <span className="inline-flex items-center justify-center gap-1">
                        {t("groups.col.messages")}
                        <MetricInfo
                          text={t("metricTooltips.groups_messages")}
                          label={t("groups.col.messages")}
                        />
                      </span>
                    </th>
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
      <td className="p-3 text-center tabular-nums text-muted-foreground">
        <div className="inline-flex flex-col items-center leading-tight">
          <span>{link.messageCount}</span>
          {link.coverageCount >= 2 && (
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-cyan/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
              <Smartphone className="size-3" />
              {t("groups.numbersCovered", { n: link.coverageCount })}
            </span>
          )}
        </div>
      </td>
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

// ---- Pending auto-link suggestions (confirmation queue) -------------------
function SuggestionsSection({
  suggestions,
  t,
  onChanged,
}: {
  suggestions: WaLinkSuggestion[];
  t: ReturnType<typeof useTranslations>;
  onChanged: () => void;
}) {
  return (
    <Card className="border-amber/30">
      <CardContent className="space-y-1 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber">
          <AlertTriangle className="size-4" />
          {t("groups.pending.title", { n: suggestions.length })}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t("groups.pending.subtitle")}</p>
        <div className="divide-y divide-border/60">
          {suggestions.map((s) => (
            <SuggestionRow key={s.id} s={s} t={t} onChanged={onChanged} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SuggestionRow({
  s,
  t,
  onChanged,
}: {
  s: WaLinkSuggestion;
  t: ReturnType<typeof useTranslations>;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = (kind: "confirm" | "reject") => {
    setError(null);
    startTransition(async () => {
      const res =
        kind === "confirm"
          ? await confirmWaSuggestionAction({ chatId: s.chatId })
          : await rejectWaSuggestionAction({ chatId: s.chatId });
      if (res.error) setError(res.error);
      else onChanged();
    });
  };

  const projectLabel = s.suggestedProjectCode
    ? `${s.suggestedProjectCode} · ${s.suggestedProjectName ?? ""}`
    : s.suggestedProjectName;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium">{s.chatName ?? s.chatId}</p>
        <p className="text-xs text-muted-foreground">
          {t("groups.pending.suggests")}:{" "}
          <span className="text-foreground">{s.suggestedClientName ?? "—"}</span>
          {projectLabel ? <span className="text-muted-foreground"> · {projectLabel}</span> : null}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {error && (
          <span className="text-[10px] text-cc-red" title={error}>
            {t("groups.pending.failed")}
          </span>
        )}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act("confirm")}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {t("groups.pending.confirm")}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("reject")}>
          <X className="size-3.5" />
          {t("groups.pending.reject")}
        </Button>
      </div>
    </div>
  );
}

// ---- Projects missing their client/team groups ---------------------------
function CoverageSection({
  gaps,
  groupOptions,
  t,
  onLinked,
}: {
  gaps: ProjectCoverageGap[];
  groupOptions: { value: string; label: string }[];
  t: ReturnType<typeof useTranslations>;
  onLinked: () => void;
}) {
  return (
    <Card className="border-cc-red/25">
      <CardContent className="space-y-1 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cc-red">
          <FolderX className="size-4" />
          {t("groups.coverage.title", { n: gaps.length })}
        </div>
        <p className="mb-1 text-xs text-muted-foreground">{t("groups.coverage.subtitle")}</p>
        <p className="mb-3 text-xs text-cyan">{t("groups.coverage.linkHint")}</p>
        <div className="flex flex-col gap-2">
          {gaps.map((g) => (
            <CoverageRow
              key={g.projectId}
              g={g}
              groupOptions={groupOptions}
              t={t}
              onLinked={onLinked}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CoverageRow({
  g,
  groupOptions,
  t,
  onLinked,
}: {
  g: ProjectCoverageGap;
  groupOptions: { value: string; label: string }[];
  t: ReturnType<typeof useTranslations>;
  onLinked: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Link the chosen WhatsApp group to this project, stamping it with the
  // project's client + the slot's kind so it satisfies coverage immediately.
  const linkGroup = (chatId: string, kind: GroupKind) => {
    if (!chatId) return;
    setError(null);
    startTransition(async () => {
      const res = await mapWaGroupAction({
        chatId,
        projectId: g.projectId,
        ...(g.clientId ? { clientId: g.clientId } : {}),
        groupKind: kind,
        isActive: true,
      });
      if (res.error) setError(res.error);
      else onLinked();
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <div className="min-w-[180px]">
        <p className="text-sm font-medium">
          {g.projectCode ? (
            <span className="font-mono text-xs text-muted-foreground">{g.projectCode} · </span>
          ) : null}
          {g.projectName}
        </p>
        {g.clientName && <p className="text-xs text-muted-foreground">{g.clientName}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!g.hasClientGroup && (
          <div className="flex items-center gap-1.5">
            <MessageSquare className="size-3.5 text-cc-red" />
            <div className="min-w-[200px]">
              <SearchableSelect
                value=""
                onValueChange={(v) => linkGroup(v, "client")}
                options={groupOptions}
                placeholder={t("groups.coverage.linkClient")}
                searchPlaceholder={t("groups.searchProject")}
                emptyMessage={t("groups.coverage.noGroups")}
                ariaLabel={t("groups.coverage.linkClient")}
              />
            </div>
          </div>
        )}
        {!g.hasTechnicalGroup && (
          <div className="flex items-center gap-1.5">
            <Wrench className="size-3.5 text-cc-red" />
            <div className="min-w-[200px]">
              <SearchableSelect
                value=""
                onValueChange={(v) => linkGroup(v, "technical")}
                options={groupOptions}
                placeholder={t("groups.coverage.linkTeam")}
                searchPlaceholder={t("groups.searchProject")}
                emptyMessage={t("groups.coverage.noGroups")}
                ariaLabel={t("groups.coverage.linkTeam")}
              />
            </div>
          </div>
        )}
        {pending && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t("groups.coverage.linking")}
          </span>
        )}
        {error && (
          <span className="text-[10px] text-cc-red" title={error}>
            تعذّر الحفظ
          </span>
        )}
      </div>
    </div>
  );
}
