"use client";

import { useState, useTransition } from "react";
import { Loader2, PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { intlLocale } from "@/lib/utils-format";
import { holdProjectAction, resumeProjectAction } from "./_actions";

function formatShortDate(value: string | null, locale: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(intlLocale(locale.startsWith("ar") ? "ar-SA" : "en-US"), {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function HoldDialog({
  projectId,
  status,
  heldAt,
  holdReason,
  heldBy,
}: {
  projectId: string;
  status: string;
  heldAt: string | null;
  holdReason: string | null;
  heldBy?: string | null;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("ProjectDetailPage.holdDialog");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  if (status === "on_hold") {
    return (
      <div className="flex items-center gap-2">
        {(holdReason || heldAt || heldBy) && (
          <div className="hidden sm:flex max-w-sm items-center gap-2 rounded-lg border border-amber/30 bg-amber-dim/40 px-2.5 py-1.5 text-[11px] text-amber">
            <PauseCircle className="size-3.5 shrink-0" />
            <span className="truncate" title={holdReason ?? undefined}>
              {holdReason ?? t("held")}
            </span>
            {heldBy && (
              <span className="text-muted-foreground shrink-0">
                · {t("by")} {heldBy}
              </span>
            )}
            <span className="text-muted-foreground shrink-0">
              {formatShortDate(heldAt, locale)}
            </span>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            start(async () => {
              const res = await resumeProjectAction({ projectId });
              if ("error" in res) {
                toast.error(res.error);
                return;
              }
              toast.success(t("resumeSuccess"));
              router.refresh();
            });
          }}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlayCircle className="size-4" />
          )}
          {t("resume")}
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PauseCircle className="size-4" />
        {t("pause")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="hold_reason">{t("reasonLabel")}</Label>
          <Textarea
            id="hold_reason"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            maxLength={500}
          />
          <p className="text-[11px] text-muted-foreground">
            {reason.trim().length}/500
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || reason.trim().length < 3}
            onClick={() => {
              const trimmed = reason.trim();
              start(async () => {
                const res = await holdProjectAction({
                  projectId,
                  reason: trimmed,
                });
                if ("error" in res) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("pauseSuccess"));
                setOpen(false);
                setReason("");
                router.refresh();
              });
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
