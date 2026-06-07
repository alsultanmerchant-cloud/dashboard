"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw, Check, Loader2, MessageSquare, Wrench, Ban } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { mapWaGroupAction, syncWaGroupsAction } from "../_actions";
import type { WaGroupLink, GroupKind } from "@/lib/data/satisfaction";

interface Props {
  links: WaGroupLink[];
  options: { value: string; label: string }[];
}

export function WaGroupsWorkspace({ links, options }: Props) {
  const t = useTranslations("SatisfactionPage");
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {t("groups.sync")}
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
                    <th className="p-3 text-center font-medium">{t("groups.col.messages")}</th>
                    <th className="p-3 text-start font-medium">{t("groups.col.client")}</th>
                    <th className="p-3 text-center font-medium">{t("groups.col.kind")}</th>
                    <th className="p-3 text-center font-medium">{t("groups.col.active")}</th>
                    <th className="p-3 text-center font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <GroupRow key={link.id} link={link} options={options} t={t} onSaved={() => router.refresh()} />
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
  t,
  onSaved,
}: {
  link: WaGroupLink;
  options: { value: string; label: string }[];
  t: ReturnType<typeof useTranslations>;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState(link.clientId ?? "");
  const [kind, setKind] = useState<GroupKind | "">(link.groupKind ?? "");
  const [active, setActive] = useState(link.isActive);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    clientId !== (link.clientId ?? "") ||
    kind !== (link.groupKind ?? "") ||
    active !== link.isActive;

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await mapWaGroupAction({
        chatId: link.chatId,
        clientId: clientId || null,
        groupKind: (kind || null) as GroupKind | null,
        isActive: active,
      });
      if (res.error) setError(res.error);
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
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
      <td className="p-3 text-center tabular-nums text-muted-foreground">{link.messageCount}</td>
      <td className="p-3 min-w-[180px]">
        <SearchableSelect
          value={clientId}
          onValueChange={setClientId}
          options={options}
          placeholder={t("groups.unmapped")}
          searchPlaceholder={t("searchClient")}
          emptyMessage={t("noClients")}
          ariaLabel={t("groups.col.client")}
        />
      </td>
      <td className="p-3 text-center">
        <div className="inline-flex gap-1">
          <KindBtn active={kind === "client"} onClick={() => setKind(kind === "client" ? "" : "client")} icon={<MessageSquare className="size-3.5" />} label={t("clientGroup")} />
          <KindBtn active={kind === "technical"} onClick={() => setKind(kind === "technical" ? "" : "technical")} icon={<Wrench className="size-3.5" />} label={t("technicalGroup")} />
        </div>
      </td>
      <td className="p-3 text-center">
        <button
          type="button"
          onClick={() => setActive((a) => !a)}
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
        <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || pending} onClick={save}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
          {t("groups.save")}
        </Button>
        {error && <p className="mt-1 text-[10px] text-cc-red">{error}</p>}
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
