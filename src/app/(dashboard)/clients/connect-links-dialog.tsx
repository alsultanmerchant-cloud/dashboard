"use client";

// Connect-links dialog: attach existing projects and/or contracts to a client
// by re-pointing their FK. Options load lazily on first open (org-wide project
// + contract lists) so list rows stay cheap. Reused inline on the clients list
// (icon trigger) and on the client detail page (labelled button).

import { useState, useCallback } from "react";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { connectClientLinksAction, getConnectOptionsAction } from "./_actions";

type Props = {
  clientId: string;
  clientName: string;
  /** "icon" for list rows, "button" for the detail page. */
  variant?: "icon" | "button";
};

export function ConnectLinksDialog({ clientId, clientName, variant = "icon" }: Props) {
  const t = useTranslations("ClientsPage.connect");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projectOpts, setProjectOpts] = useState<SearchableOption[]>([]);
  const [contractOpts, setContractOpts] = useState<SearchableOption[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [contractIds, setContractIds] = useState<string[]>([]);

  // Lazy-load the org-wide option lists the first time the dialog opens.
  const loadOptions = useCallback(async () => {
    setLoading(true);
    const res = await getConnectOptionsAction();
    setLoading(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    // Exclude rows already owned by this client — they're nothing to attach.
    setProjectOpts(
      res.projects
        .filter((p) => p.client_id !== clientId)
        .map((p) => ({
          value: p.id,
          label: p.project_code ? `${p.name} · ${p.project_code}` : p.name,
          hint: p.client_name ? t("currentlyOwnedBy", { name: p.client_name }) : null,
          keywords: [p.client_name, p.project_code].filter(Boolean).join(" "),
        })),
    );
    setContractOpts(
      res.contracts
        .filter((c) => c.client_id !== clientId)
        .map((c) => ({
          value: c.id,
          label: c.contract_code ?? c.sheet_client_name ?? c.id.slice(0, 8),
          hint: c.client_name ? t("currentlyOwnedBy", { name: c.client_name }) : null,
          keywords: [c.client_name, c.sheet_client_name, c.contract_code].filter(Boolean).join(" "),
        })),
    );
  }, [clientId, t]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && projectOpts.length === 0 && contractOpts.length === 0) {
      void loadOptions();
    }
    if (!next) {
      setProjectIds([]);
      setContractIds([]);
    }
  };

  const onSubmit = async () => {
    if (projectIds.length === 0 && contractIds.length === 0) {
      toast.error(t("nothingSelected"));
      return;
    }
    setSaving(true);
    const res = await connectClientLinksAction({ clientId, projectIds, contractIds });
    setSaving(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(
      t("linked", {
        projects: res.movedProjects,
        contracts: res.movedContracts,
      }),
    );
    setOpen(false);
    setProjectIds([]);
    setContractIds([]);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          variant === "icon" ? (
            <button
              type="button"
              aria-label={t("title")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-soft-2 hover:text-foreground transition-colors"
            />
          ) : (
            <Button variant="outline" size="sm" />
          )
        }
      >
        <Link2 className="size-3.5" />
        {variant === "button" && t("title")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { name: clientName })}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("projectsLabel")}</Label>
              <SearchableSelect
                multi
                value={projectIds}
                onValueChange={setProjectIds}
                options={projectOpts}
                placeholder={t("projectsPlaceholder")}
                searchPlaceholder={t("searchPlaceholder")}
                emptyMessage={t("noProjects")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("contractsLabel")}</Label>
              <SearchableSelect
                multi
                value={contractIds}
                onValueChange={setContractIds}
                options={contractOpts}
                placeholder={t("contractsPlaceholder")}
                searchPlaceholder={t("searchPlaceholder")}
                emptyMessage={t("noContracts")}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("foldNote")}</p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={saving || loading}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
