"use client";

// Client island — one row of the feature_flags admin table.
// Toggle switch + chip editor for rollout_roles. Calls server actions
// on commit.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { copy } from "@/lib/copy";
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
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [roles, setRoles] = useState<string[]>(flag.rollout_roles ?? []);
  const [pickerValue, setPickerValue] = useState<string>("");

  const remainingRoles = allRoles.filter((r) => !roles.includes(r.key));

  function toggleEnabled(next: boolean) {
    start(async () => {
      const res = await toggleFeatureFlagAction({ key: flag.key, enabled: next });
      if ("error" in res) {
        toast.error(`${copy.featureFlags.toggleError}: ${res.error}`);
        return;
      }
      toast.success(copy.featureFlags.toggleSuccess);
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
      toast.success(copy.featureFlags.toggleSuccess);
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
  const updatedLabel = updatedAt.toLocaleString("ar-SA-u-ca-gregory", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card/40 p-4 sm:p-5">
      {/* Row 1 — key + toggle */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <code
              dir="ltr"
              className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[12px]"
            >
              {flag.key}
            </code>
            <Badge
              variant={flag.enabled ? "default" : "secondary"}
              className={cn(
                "text-[10px]",
                flag.enabled
                  ? "bg-green-dim text-cc-green"
                  : "bg-white/[0.04] text-muted-foreground",
              )}
            >
              {flag.enabled ? copy.featureFlags.enabled : copy.featureFlags.disabled}
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
      <div className="mt-4 border-t border-white/[0.04] pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {copy.featureFlags.columnRoles}
          </span>
          {(editing ? roles : flag.rollout_roles ?? []).length === 0 ? (
            <Badge variant="ghost" className="text-[10px]">
              {copy.featureFlags.rolesAll}
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
                    aria-label="إزالة"
                    className="rounded hover:bg-white/[0.08]"
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
              {copy.featureFlags.helpRoles}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={pending}
            >
              {copy.actions.edit}
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
                <SelectTrigger className="min-w-48 bg-card/50 border-white/10 text-sm">
                  <SelectValue placeholder={copy.featureFlags.rolesAddPlaceholder} />
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
                {copy.featureFlags.saveRoles}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelRoles} disabled={pending}>
                {copy.featureFlags.cancelRoles}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Row 3 — meta */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/[0.04] pt-2 text-[11px] text-muted-foreground">
        <span>{copy.featureFlags.columnUpdated}</span>
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
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        "ring-1 ring-white/10 disabled:opacity-60",
        checked ? "bg-cc-green/70" : "bg-white/[0.08]",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow transition-transform",
          // RTL: knob slides left when on, right when off (visual ON to the right
          // would feel inverted in Arabic — matching native checkboxes).
          checked ? "-translate-x-[22px]" : "-translate-x-0.5",
        )}
      />
    </button>
  );
}
