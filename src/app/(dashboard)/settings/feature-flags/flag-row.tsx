"use client";

// Client island — one row of the feature_flags admin table.
// Toggle switch + chip editor for rollout_roles. Calls server actions
// on commit.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ROLE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  toggleFeatureFlagAction,
  setFeatureFlagRolesAction,
} from "./_actions";

type Role = { key: string; name: string };

type Flag = {
  key: string;
  enabled: boolean;
  rollout_roles: string[];
  description: string | null;
  updated_at: string;
};

export function FlagRow({
  flag,
  allRoles,
}: {
  flag: Flag;
  allRoles: Role[];
}) {
  const router = useRouter();
  const t = useTranslations("FeatureFlags");
  const tA = useTranslations("Actions");
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [roles, setRoles] = useState<string[]>(flag.rollout_roles ?? []);
  const [pickerValue, setPickerValue] = useState<string>("");

  const remainingRoles = allRoles.filter((r) => !roles.includes(r.key));

  function toggleEnabled(next: boolean) {
    start(async () => {
      const res = await toggleFeatureFlagAction({ key: flag.key, enabled: next });
      if ("error" in res) {
        toast.error(`${t("toggleError")}: ${res.error}`);
        return;
      }
      toast.success(t("toggleSuccess"));
      router.refresh();
    });
  }

  function commitRoles() {
    start(async () => {
      const res = await setFeatureFlagRolesAction({
        key: flag.key,
        rolloutRoles: roles,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toggleSuccess"));
      setEditing(false);
      router.refresh();
    });
  }

  function cancelRoles() {
    setRoles(flag.rollout_roles ?? []);
    setPickerValue("");
    setEditing(false);
  }

  function addRole(key: string) {
    if (!key || roles.includes(key)) return;
    setRoles((r) => [...r, key]);
    setPickerValue("");
  }

  function removeRole(key: string) {
    setRoles((r) => r.filter((x) => x !== key));
  }

  const updatedAt = new Date(flag.updated_at);
  const updatedLabel = updatedAt.toLocaleString("ar-SA-u-ca-gregory-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="rounded-2xl border border-soft bg-card/40 p-4 sm:p-5">
      {/* Row 1 — key + toggle */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <code
              dir="ltr"
              className="rounded-md bg-soft-2 px-2 py-0.5 font-mono text-[12px]"
            >
              {flag.key}
            </code>
            <Badge
              variant={flag.enabled ? "default" : "secondary"}
              className={cn(
                "text-[10px]",
                flag.enabled
                  ? "bg-green-dim text-cc-green"
                  : "bg-soft-2 text-muted-foreground",
              )}
            >
              {flag.enabled ? t("enabled") : t("disabled")}
            </Badge>
          </div>
          {flag.description && (
            <p className="mt-1.5 text-sm text-muted-foreground">{flag.description}</p>
          )}
        </div>
        <ToggleSwitch
          checked={flag.enabled}
          disabled={pending}
          onCheckedChange={toggleEnabled}
        />
      </div>

      {/* Row 2 — rollout_roles */}
      <div className="mt-4 border-t border-soft pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("columnRoles")}
          </span>
          {(editing ? roles : flag.rollout_roles ?? []).length === 0 ? (
            <Badge variant="ghost" className="text-[10px]">
              {t("rolesAll")}
            </Badge>
          ) : (
            (editing ? roles : flag.rollout_roles).map((k) => (
              <Badge
                key={k}
                variant="secondary"
                className="gap-1 text-[10px]"
                title={k}
              >
                {ROLE_LABELS[k] ?? k}
                {editing && (
                  <button
                    type="button"
                    onClick={() => removeRole(k)}
                    aria-label={t("removeRole")}
                    className="rounded hover:bg-soft-3"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </Badge>
            ))
          )}
        </div>

        {!editing ? (
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {t("helpRoles")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={pending}
            >
              {tA("edit")}
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={pickerValue}
                onValueChange={(v) => addRole(v ?? "")}
                disabled={pending || remainingRoles.length === 0}
              >
                <SelectTrigger className="min-w-48 bg-card/50 border-soft-2 text-sm">
                  <SelectValue placeholder={t("rolesAddPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {remainingRoles.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      <span className="flex items-center gap-2">
                        <Plus className="size-3" />
                        {ROLE_LABELS[r.key] ?? r.name}
                        <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                          {r.key}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={commitRoles} disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                {t("saveRoles")}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelRoles} disabled={pending}>
                {t("cancelRoles")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Row 3 — meta */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-soft pt-2 text-[11px] text-muted-foreground">
        <span>{t("columnUpdated")}</span>
        <span dir="ltr" className="font-mono">{updatedLabel}</span>
      </div>
    </div>
  );
}

// Lightweight toggle — base-ui isn't used elsewhere for this primitive,
// so we keep it inline rather than introducing a new dep.
function ToggleSwitch({
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-[background-color,box-shadow]",
        "ring-1 ring-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-60",
        checked
          ? "justify-end bg-cc-green/80"
          : "justify-start bg-soft-3/90",
      )}
    >
      <span
        className={cn(
          "block size-5 rounded-full bg-white/95 shadow-[0_1px_3px_rgba(15,23,42,0.28)] transition-transform",
          checked ? "scale-100" : "scale-95",
        )}
      />
    </button>
  );
}
