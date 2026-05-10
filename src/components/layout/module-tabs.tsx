"use client";

// Rwasem / Odoo-style module sub-nav. Each Odoo "app" exposes a row of
// horizontal tabs under the purple header (Projects · Tasks · Project
// Category · Reporting · Configuration · Import). We mirror that for the
// modules we already have routes for; the rest stay disabled with a
// "soon" tooltip so the chrome looks complete.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List as ListIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTopbarControls } from "@/components/layout/topbar-context";

type Tab = {
  label: string;
  href?: string;
  /** Active when pathname starts with this. Falls back to href when omitted. */
  match?: string | RegExp;
  /** When true the tab renders dim and unclickable (placeholder for a
   *  Rwasem section we haven't built yet). */
  comingSoon?: boolean;
};

type Module = {
  /** Pathname prefix(es) that activate this module's tab row. */
  prefixes: RegExp;
  /** Visible label for breadcrumb / aria — not rendered separately today. */
  name: string;
  tabs: Tab[];
};

// Each module's tab list mirrors the Odoo Project app menu.
const MODULES: Module[] = [
  {
    name: "Project",
    prefixes: /^\/(projects|tasks|task-templates|service-categories|reports)/,
    tabs: [
      { label: "المشاريع", href: "/projects", match: /^\/projects(?!\/odoo|\/new)/ },
      // The new-project wizard lives under /projects/new but is conceptually
      // the same "Projects" page from Odoo's tab perspective.
      { label: "المهام", href: "/tasks", match: /^\/tasks/ },
      { label: "تصنيفات الخدمات", href: "/service-categories", match: /^\/service-categories/ },
      { label: "قوالب المهام", href: "/task-templates", match: /^\/task-templates/ },
      { label: "التقارير", href: "/reports", match: /^\/reports/ },
      { label: "استيراد", comingSoon: true },
    ],
  },
  {
    name: "HR",
    prefixes: /^\/(hr|organization)/,
    tabs: [
      { label: "الموظفون", href: "/organization/employees", match: /^\/organization\/employees/ },
      { label: "الأقسام", href: "/organization/departments", match: /^\/organization\/departments/ },
      { label: "الأدوار والصلاحيات", href: "/organization/roles", match: /^\/organization\/roles/ },
      { label: "هيكل الوكالة", href: "/organization/chart", match: /^\/organization\/chart/ },
      { label: "الموارد البشرية", href: "/hr", match: /^\/hr$/ },
    ],
  },
  {
    name: "Sales",
    prefixes: /^\/(sales|handover|clients|contracts)/,
    tabs: [
      { label: "العملاء", href: "/clients", match: /^\/clients/ },
      { label: "تسليمات المبيعات", href: "/handover", match: /^\/handover/ },
      { label: "العقود", href: "/contracts", match: /^\/contracts/ },
      { label: "فريق المبيعات", href: "/sales/team", match: /^\/sales\/team/ },
      { label: "الفرص", href: "/sales/leads", match: /^\/sales\/leads/ },
    ],
  },
];

function isActive(pathname: string, tab: Tab): boolean {
  if (tab.comingSoon || !tab.href) return false;
  const m = tab.match ?? tab.href;
  if (typeof m === "string") return pathname === m || pathname.startsWith(`${m}/`);
  return m.test(pathname);
}

export function ModuleTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { moduleTabsMeta } = useTopbarControls();
  const mod = MODULES.find((m) => m.prefixes.test(pathname));
  if (!mod) return null;
  const isProjectsIndex = /^\/projects$/.test(pathname);
  const projectView = searchParams.get("view") === "list" ? "list" : "kanban";

  function setProjectView(nextView: "kanban" | "list") {
    const next = new URLSearchParams(searchParams.toString());
    if (nextView === "kanban") next.delete("view");
    else next.set("view", nextView);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <nav
      aria-label={mod.name}
      className="sticky top-[88px] z-30 mx-3 mt-2 sm:mx-6"
    >
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/95 px-1.5 py-1 shadow-sm backdrop-blur rtl:flex-row-reverse supports-[backdrop-filter]:bg-card/85">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rtl:flex-row-reverse">
          {mod.tabs.map((tab) => {
            const active = isActive(pathname, tab);
            const baseCls =
              "shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors";
            if (tab.comingSoon || !tab.href) {
              return (
                <span
                  key={tab.label}
                  title="قريباً"
                  className={cn(
                    baseCls,
                    "text-muted-foreground/60 cursor-not-allowed",
                  )}
                >
                  {tab.label}
                </span>
              );
            }
            return (
              <Link
                key={tab.label}
                href={tab.href}
                className={cn(
                  baseCls,
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
        {isProjectsIndex && (
          <div className="ms-auto flex shrink-0 items-center gap-2">
            {moduleTabsMeta?.trailingText ? (
              <span className="text-[12px] tabular-nums text-muted-foreground" dir="ltr">
                {moduleTabsMeta.trailingText}
              </span>
            ) : null}
            {moduleTabsMeta?.isBusy ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
            <div className="flex overflow-hidden rounded-md border border-border">
              <button
                type="button"
                aria-label="عرض كانبان"
                onClick={() => setProjectView("kanban")}
                className={cn(
                  "grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-muted",
                  projectView === "kanban" && "bg-primary/15 text-primary hover:bg-primary/20",
                )}
                title="Kanban"
              >
                <LayoutGrid className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="عرض قائمة"
                onClick={() => setProjectView("list")}
                className={cn(
                  "grid size-8 place-items-center border-s border-border text-muted-foreground transition-colors hover:bg-muted",
                  projectView === "list" && "bg-primary/15 text-primary hover:bg-primary/20",
                )}
                title="List"
              >
                <ListIcon className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
