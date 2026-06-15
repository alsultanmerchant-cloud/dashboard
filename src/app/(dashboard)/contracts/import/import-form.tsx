"use client";

import { useState, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, ArrowLeft, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  previewImportAction, commitImportAction, syncGoogleSheetAction,
  type ImportPreviewState, type ImportCommitState, type GoogleSheetSyncState,
} from "./_actions";

export function ImportForm() {
  const t = useTranslations("ContractsImportPage");
  const router = useRouter();
  const [previewState, previewAction, previewing] = useActionState<
    ImportPreviewState | undefined, FormData
  >(previewImportAction, undefined);
  const [commitState, commitAction, committing] = useActionState<
    ImportCommitState | undefined, FormData
  >(commitImportAction, undefined);
  const [syncState, syncAction, syncing] = useActionState<
    GoogleSheetSyncState | undefined, FormData
  >(syncGoogleSheetAction, undefined);

  // Track selected filename for the file input feedback
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    if (previewState?.kind === "error") toast.error(previewState.error);
  }, [previewState]);

  useEffect(() => {
    if (commitState?.kind === "error") toast.error(commitState.error);
    if (commitState?.kind === "ok") {
      toast.success(t("form.toasts.imported"));
      // Don't auto-redirect — let user see the result + maybe navigate
    }
  }, [commitState, t]);

  useEffect(() => {
    if (syncState?.kind === "error") toast.error(syncState.error);
    if (syncState?.kind === "ok") toast.success(t("form.toasts.synced"));
  }, [syncState, t]);

  // Step 1: file upload + preview
  if (!previewState || previewState.kind !== "preview") {
    return (
      <div className="space-y-4">
        <Card className="border-cyan/20 bg-cyan-dim/10">
          <CardContent className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <RefreshCw className="size-4 text-cyan" />
                  <h3 className="text-sm font-semibold">{t("form.google.title")}</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {t("form.google.description")}
                </p>
              </div>
              <form action={syncAction}>
                <Button type="submit" disabled={syncing} className="gap-1.5">
                  {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {t("form.google.sync")}
                </Button>
              </form>
            </div>

            {syncState?.kind === "ok" && (
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label={t("form.stats.clients")} value={syncState.parsedClients} tone="info" />
                <Stat label={t("form.stats.contracts")} value={syncState.parsedContracts} tone="success" />
                <Stat label={t("form.stats.installments")} value={syncState.parsedInstallments} tone="success" />
                <Stat label={t("form.stats.skipped")} value={syncState.errors.length} tone="muted" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <form action={previewAction} className="space-y-4">
              <div>
                <label htmlFor="file" className="block mb-2 text-sm font-medium">
                  {t("form.fileLabel")}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="file"
                    name="file"
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    required
                    onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                    className="block w-full text-sm text-foreground file:mx-3 file:rounded-lg file:border-0 file:bg-cyan-dim file:px-3 file:py-2 file:text-cyan file:font-medium hover:file:bg-cyan-dim/80 file:cursor-pointer cursor-pointer"
                  />
                </div>
                {fileName && (
                  <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                    <FileSpreadsheet className="size-3.5" />
                    {fileName}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t("form.fileHint")}
                </p>
              </div>

              <Button type="submit" disabled={previewing}>
                {previewing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {t("form.preview")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 2: preview + commit
  const p = previewState.payload;

  if (commitState?.kind === "ok") {
    const r = commitState;
    return (
      <Card className="border-cc-green/30 bg-green-dim/10">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="size-6 text-cc-green shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-base font-semibold text-cc-green">
                {t("form.successTitle")}
              </h3>
              <ul className="mt-3 space-y-1 text-sm">
                <li>
                  {t("form.successClients", { created: r.clientsCreated, updated: r.clientsUpdated })}
                </li>
                <li>
                  {t("form.successContracts", { count: r.contractsUpserted })}
                </li>
                <li>
                  {t("form.successInstallments", { count: r.installmentsUpserted })}
                </li>
                {r.errors.length > 0 && (
                  <li className="text-amber">
                    {t("form.warnings", { count: r.errors.length })}
                  </li>
                )}
              </ul>

              {r.errors.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber/30 bg-amber-dim/20 p-3">
                  <p className="text-xs font-semibold text-amber mb-1.5">
                    {t("form.skippedTitle")}
                  </p>
                  <ul className="text-[11px] text-amber/80 space-y-0.5 max-h-40 overflow-auto">
                    {r.errors.map((e, i) => (
                      <li key={i} className="font-mono">· {e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <Button onClick={() => router.push("/finance")} className="gap-1.5">
                  <ArrowLeft className="size-4 icon-flip-rtl" />
                  {t("form.goFinance")}
                </Button>
                <Button variant="outline" onClick={() => router.push("/contracts")}>
                  {t("form.goContracts")}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet className="size-5 text-cyan" />
            <h3 className="text-sm font-semibold">{t("form.previewTitle")}</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label={t("form.stats.clients")} value={p.clients.length} tone="info" />
            <Stat label={t("form.stats.contracts")} value={p.contracts.length} tone="success" />
            <Stat label={t("form.stats.installments")} value={p.installments.length} tone="success" />
            <Stat label={t("form.stats.skipped")} value={p.stats.skippedRows} tone="muted" />
          </div>
          {p.warnings.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber/30 bg-amber-dim/20 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 text-amber shrink-0 mt-0.5" />
                <div className="text-xs text-amber/90">
                  {p.warnings.join(" · ")}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sample tables — first 5 contracts */}
      <Card>
        <CardContent className="p-5">
          <p className="text-sm font-semibold mb-3">{t("form.sampleTitle")}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-soft">
                  <th className="text-start font-medium py-2 pe-3">{t("form.table.client")}</th>
                  <th className="text-start font-medium py-2 pe-3">{t("form.table.owner")}</th>
                  <th className="text-start font-medium py-2 pe-3">{t("form.table.type")}</th>
                  <th className="text-start font-medium py-2 pe-3">{t("form.table.value")}</th>
                  <th className="text-start font-medium py-2 pe-3">{t("form.table.paid")}</th>
                  <th className="text-start font-medium py-2 pe-3">{t("form.table.start")}</th>
                  <th className="text-start font-medium py-2 pe-3">{t("form.table.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {p.contracts.slice(0, 5).map((c) => (
                  <tr key={c.externalKey}>
                    <td className="py-2 pe-3 truncate max-w-[140px]">{c.clientName}</td>
                    <td className="py-2 pe-3 truncate max-w-[120px] text-muted-foreground">
                      {c.accountManagerName ?? "—"}
                    </td>
                    <td className="py-2 pe-3 text-muted-foreground">{c.contractTypeKey ?? c.contractTypeRaw ?? "—"}</td>
                    <td className="py-2 pe-3 tabular-nums">{c.totalValue.toLocaleString("ar-SA-u-nu-latn")}</td>
                    <td className="py-2 pe-3 tabular-nums">{c.paidValue.toLocaleString("ar-SA-u-nu-latn")}</td>
                    <td className="py-2 pe-3 text-muted-foreground" dir="ltr">{c.startDate ?? "—"}</td>
                    <td className="py-2 pe-3 text-muted-foreground">{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-cyan/20 bg-cyan-dim/10">
        <CardContent className="p-4">
          <p className="text-xs text-foreground/90 leading-relaxed">{t("form.safeNote")}</p>
        </CardContent>
      </Card>

      <form action={commitAction} className="flex gap-2">
        <input type="hidden" name="payload" value={JSON.stringify(p)} />
        <Button type="submit" disabled={committing} className="gap-1.5">
          {committing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {t("form.commit", { contracts: p.contracts.length, installments: p.installments.length })}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          {t("form.cancel")}
        </Button>
      </form>
    </div>
  );
}

function Stat({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone: "info" | "success" | "muted";
}) {
  const accent =
    tone === "info" ? "border-cc-blue/30 bg-blue-dim/30 text-cc-blue" :
    tone === "success" ? "border-cc-green/30 bg-green-dim/30 text-cc-green" :
    "border-soft-2 bg-card/60 text-muted-foreground";
  return (
    <div className={`rounded-xl border p-3 ${accent}`}>
      <p className="text-[11px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
