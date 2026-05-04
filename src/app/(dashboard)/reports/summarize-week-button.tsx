"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { summarizeWeekAction } from "./_actions";

export function SummarizeWeekButton() {
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const r = await summarizeWeekAction();
      if (r.ok) setSummary(r.summary);
      else setError(r.error || "تعذّر إصدار الموجز.");
    });
  }

  return (
    <div className="flex flex-col items-end gap-2 max-w-full">
      <Button onClick={onClick} disabled={pending} variant="default" className="gap-2">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        اختصر لي تقرير الأسبوع
      </Button>
      {summary && (
        <div className="rounded-xl border border-cyan/30 bg-cyan-dim/15 p-3.5 text-sm leading-relaxed w-full whitespace-pre-line">
          {summary}
        </div>
      )}
      {error && (
        <p className="text-xs text-cc-red">{error}</p>
      )}
    </div>
  );
}
