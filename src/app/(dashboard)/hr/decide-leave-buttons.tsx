"use client";

import { useTransition } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { decideLeaveAction } from "./_actions";

export function DecideLeaveButtons({ leaveId }: { leaveId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function decide(decision: "approved" | "rejected") {
    startTransition(async () => {
      const r = await decideLeaveAction(leaveId, decision);
      if (r.ok) {
        toast.success(decision === "approved" ? "تمت الموافقة" : "تم الرفض");
        router.refresh();
      } else {
        toast.error(r.error ?? "فشلت العملية");
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs gap-1 border-cc-green/40 text-cc-green hover:bg-green-dim"
        onClick={() => decide("approved")}
        disabled={pending}
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        موافقة
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs gap-1 border-cc-red/40 text-cc-red hover:bg-red-dim"
        onClick={() => decide("rejected")}
        disabled={pending}
      >
        <X className="size-3" />
        رفض
      </Button>
    </div>
  );
}
