"use client";

// Rwasem / Odoo-style module sub-nav. Each Odoo "app" exposes a row of
// horizontal tabs under the purple header (Projects · Tasks · Project
// Category · Reporting). We mirror that for the modules we already have
// routes for.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutGrid, List as ListIcon, CalendarDays, Loader2, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTopbarControls } from "@/components/layout/topbar-context";

type Tab = {
  labelKey: string;
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
    // Task templates is our extension and lives after the core project
    // navigation items.
    tabs: [
      { labelKey: "projects", href: "/projects", match: /^\/projects(?!\/odoo|\/new)/ },
      { labelKey: "tasks", href: "/tasks", match: /^\/tasks/ },
      { labelKey: "projectCategory", href: "/service-categories", match: /^\/service-categories/ },
      { labelKey: "reporting", href: "/reports", match: /^\/reports/ },
      { labelKey: "taskTemplates", href: "/task-templates", match: /^\/task-templates/ },
    ],
  },
  {
    name: "HR",
    prefixes: /^\/(hr|organization)/,
    tabs: [
      { labelKey: "employees", href: "/organization/employees", match: /^\/organization\/employees/ },
      { labelKey: "departments", href: "/organization/departments", match: /^\/organization\/departments/ },
      { labelKey: "rolesPermissions", href: "/organization/roles", match: /^\/organization\/roles/ },
      { labelKey: "agencyChart", href: "/organization/chart", match: /^\/organization\/chart/ },
      { labelKey: "hr", href: "/hr", match: /^\/hr$/ },
    ],
  },
  {
    name: "Sales",
    prefixes: /^\/(sales|handover|clients|contracts)/,
    tabs: [
      { labelKey: "clients", href: "/clients", match: /^\/clients/ },
      { labelKey: "salesHandover", href: "/handover", match: /^\/handover/ },
      { labelKey: "contracts", href: "/contracts", match: /^\/contracts/ },
      { labelKey: "salesTeam", href: "/sales/team", match: /^\/sales\/team/ },
      { labelKey: "leads", href: "/sales/leads", match: /^\/sales\/leads/ },
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
  const t = useTranslations("ModuleTabs");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { moduleTabsMeta } = useTopbarControls();
  const mod = MODULES.find((m) => m.prefixes.test(pathname));
  if (!mod) return null;
  const isProjectsIndex = /^\/projects$/.test(pathname);
  const isTasksIndex = /^\/tasks\/?$/.test(pathname);
  const projectView = ((): "kanban" | "list" | "calendar" => {
    const v = searchParams.get("view");
    if (v === "list") return "list";
    if (v === "calendar") return "calendar";
    return "kanban";
  })();
  const isProjectsNew = /^\/projects\/new$/.test(pathname);
  const tasksView = ((): "kanban" | "list" | "calendar" | "pivot" => {
    const v = searchParams.get("view");
    if (v === "kanban" || v === "calendar" || v === "pivot") return v;
    return "list";
  })();
  // Odoo's Tasks menu opens to a "My Tasks / All Tasks" split. When we're
  // already on /tasks, swap the redundant Tasks tab for the same split so a
  // click does something useful.
  const tasksFilterKeys = (searchParams.get("f") ?? searchParams.get("filter") ?? "").split(",").filter(Boolean);
  const isMyTasks = tasksFilterKeys.includes("mine");

  function tasksHrefFor(scope: "mine" | "all"): string {
    const next = new URLSearchParams(searchParams.toString());
    const current = (next.get("f") ?? "").split(",").filter((k) => k && k !== "mine");
    if (scope === "mine") current.push("mine");
    if (current.length === 0) next.delete("f");
    else next.set("f", current.join(","));
    next.delete("filter");
    const query = next.toString();
    return query ? `/tasks?${query}` : "/tasks";
  }

  function setProjectView(nextView: "kanban" | "list" | "calendar") {
    const next = new URLSearchParams(searchParams.toString());
    if (nextView === "kanban") next.delete("view");
    else next.set("view", nextView);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function setTasksView(nextView: "kanban" | "list" | "calendar" | "pivot") {
    const next = new URLSearchParams(searchParams.toString());
    if (nextView === "list") next.delete("view");
    else next.set("view", nextView);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <nav
      aria-label={mod.name}
      className="sticky top-[88px] z-30 mx-3 mt-2 sm:mx-6"
    >
      <div className="flex items-center gap-2 rounded-2xl border border-border/90 bg-card/95 px-2 py-2 shadow-[var(--surface-elev)] backdrop-blur rtl:flex-row-reverse supports-[backdrop-filter]:bg-card/88">
        <div className="hidden shrink-0 rounded-xl bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground lg:inline-flex">
          {mod.name}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rtl:flex-row-reverse [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {mod.tabs.map((tab) => {
            const active = isActive(pathname, tab);
            const baseCls =
              "shrink-0 rounded-xl px-3.5 py-2 text-[12px] font-semibold transition-all";
            // §NAV-5 — swap the redundant Tasks tab for a My/All split
            // when the user is already on /tasks. Detail pages
            // (/tasks/<id>) still get the normal link so they can return
            // to the list.
            if (tab.labelKey === "tasks" && isTasksIndex) {
              return (
                <div
                  key={tab.labelKey}
                  className="flex shrink-0 overflow-hidden rounded-xl border border-border bg-muted/50 p-0.5 shadow-sm"
                  role="group"
                  aria-label={t("tasks")}
                >
                  <Link
                    href={tasksHrefFor("mine")}
                    className={cn(
                      "rounded-[0.65rem] px-3 py-1.5 text-[12px] font-semibold transition-all",
                      isMyTasks
                        ? "bg-card text-primary shadow-sm"
                        : "text-muted-foreground hover:bg-background hover:text-foreground",
                    )}
                  >
                    {t("myTasks")}
                  </Link>
                  <Link
                    href={tasksHrefFor("all")}
                    className={cn(
                      "px-3 py-1.5 text-[12px] font-semibold transition-all",
                      !isMyTasks
                        ? "bg-card text-primary shadow-sm"
                        : "text-muted-foreground hover:bg-background hover:text-foreground",
                    )}
                  >
                    {t("allTasks")}
                  </Link>
                </div>
              );
            }
            if (tab.labelKey === "projects" && pathname.startsWith("/projects")) {
              return (
                <div
                  key={tab.labelKey}
                  className="flex shrink-0 overflow-hidden rounded-xl border border-border bg-muted/50 p-0.5 shadow-sm"
                  role="group"
                  aria-label={t("projects")}
                >
                  <Link
                    href="/projects"
                    className={cn(
                      "rounded-[0.65rem] px-3 py-1.5 text-[12px] font-semibold transition-all",
                      isProjectsIndex
                        ? "bg-card text-primary shadow-sm"
                        : "text-muted-foreground hover:bg-background hover:text-foreground",
                    )}
                  >
                    {t("projects")}
                  </Link>
                  <Link
                    href="/projects/new"
                    className={cn(
                      "px-3 py-1.5 text-[12px] font-semibold transition-all",
                      isProjectsNew
                        ? "bg-card text-primary shadow-sm"
                        : "text-muted-foreground hover:bg-background hover:text-foreground",
                    )}
                  >
                    {t("newProject")}
                  </Link>
                </div>
              );
            }
            if (tab.comingSoon || !tab.href) {
              return (
                <span
                  key={tab.labelKey}
                  title={t("soon")}
                  className={cn(
                    baseCls,
                    "cursor-not-allowed border border-transparent text-muted-foreground/60",
                  )}
                >
                  {t(tab.labelKey)}
                </span>
              );
            }
            return (
              <Link
                key={tab.labelKey}
                href={tab.href}
                className={cn(
                  baseCls,
                  active
                    ? "bg-accent text-primary shadow-sm ring-1 ring-primary/12"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </div>
        {isProjectsIndex && (
          <div className="ms-auto flex shrink-0 items-center gap-2 ps-2 sm:border-s sm:border-border/80">
            {moduleTabsMeta?.trailingText ? (
              <span
                className="inline-flex h-9 items-center rounded-xl border border-border bg-muted/70 px-3 text-[12px] font-semibold tabular-nums text-muted-foreground"
                dir="ltr"
              >
                {moduleTabsMeta.trailingText}
              </span>
            ) : null}
            {moduleTabsMeta?.isBusy ? (
              <span className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-muted/70">
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              </span>
            ) : null}
            <div className="flex overflow-hidden rounded-xl border border-border bg-muted/60 p-0.5 shadow-sm">
              <button
                type="button"
                aria-label={t("kanbanView")}
                onClick={() => setProjectView("kanban")}
                className={cn(
                  "grid size-8 place-items-center rounded-[0.65rem] text-muted-foreground transition-all hover:bg-background hover:text-foreground",
                  projectView === "kanban" && "bg-card text-brand-indigo shadow-sm",
                )}
                title={t("kanban")}
              >
                <LayoutGrid className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("listView")}
                onClick={() => setProjectView("list")}
                className={cn(
                  "grid size-8 place-items-center rounded-[0.65rem] text-muted-foreground transition-all hover:bg-background hover:text-foreground",
                  projectView === "list" && "bg-card text-brand-indigo shadow-sm",
                )}
                title={t("list")}
              >
                <ListIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("calendarView") /* falls back to key if missing */}
                onClick={() => setProjectView("calendar")}
                className={cn(
                  "grid size-8 place-items-center rounded-[0.65rem] text-muted-foreground transition-all hover:bg-background hover:text-foreground",
                  projectView === "calendar" && "bg-card text-brand-indigo shadow-sm",
                )}
                title={t("calendar")}
              >
                <CalendarDays className="size-3.5" />
              </button>
            </div>
          </div>
        )}
        {isTasksIndex && (
          <div className="ms-auto flex shrink-0 items-center gap-2 ps-2 sm:border-s sm:border-border/80">
            {moduleTabsMeta?.trailingText ? (
              <span
                className="inline-flex h-9 items-center rounded-xl border border-border bg-muted/70 px-3 text-[12px] font-semibold tabular-nums text-muted-foreground"
              >
                {moduleTabsMeta.trailingText}
              </span>
            ) : null}
            {moduleTabsMeta?.pills?.map((pill) =>
              pill.href ? (
                <Link
                  key={`${pill.label}-${pill.href}`}
                  href={pill.href}
                  title={pill.title}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold transition-colors",
                    pill.active
                      ? "border-cyan/40 bg-cyan-dim text-cyan"
                      : "border-border bg-muted/70 text-muted-foreground hover:bg-background hover:text-foreground",
                  )}
                >
                  <span>{pill.label}</span>
                  {pill.count !== null && pill.count !== undefined ? (
                    <span className="rounded-full bg-soft-2/60 px-1.5 text-[10px] tabular-nums">
                      {pill.count}
                    </span>
                  ) : null}
                </Link>
              ) : (
                <span
                  key={pill.label}
                  title={pill.title}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold",
                    pill.active
                      ? "border-cyan/40 bg-cyan-dim text-cyan"
                      : "border-border bg-muted/70 text-muted-foreground",
                  )}
                >
                  <span>{pill.label}</span>
                  {pill.count !== null && pill.count !== undefined ? (
                    <span className="rounded-full bg-soft-2/60 px-1.5 text-[10px] tabular-nums">
                      {pill.count}
                    </span>
                  ) : null}
                </span>
              ),
            )}
            <div className="flex overflow-hidden rounded-xl border border-border bg-muted/60 p-0.5 shadow-sm">
              <button
                type="button"
                aria-label={t("kanbanView")}
                onClick={() => setTasksView("kanban")}
                className={cn(
                  "grid size-8 place-items-center rounded-[0.65rem] text-muted-foreground transition-all hover:bg-background hover:text-foreground",
                  tasksView === "kanban" && "bg-card text-primary shadow-sm",
                )}
                title={t("kanban")}
              >
                <LayoutGrid className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("listView")}
                onClick={() => setTasksView("list")}
                className={cn(
                  "grid size-8 place-items-center rounded-[0.65rem] text-muted-foreground transition-all hover:bg-background hover:text-foreground",
                  tasksView === "list" && "bg-card text-primary shadow-sm",
                )}
                title={t("list")}
              >
                <ListIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("calendarView")}
                onClick={() => setTasksView("calendar")}
                className={cn(
                  "grid size-8 place-items-center rounded-[0.65rem] text-muted-foreground transition-all hover:bg-background hover:text-foreground",
                  tasksView === "calendar" && "bg-card text-primary shadow-sm",
                )}
                title={t("calendar")}
              >
                <CalendarDays className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("pivot")}
                onClick={() => setTasksView("pivot")}
                className={cn(
                  "grid size-8 place-items-center rounded-[0.65rem] text-muted-foreground transition-all hover:bg-background hover:text-foreground",
                  tasksView === "pivot" && "bg-card text-primary shadow-sm",
                )}
                title={t("pivot")}
              >
                <Table2 className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
