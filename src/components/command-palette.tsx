"use client";

// Cmd-K command palette stub. Phase 1 ships the shell + global keyboard hook.
// Phase 3 wires in real navigation/quick-action commands once the new sidebar nav exists.

import * as React from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Kbd } from "@/components/kbd";
import { Input } from "@/components/ui/input";
import { copy } from "@/lib/copy";

export function CommandPaletteProvider() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md rounded-2xl border-cyan/15 bg-card p-0">
        <div className="border-b border-white/5 p-3">
          <DialogTitle className="sr-only">لوحة الأوامر</DialogTitle>
          <DialogDescription className="sr-only">
            ابحث في النظام وافتح الوحدات بسرعة. اضغط Esc للإغلاق.
          </DialogDescription>
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث أو اكتب أمرًا…"
              className="h-10 border-0 bg-transparent pe-9 text-base shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-3">
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {copy.comingNext.title} — لوحة الأوامر تربط الانتقال بين الوحدات والإجراءات السريعة في المرحلة القادمة.
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/5 px-3 py-2 text-[11px] text-muted-foreground">
          <span>تنقل</span>
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span className="ms-1">للتنقل</span>
            <Kbd>↵</Kbd>
            <span className="ms-1">للفتح</span>
            <Kbd>Esc</Kbd>
            <span className="ms-1">للإغلاق</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CommandPaletteTrigger({ className }: { className?: string }) {
  const [isMac, setIsMac] = React.useState(true);
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform));
  }, []);

  const trigger = () => {
    const evt = new KeyboardEvent("keydown", {
      key: "k",
      bubbles: true,
      ctrlKey: !isMac,
      metaKey: isMac,
    });
    window.dispatchEvent(evt);
  };

  return (
    <button
      type="button"
      onClick={trigger}
      className={
        className ??
        "inline-flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
      }
    >
      <Search className="size-3.5" />
      <span>ابحث في النظام…</span>
      <span className="ms-2 flex items-center gap-1">
        <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}
