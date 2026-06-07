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

interface SessionInfo {
  status: Status;
  phone: string | null;
  pushname: string | null;
  detail?: string;
}

export function ConnectWorkspace() {
  const t = useTranslations("SatisfactionPage.connect");
  const [info, setInfo] = useState<SessionInfo>({ status: "LOADING", phone: null, pushname: null });
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/wa/session", { cache: "no-store" });
      const data = (await res.json()) as SessionInfo;
      setInfo(data);
      if (data.status === "SCAN_QR") {
        const qres = await fetch("/api/wa/session/qr", { cache: "no-store" });
        const qjson = await qres.json();
        setQr(qjson.image ?? null);
      } else {
        setQr(null);
      }
    } catch {
      setInfo({ status: "UNREACHABLE", phone: null, pushname: null });
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [poll]);

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/wa/session", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "تعذر بدء الجلسة");
      await poll();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setError(null);
    setBusy(true);
    try {
      await fetch("/api/wa/session", { method: "DELETE" });
      await poll();
    } finally {
      setBusy(false);
    }
  };

  const s = info.status;

  return (
    <div className="max-w-2xl space-y-4">
      <StatusBanner status={s} info={info} t={t} />

      {/* NOT CONFIGURED — needs env + deployed OpenWA */}
      {s === "NOT_CONFIGURED" && (
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
      )}

      {/* UNREACHABLE */}
      {s === "UNREACHABLE" && (
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p className="text-muted-foreground">{t("unreachableBody")}</p>
            {info.detail && <p className="font-mono text-[11px] text-cc-red" dir="ltr">{info.detail}</p>}
            <Button variant="outline" size="sm" onClick={poll}>
              <RefreshCw className="size-4" /> {t("retry")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* QR to scan */}
      {s === "SCAN_QR" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <QrCode className="size-4 text-cyan" /> {t("scanTitle")}
            </p>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="WhatsApp QR" className="size-64 rounded-xl border border-border bg-white p-2" />
            ) : (
              <div className="flex size-64 items-center justify-center rounded-xl border border-border">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}
            <ol className="list-decimal space-y-1 ps-5 text-xs text-muted-foreground">
              <li>{t("scanStep1")}</li>
              <li>{t("scanStep2")}</li>
              <li>{t("scanStep3")}</li>
            </ol>
          </CardContent>
        </Card>
      )}

      {/* CONNECTED */}
      {s === "CONNECTED" && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-green-dim text-cc-green">
                <CheckCircle2 className="size-5" />
              </span>
              <div>
                <p className="font-semibold">{info.pushname ?? t("connected")}</p>
                {info.phone && <p className="font-mono text-xs text-muted-foreground" dir="ltr">{info.phone}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/satisfaction/groups"
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan/10 px-3 py-2 text-xs font-medium text-cyan hover:bg-cyan/20"
              >
                {t("goMapGroups")} <ArrowRight className="size-3.5 rtl:rotate-180" />
              </Link>
              <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
                {t("disconnect")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Disconnected / not created / failed → Connect button */}
      {(s === "NOT_CREATED" || s === "DISCONNECTED" || s === "FAILED") && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-sm text-muted-foreground">{t("connectPrompt")}</p>
            <Button onClick={connect} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
              {t("connectBtn")}
            </Button>
          </CardContent>
        </Card>
      )}

      {(s === "CONNECTING" || s === "INITIALIZING" || s === "LOADING") && (
        <Card>
          <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("working")}
          </CardContent>
        </Card>
      )}

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-dim px-3 py-2 text-sm text-cc-red">
          <AlertTriangle className="size-4" /> {error}
        </p>
      )}
    </div>
  );
}

function StatusBanner({
  status,
  info,
  t,
}: {
  status: Status;
  info: SessionInfo;
  t: ReturnType<typeof useTranslations>;
}) {
  const map: Record<string, { tone: string; label: string }> = {
    CONNECTED: { tone: "text-cc-green bg-green-dim", label: t("state.connected") },
    SCAN_QR: { tone: "text-amber bg-amber-dim", label: t("state.scan") },
    CONNECTING: { tone: "text-amber bg-amber-dim", label: t("state.connecting") },
    INITIALIZING: { tone: "text-amber bg-amber-dim", label: t("state.connecting") },
    DISCONNECTED: { tone: "text-muted-foreground bg-soft-1", label: t("state.disconnected") },
    NOT_CREATED: { tone: "text-muted-foreground bg-soft-1", label: t("state.disconnected") },
    NOT_CONFIGURED: { tone: "text-amber bg-amber-dim", label: t("state.notConfigured") },
    UNREACHABLE: { tone: "text-cc-red bg-red-dim", label: t("state.unreachable") },
    FAILED: { tone: "text-cc-red bg-red-dim", label: t("state.failed") },
    LOADING: { tone: "text-muted-foreground bg-soft-1", label: t("state.loading") },
  };
  const m = map[status] ?? map.LOADING;
  return (
    <div className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium", m.tone)}>
      <span className="size-2 rounded-full bg-current" />
      {m.label}
      {info.detail && status === "UNREACHABLE" ? "" : ""}
    </div>
  );
}
