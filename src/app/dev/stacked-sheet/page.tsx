"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  StackedSheet,
  StackedSheetProvider,
} from "@/components/ui/stacked-sheet";

export default function StackedSheetSandboxPage() {
  return (
    <StackedSheetProvider>
      <Demo />
    </StackedSheetProvider>
  );
}

function Demo() {
  const [first, setFirst] = React.useState(false);
  const [second, setSecond] = React.useState(false);
  const [third, setThird] = React.useState(false);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">StackedSheet sandbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Click open, then open a nested sheet, then a third. The earlier
          sheets should settle back behind the new one.
        </p>
      </div>

      <Button onClick={() => setFirst(true)}>Open level 1</Button>

      <StackedSheet
        open={first}
        onOpenChange={setFirst}
        title="Documents"
        description="9 attachments • Tap to preview"
        heightFraction={0.9}
      >
        <div className="space-y-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSecond(true)}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-soft-1 px-3 py-3 text-start transition-colors hover:bg-muted"
            >
              <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  Brief_v{i + 1}.pdf
                </span>
                <span className="block text-xs text-muted-foreground">
                  1.{i + 2} MB · added 2 days ago
                </span>
              </span>
            </button>
          ))}
        </div>

        <StackedSheet
          open={second}
          onOpenChange={setSecond}
          title="Preview"
          description="Brief_v3.pdf"
          heightFraction={0.78}
        >
          <div className="space-y-4">
            <div className="aspect-[3/4] rounded-2xl border border-border bg-gradient-to-br from-soft-1 to-soft-2" />
            <p className="text-sm text-muted-foreground">
              This is a stub preview body. Tap the action below to push a
              third sheet on top.
            </p>
            <Button onClick={() => setThird(true)}>Open level 3 (share)</Button>
          </div>

          <StackedSheet
            open={third}
            onOpenChange={setThird}
            title="Share"
            description="Send this attachment"
            heightFraction={0.55}
          >
            <div className="space-y-2">
              {["Copy link", "Send via WhatsApp", "Send via email", "Download"].map(
                (label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setThird(false)}
                    className="block w-full rounded-xl border border-border bg-soft-1 px-4 py-3 text-start text-sm font-medium transition-colors hover:bg-muted"
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </StackedSheet>
        </StackedSheet>
      </StackedSheet>
    </div>
  );
}
