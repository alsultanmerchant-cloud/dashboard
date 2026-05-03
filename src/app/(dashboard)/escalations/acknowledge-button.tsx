"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { acknowledgeEscalationAction } from "./_actions";

export function AcknowledgeButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await acknowledgeEscalationAction({ id });
        })
      }
    >
      {pending ? "جارٍ الإقرار…" : "إقرار"}
    </Button>
  );
}
