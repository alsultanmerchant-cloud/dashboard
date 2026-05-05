"use client";

// Cmd-K command palette. Two sections:
//   1. Quick create (project / handover / task template / category)
//   2. Navigate (every NAV_GROUPS item the caller can see)
// Items are filtered to the caller's permissions on the client, then
// permission-checked again server-side at the destination route.

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Kbd } from "@/components/kbd";
import { Input } from "@/components/ui/input";
import { NAV_GROUPS, type NavItem } from "@/lib/nav";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

type Command = {
  id: string;
  label: string;
  group: string;
  href: string;
  perm?: string;
  icon?: React.ComponentType<{ className?: string }>;
  keywords?: string;
  isCreate?: boolean;
};

type QuickCreateSeed = {
  id: string;
  labelKey: string;
  href: string;
  perm: string;
  keywords: string;
};

const QUICK_CREATE_SEEDS: QuickCreateSeed[] = [
  { id: "create-project", labelKey: "createProject", href: "/projects/new", perm: "projects.manage", keywords: "project new add" },
  { id: "create-handover", labelKey: "createHandover", href: "/handover", perm: "handover.create", keywords: "handover sales" },
  { id: "create-template", labelKey: "createTemplate", href: "/task-templates", perm: "templates.manage", keywords: "template task" },
  { id: "create-category", labelKey: "createCategory", href: "/service-categories", perm: "category.manage_templates", keywords: "category service" },
];

export function CommandPaletteProvider() {
  const router = useRouter();
  const { hasPermission, user } = useAuth();
  const tPalette = useTranslations("CommandPalette");
  const tNav = useTranslations("Nav");
  const tGroups = useTranslations("NavGroups");
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIdx, setActiveIdx] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const keyHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const openHandler = () => setOpen(true);
    window.addEventListener("keydown", keyHandler);
    window.addEventListener("command-palette:open", openHandler);
    return () => {
      window.removeEventListener("keydown", keyHandler);
      window.removeEventListener("command-palette:open", openHandler);
    };
  }, []);

  // Reset state on close.
  React.useEffect(() => {
    if (!open) { setQuery(""); setActiveIdx(0); }
  }, [open]);

  const allCommands = React.useMemo(() => {
    const groupName = tPalette("quickCreateGroup");
    const quickCreate: Command[] = QUICK_CREATE_SEEDS.map((s) => ({
      id: s.id,
      label: tPalette(s.labelKey),
      group: groupName,
      href: s.href,
      perm: s.perm,
      isCreate: true,
      keywords: s.keywords,
    }));
    const navCmds: Command[] = [];
    for (const g of NAV_GROUPS) {
      for (const item of g.items as NavItem[]) {
        if (item.comingSoon) continue;
        navCmds.push({
          id: `nav-${item.href}`,
          label: tNav(item.labelKey),
          group: tGroups(g.labelKey),
          href: item.href,
          perm: item.perm,
          icon: item.icon,
        });
      }
    }
    const allowed = (c: Command) => !c.perm || (user?.isOwner ?? false) || hasPermission(c.perm);
    return [...quickCreate, ...navCmds].filter(allowed);
  }, [user, hasPermission, tPalette, tNav, tGroups]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return allCommands;
    const q = query.toLowerCase();
    return allCommands.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      (c.keywords ?? "").toLowerCase().includes(q),
    );
  }, [allCommands, query]);

  // Group for display.
  const groups = React.useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of filtered) {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // Flat list for keyboard nav (matches visual order).
  const flat = React.useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  React.useEffect(() => { setActiveIdx(0); }, [query]);

  const run = (cmd: Command) => {
    setOpen(false);
    router.push(cmd.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = flat[activeIdx];
      if (cmd) run(cmd);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md rounded-2xl border-cyan/15 bg-card p-0">
        <div className="border-b border-soft p-3">
          <DialogTitle className="sr-only">{tPalette("title")}</DialogTitle>
          <DialogDescription className="sr-only">{tPalette("description")}</DialogDescription>
          <div className="relative">
            <Search className="pointer-events-none absolute rtl:right-3 ltr:left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={tPalette("placeholder")}
              className="h-10 border-0 bg-transparent rtl:pe-9 ltr:ps-9 text-base shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {tPalette("noResults")}
            </p>
          ) : (
            groups.map(([groupLabel, items]) => (
              <div key={groupLabel} className="mb-2 last:mb-0">
                <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {groupLabel}
                </p>
                <ul>
                  {items.map((c) => {
                    const flatIdx = flat.indexOf(c);
                    const active = flatIdx === activeIdx;
                    const Icon = c.icon ?? (c.isCreate ? Plus : Search);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => run(c)}
                          onMouseEnter={() => setActiveIdx(flatIdx)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-sm text-start transition-colors",
                            active ? "bg-primary/10 text-foreground" : "text-foreground/90 hover:bg-soft-2",
                          )}
                        >
                          <span className={cn(
                            "flex size-7 items-center justify-center rounded-lg",
                            c.isCreate ? "bg-primary/15 text-primary" : "bg-soft-2 text-muted-foreground",
                          )}>
                            <Icon className="size-3.5" />
                          </span>
                          <span className="flex-1 truncate">{c.label}</span>
                          {active && (
                            <Kbd>↵</Kbd>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-soft px-3 py-2 text-[11px] text-muted-foreground">
          <span>{tPalette("results", { count: flat.length })}</span>
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span className="ms-1">{tPalette("navigate")}</span>
            <Kbd>↵</Kbd>
            <span className="ms-1">{tPalette("open")}</span>
            <Kbd>Esc</Kbd>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CommandPaletteTrigger({ className }: { className?: string }) {
  const t = useTranslations("Topbar");
  const [isMac, setIsMac] = React.useState(true);
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform));
  }, []);

  const trigger = () => {
    window.dispatchEvent(new Event("command-palette:open"));
  };

  return (
    <button
      type="button"
      onClick={trigger}
      className={
        className ??
        "inline-flex items-center gap-2 rounded-xl border border-soft bg-soft-1 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-soft-2 hover:text-foreground"
      }
    >
      <Search className="size-3.5" />
      <span>{t("search")}</span>
      <span className="ms-2 flex items-center gap-1">
        <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

/**
 * Visible "+New" trigger in the topbar that opens the palette pre-filtered
 * to quick-create actions (we just open the palette with no query — the
 * Quick Create group renders first by ordering).
 */
export function QuickCreateTrigger({ className }: { className?: string }) {
  const t = useTranslations("Topbar");
  const trigger = () => {
    window.dispatchEvent(new Event("command-palette:open"));
  };
  return (
    <button
      type="button"
      onClick={trigger}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-xl border border-cyan/30 bg-cyan/10 px-3 py-1.5 text-xs font-medium text-cyan transition-colors hover:bg-cyan/15"
      }
      aria-label={t("createAria")}
      title={t("createTooltip")}
    >
      <Plus className="size-3.5" />
      <span>{t("create")}</span>
    </button>
  );
}
