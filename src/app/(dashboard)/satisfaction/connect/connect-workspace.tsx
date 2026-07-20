"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Smartphone,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Power,
  QrCode,
  RefreshCw,
  Settings2,
  ArrowRight,
  Plus,
  Trash2,
  Star,
  History,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status =
  | "NOT_CONFIGURED"
  | "UNREACHABLE"
  | "NOT_CREATED"
  | "INITIALIZING"
  | "SCAN_QR"
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "FAILED"
  | "LOADING";

interface Account {
  id: string;
  session_id: string;
  phone: string | null;
  label: string | null;
  is_active: boolean;
  status: Status;
  last_seen_at: string | null;
  status_updated_at?: string | null;
  // The GATEWAY's activity clock (not our ingestion heartbeat). This is the only
  // field that exposes a wedged session — see the wedged check below.
  last_active_at?: string | null;
  pushname?: string | null;
}

export function ConnectWorkspace({ primarySession }: { primarySession: string }) {
  const t = useTranslations("SatisfactionPage.connect");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [gatewayState, setGatewayState] = useState<Status>("LOADING");
  const [qrBySession, setQrBySession] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState<string | null>(null);
  const [backfillNote, setBackfillNote] = useState<Record<string, string>>({});
  const [resyncing, setResyncing] = useState(false);
  const [resyncNote, setResyncNote] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);

  const poll = useCallback(async () => {
    setNowMs(Date.now()); // captured in effect/handler context (never during render)
    try {
      const res = await fetch("/api/wa/accounts", { cache: "no-store" });
      if (!res.ok) {
        // 403 etc. — surface gateway-level state via the primary session probe.
        const probe = await fetch("/api/wa/session", { cache: "no-store" });
        const pj = (await probe.json()) as { status?: Status };
        setGatewayState(pj.status ?? "UNREACHABLE");
        setAccounts([]);
        return;
      }
      const data = (await res.json()) as { accounts: Account[] };
      setAccounts(data.accounts);
      setGatewayState(data.accounts.length ? "CONNECTED" : "NOT_CREATED");

      // Refresh QR for any session awaiting a scan.
      const scanning = data.accounts.filter((a) => a.status === "SCAN_QR");
      const entries = await Promise.all(
        scanning.map(async (a) => {
          const qres = await fetch(`/api/wa/session/qr?session=${encodeURIComponent(a.session_id)}`, {
            cache: "no-store",
          });
          const qjson = await qres.json();
          return [a.session_id, qjson.image ?? null] as const;
        }),
      );
      setQrBySession(Object.fromEntries(entries));
    } catch {
      setGatewayState("UNREACHABLE");
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [poll]);

  const addNumber = async () => {
    setError(null);
    setAdding(true);
    try {
      const res = await fetch("/api/wa/accounts", { method: "POST" });
      const data = await res.json();
      if (!res.ok && !data.account) setError(data.error ?? "تعذر إضافة الرقم");
      await poll();
    } finally {
      setAdding(false);
    }
  };

  const connect = async (session: string) => {
    setError(null);
    setBusy(session);
    try {
      const res = await fetch(`/api/wa/session?session=${encodeURIComponent(session)}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "تعذر بدء الجلسة");
      await poll();
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (session: string) => {
    setBusy(session);
    try {
      await fetch(`/api/wa/session?session=${encodeURIComponent(session)}`, { method: "DELETE" });
      await poll();
    } finally {
      setBusy(null);
    }
  };

  const resetConnection = async (session: string) => {
    setError(null);
    setBusy(session);
    try {
      const resetRes = await fetch(`/api/wa/session?session=${encodeURIComponent(session)}`, {
        method: "PATCH",
      });
      const resetData = await resetRes.json();
      if (!resetRes.ok) setError(resetData.error ?? t("resetQrFailed"));
      await poll();
    } catch {
      setError(t("resetQrFailed"));
    } finally {
      setBusy(null);
    }
  };

  const backfill = async (session: string) => {
    setError(null);
    setBackfilling(session);
    try {
      const refresh = backfillNote[session] ? "0" : "1";
      const res = await fetch(`/api/wa/accounts/backfill?session=${encodeURIComponent(session)}&refresh=${refresh}`, {
        method: "POST",
      });
      const data = (await res.json()) as { imported?: number; remaining?: number; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "تعذر سحب السجل");
      } else {
        const note =
          (data.remaining ?? 0) > 0
            ? t("backfillMore")
            : t("backfillDone", { count: data.imported ?? 0 });
        setBackfillNote((m) => ({ ...m, [session]: note }));
      }
      await poll();
    } finally {
      setBackfilling(null);
    }
  };

  // (Re)register the dashboard webhook on every enrolled number's gateway
  // session, so live group messages stream in no matter which number is a
  // member of a group. Only works from production (public webhook URL).
  const resyncWebhooks = async () => {
    setError(null);
    setResyncNote(null);
    setResyncing(true);
    try {
      const res = await fetch("/api/wa/webhooks/resync", { method: "POST" });
      const data = (await res.json()) as {
        registered?: number;
        total?: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error ?? t("resyncFail"));
      } else {
        setResyncNote(
          t("resyncDone", { count: data.registered ?? 0, total: data.total ?? 0 }),
        );
      }
    } catch {
      setError(t("resyncFail"));
    } finally {
      setResyncing(false);
    }
  };

  const remove = async (session: string) => {
    if (!window.confirm(t("removeConfirm"))) return;
    setBusy(session);
    try {
      await fetch(`/api/wa/accounts?session=${encodeURIComponent(session)}`, { method: "DELETE" });
      await poll();
    } finally {
      setBusy(null);
    }
  };

  // Gateway not configured / unreachable — show the same global guidance as before.
  if (gatewayState === "NOT_CONFIGURED") {
    return (
      <div className="max-w-2xl space-y-4">
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <Settings2 className="size-4 text-amber" /> {t("notConfiguredTitle")}
            </p>
            <p className="text-muted-foreground">{t("notConfiguredBody")}</p>
            <pre className="overflow-x-auto rounded-lg bg-soft-1 p-3 text-[11px] leading-relaxed text-muted-foreground" dir="ltr">{`WA_API_URL=http://<vps-host>:2785
WA_API_KEY=<openwa api key>
WA_WEBHOOK_SECRET=<shared secret>
WA_PUBLIC_WEBHOOK_URL=https://<app>/api/wa/webhook`}</pre>
            <p className="text-xs text-muted-foreground">{t("seeRunbook")} <code dir="ltr">docs/WHATSAPP_INGESTION.md</code></p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gatewayState === "UNREACHABLE") {
    return (
      <div className="max-w-2xl space-y-4">
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p className="text-muted-foreground">{t("unreachableBody")}</p>
            <Button variant="outline" size="sm" onClick={poll}>
              <RefreshCw className="size-4" /> {t("retry")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("numbersTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t("numbersSubtitle")}</p>
      </div>

      {accounts === null ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("working")}
          </CardContent>
        </Card>
      ) : (
        accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            isPrimary={a.session_id === primarySession}
            qr={qrBySession[a.session_id] ?? null}
            busy={busy === a.session_id}
            backfilling={backfilling === a.session_id}
            backfillNote={backfillNote[a.session_id] ?? null}
            nowMs={nowMs}
            t={t}
            onConnect={() => connect(a.session_id)}
            onResetConnection={() => resetConnection(a.session_id)}
            onDisconnect={() => disconnect(a.session_id)}
            onBackfill={() => backfill(a.session_id)}
            onRemove={() => remove(a.session_id)}
          />
        ))
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={addNumber} disabled={adding} variant="outline">
          {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {adding ? t("adding") : t("addNumber")}
        </Button>
        <Button onClick={resyncWebhooks} disabled={resyncing} variant="outline">
          {resyncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {resyncing ? t("resyncing") : t("resyncWebhooks")}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("resyncHint")}</p>
      {resyncNote && (
        <p className="flex items-center gap-2 rounded-lg bg-green-dim px-3 py-2 text-sm text-cc-green">
          <CheckCircle2 className="size-4" /> {resyncNote}
        </p>
      )}

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-dim px-3 py-2 text-sm text-cc-red">
          <AlertTriangle className="size-4" /> {error}
        </p>
      )}
    </div>
  );
}

function AccountCard({
  account: a,
  isPrimary,
  qr,
  busy,
  backfilling,
  backfillNote,
  nowMs,
  t,
  onConnect,
  onResetConnection,
  onDisconnect,
  onBackfill,
  onRemove,
}: {
  account: Account;
  isPrimary: boolean;
  qr: string | null;
  busy: boolean;
  backfilling: boolean;
  backfillNote: string | null;
  nowMs: number;
  t: ReturnType<typeof useTranslations>;
  onConnect: () => void;
  onResetConnection: () => void;
  onDisconnect: () => void;
  onBackfill: () => void;
  onRemove: () => void;
}) {
  const s = a.status;
  const title = a.label || a.pushname || (isPrimary ? t("primary") : t("addNumber"));
  // Warn only when we HAVE seen activity but it has gone quiet for 7+ days —
  // a connected number that silently stopped delivering. Never warn on null
  // (no provenance yet ≠ a problem).
  // "Connected but delivering nothing." last_seen_at is OUR ingestion heartbeat,
  // so this catches the failure the gateway's own clock cannot see: a session
  // that heartbeats happily while its WhatsApp store is empty/erroring (the
  // second number on 2026-07-20 — status ready, lastActive fresh, /groups 500,
  // zero messages for five days). The old threshold was 7 DAYS, so a five-day
  // outage never tripped it; 48h clears a quiet weekend and still catches this.
  const deliveryIdleHours =
    s === "CONNECTED" && a.last_seen_at != null && nowMs > 0
      ? (nowMs - new Date(a.last_seen_at).getTime()) / 3_600_000
      : null;
  const stale = deliveryIdleHours != null && deliveryIdleHours >= 48;

  // WEDGED: the gateway still reports CONNECTED but its own activity clock has
  // been frozen for hours. This is the 2026-07-14 failure — the primary number
  // sat "متصل" for six days while delivering nothing, and the 7-day `stale`
  // check above never fired. The gateway's lastActive ticks constantly on a
  // healthy session (idle 0h) versus 138h on the wedged one, so hours — not
  // days — is the right resolution. Matches WEDGED_HOURS in /api/cron/wa-health.
  const wedgedIdleHours =
    s === "CONNECTED" && a.last_active_at != null && nowMs > 0
      ? (nowMs - new Date(a.last_active_at).getTime()) / 3_600_000
      : null;
  const wedged = wedgedIdleHours != null && wedgedIdleHours >= 6;
  const waitingForQr = s === "INITIALIZING" || s === "CONNECTING" || s === "SCAN_QR";
  const qrWaitStartedAt = a.status_updated_at
    ? new Date(a.status_updated_at).getTime()
    : Number.NaN;
  const qrStalled =
    waitingForQr &&
    !qr &&
    nowMs > 0 &&
    Number.isFinite(qrWaitStartedAt) &&
    nowMs - qrWaitStartedAt > 90_000;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full",
                wedged
                  ? "bg-red-dim text-cc-red"
                  : s === "CONNECTED"
                    ? "bg-green-dim text-cc-green"
                    : "bg-soft-1 text-muted-foreground",
              )}
            >
              {wedged ? (
                <AlertTriangle className="size-5" />
              ) : s === "CONNECTED" ? (
                <CheckCircle2 className="size-5" />
              ) : (
                <Smartphone className="size-5" />
              )}
            </span>
            <div>
              <p className="flex items-center gap-1.5 font-semibold">
                {title}
                {isPrimary && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
                    <Star className="size-3" /> {t("primary")}
                  </span>
                )}
              </p>
              {a.phone && (
                <p className="font-mono text-xs text-muted-foreground" dir="ltr">{a.phone}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {t("lastSeen")}: {a.last_seen_at ? new Date(a.last_seen_at).toLocaleString() : t("neverSeen")}
              </p>
            </div>
          </div>
          <StatusPill status={s} t={t} />
        </div>

        {/* QR to scan this specific number */}
        {s === "SCAN_QR" && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-soft-1/40 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold">
              <QrCode className="size-4 text-cyan" /> {t("scanForLabel")}
            </p>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="WhatsApp QR" className="size-56 rounded-xl border border-border bg-white p-2" />
            ) : (
              <div className="flex size-56 items-center justify-center rounded-xl border border-border">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}
            <ol className="list-decimal space-y-1 ps-5 text-[11px] text-muted-foreground">
              <li>{t("scanStep1")}</li>
              <li>{t("scanStep2")}</li>
              <li>{t("scanStep3")}</li>
            </ol>
          </div>
        )}

        {/* Freshly-added/restarting number: the gateway is spinning up its
            browser and hasn't produced the QR yet. Show a spinner so the card
            doesn't read as "stuck on Connecting" while we wait for SCAN_QR. */}
        {(s === "INITIALIZING" || s === "CONNECTING") && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-soft-1/40 p-4">
            <div className="flex size-56 items-center justify-center rounded-xl border border-border">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">{t("preparingQr")}</p>
          </div>
        )}

        {qrStalled && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-amber/30 bg-amber-dim p-4 text-center">
            <p className="text-xs text-amber">{t("qrTakingLong")}</p>
            <Button size="sm" variant="outline" onClick={onResetConnection} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {busy ? t("resettingQr") : t("generateNewQr")}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {s === "CONNECTED" && (
            <Link
              href="/satisfaction/groups"
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan/10 px-3 py-2 text-xs font-medium text-cyan hover:bg-cyan/20"
            >
              {t("goMapGroups")} <ArrowRight className="size-3.5 rtl:rotate-180" />
            </Link>
          )}
          {(s === "NOT_CREATED" || s === "DISCONNECTED" || s === "FAILED") && (
            <Button size="sm" onClick={onConnect} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
              {s === "DISCONNECTED" || s === "FAILED" ? t("reconnect") : t("connectBtn")}
            </Button>
          )}
          {s === "CONNECTED" && (
            <Button variant="outline" size="sm" onClick={onBackfill} disabled={backfilling || busy}>
              {backfilling ? <Loader2 className="size-4 animate-spin" /> : <History className="size-4" />}
              {backfilling ? t("backfilling") : t("backfillHistory")}
            </Button>
          )}
          {s === "CONNECTED" && (
            <Button variant="outline" size="sm" onClick={onDisconnect} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
              {t("disconnect")}
            </Button>
          )}
          {!isPrimary && (
            <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy} className="text-cc-red hover:text-cc-red">
              <Trash2 className="size-4" /> {t("remove")}
            </Button>
          )}
        </div>

        {wedged ? (
          <div className="flex items-start gap-2 rounded-lg border border-cc-red/40 bg-red-dim px-3 py-2 text-[11px] text-cc-red">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <div className="space-y-0.5">
              <p className="font-semibold">
                {t("wedgedTitle", { hours: Math.round(wedgedIdleHours!) })}
              </p>
              <p className="leading-5 text-foreground/70">{t("wedgedBody")}</p>
            </div>
          </div>
        ) : (
          stale && (
            <div className="flex items-start gap-2 rounded-lg border border-amber/35 bg-amber/10 px-3 py-2 text-[11px] text-amber">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="font-semibold">
                  {t("noDeliveryTitle", { hours: Math.round(deliveryIdleHours!) })}
                </p>
                <p className="leading-5 text-foreground/70">{t("noDeliveryBody")}</p>
              </div>
            </div>
          )
        )}

        {backfillNote && (
          <p className="text-[11px] text-muted-foreground">{backfillNote}</p>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ status, t }: { status: Status; t: ReturnType<typeof useTranslations> }) {
  const map: Record<string, { tone: string; label: string }> = {
    CONNECTED: { tone: "text-cc-green bg-green-dim", label: t("state.connected") },
    SCAN_QR: { tone: "text-amber bg-amber-dim", label: t("state.scan") },
    CONNECTING: { tone: "text-amber bg-amber-dim", label: t("state.connecting") },
    INITIALIZING: { tone: "text-amber bg-amber-dim", label: t("state.connecting") },
    DISCONNECTED: { tone: "text-muted-foreground bg-soft-1", label: t("state.disconnected") },
    NOT_CREATED: { tone: "text-muted-foreground bg-soft-1", label: t("state.disconnected") },
    FAILED: { tone: "text-cc-red bg-red-dim", label: t("state.failed") },
    LOADING: { tone: "text-muted-foreground bg-soft-1", label: t("state.loading") },
  };
  const m = map[status] ?? map.LOADING;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs font-medium", m.tone)}>
      <span className="size-2 rounded-full bg-current" />
      {m.label}
    </span>
  );
}
