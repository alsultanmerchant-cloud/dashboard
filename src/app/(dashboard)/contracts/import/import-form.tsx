"use client";

import { useState, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  previewImportAction, commitImportAction,
  type ImportPreviewState, type ImportCommitState,
} from "./_actions";

export function ImportForm() {
  const router = useRouter();
  const [previewState, previewAction, previewing] = useActionState<
    ImportPreviewState | undefined, FormData
  >(previewImportAction, undefined);
  const [commitState, commitAction, committing] = useActionState<
    ImportCommitState | undefined, FormData
  >(commitImportAction, undefined);

  // Track selected filename for the file input feedback
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    if (previewState?.kind === "error") toast.error(previewState.error);
  }, [previewState]);

  useEffect(() => {
    if (commitState?.kind === "error") toast.error(commitState.error);
    if (commitState?.kind === "ok") {
      toast.success("تم استيراد البيانات");
      // Don't auto-redirect — let user see the result + maybe navigate
    }
  }, [commitState]);

  // Step 1: file upload + preview
  if (!previewState || previewState.kind !== "preview") {
    return (
      <Card>
        <CardContent className="p-6">
          <form action={previewAction} className="space-y-4">
            <div>
              <label htmlFor="file" className="block mb-2 text-sm font-medium">
                اختر ملف Excel
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
                يقبل النظام أوراق &quot;Clients Contracts&quot; و &quot;💲Installments Tracker&quot; من ملف الأكاونت.
                لن يتم حفظ شيء حتى تراجع المعاينة وتؤكدها.
              </p>
            </div>

            <Button type="submit" disabled={previewing}>
              {previewing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              عرض المعاينة
            </Button>
          </form>
        </CardContent>
      </Card>
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
                تم الاستيراد بنجاح
              </h3>
              <ul className="mt-3 space-y-1 text-sm">
                <li>
                  العملاء: <strong>{r.clientsCreated}</strong> جديد ·{" "}
                  <strong>{r.clientsUpdated}</strong> تحديث
                </li>
                <li>
                  العقود المستوردة: <strong>{r.contractsUpserted}</strong>
                </li>
                <li>
                  الدفعات المستوردة: <strong>{r.installmentsUpserted}</strong>
                </li>
                {r.errors.length > 0 && (
                  <li className="text-amber">
                    تحذيرات: {r.errors.length} ({r.errors.length > 0 ? "انظر القائمة أدناه" : "لا شيء"})
                  </li>
                )}
              </ul>

              {r.errors.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber/30 bg-amber-dim/20 p-3">
                  <p className="text-xs font-semibold text-amber mb-1.5">
                    عناصر تم تخطّيها:
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
                  لوحة المدير المالي
                </Button>
                <Button variant="outline" onClick={() => router.push("/contracts")}>
                  قائمة العقود
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
            <h3 className="text-sm font-semibold">المعاينة قبل الحفظ</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="عملاء" value={p.clients.length} tone="info" />
            <Stat label="عقود" value={p.contracts.length} tone="success" />
            <Stat label="دفعات" value={p.installments.length} tone="success" />
            <Stat label="صفوف مُتجاهلة" value={p.stats.skippedRows} tone="muted" />
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
          <p className="text-sm font-semibold mb-3">عينة من أول 5 عقود</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-soft">
                  <th className="text-start font-medium py-2 pe-3">العميل</th>
                  <th className="text-start font-medium py-2 pe-3">المسؤول</th>
                  <th className="text-start font-medium py-2 pe-3">النوع</th>
                  <th className="text-start font-medium py-2 pe-3">القيمة</th>
                  <th className="text-start font-medium py-2 pe-3">المدفوع</th>
                  <th className="text-start font-medium py-2 pe-3">البداية</th>
                  <th className="text-start font-medium py-2 pe-3">الحالة</th>
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
          <p className="text-xs text-foreground/90 leading-relaxed">
            <strong>قبل الضغط على &quot;حفظ&quot;:</strong> سيتم إضافة العملاء الجدد وتحديث الموجود.
            لن يُحذف أي شيء. الاستيراد آمن للتكرار — تشغيله مرة ثانية سيحدِّث القيم وليس يضاعفها.
          </p>
        </CardContent>
      </Card>

      <form action={commitAction} className="flex gap-2">
        <input type="hidden" name="payload" value={JSON.stringify(p)} />
        <Button type="submit" disabled={committing} className="gap-1.5">
          {committing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          حفظ {p.contracts.length} عقد و {p.installments.length} دفعة
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          إلغاء واختيار ملف آخر
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
