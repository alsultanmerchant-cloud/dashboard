"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { X, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { NAV_GROUPS, type NavItem } from "@/lib/nav";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, signOut, orgs, hasPermission } = useAuth();
  const tApp = useTranslations("App");
  const tCommon = useTranslations("Common");
  const tNav = useTranslations("Nav");
  const tGroups = useTranslations("NavGroups");
  const expanded = !!open;
  const [desktopHovered, setDesktopHovered] = useState(false);
  const desktopExpanded = expanded || desktopHovered;

  const collapseSidebar = () => {
    onClose?.();
  };

  const isItemVisible = (item: NavItem) => {
    if (!user) return !item.perm;
    if (user.isOwner) return true;
    if (!item.perm) return true;
    return hasPermission(item.perm);
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const activeOrg = orgs[0];

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        onMouseEnter={() => setDesktopHovered(true)}
        onMouseLeave={() => setDesktopHovered(false)}
        data-expanded={expanded}
        className={cn(
          "fixed top-3 bottom-3 z-50 overflow-hidden rounded-[28px] flex flex-col transition-[width,transform,padding,background-color,border-color,box-shadow] duration-300 ease-in-out",
          "bg-sidebar text-sidebar-foreground border border-sidebar-border shadow-[var(--surface-elev)]",
          "w-[252px]",
          // RTL pins to the right edge; LTR to the left.
          "rtl:right-4 lg:rtl:right-6 ltr:left-4 lg:ltr:left-6",
          open
            ? "translate-x-0"
            : "rtl:translate-x-[268px] ltr:-translate-x-[268px] lg:rtl:translate-x-0 lg:ltr:translate-x-0",
          desktopExpanded ? "lg:w-[252px]" : "lg:w-[72px]",
          !expanded &&
            (desktopHovered
              ? "lg:top-3 lg:bottom-3 lg:h-auto lg:rounded-[28px] lg:border-sidebar-border lg:bg-sidebar lg:shadow-[var(--surface-elev)]"
              : "lg:top-3 lg:bottom-auto lg:h-[60px] lg:rounded-[24px] lg:border-transparent lg:bg-transparent lg:shadow-none"),
          expanded && "lg:!w-[252px]",
        )}
      >
        {/* Logo + org */}
        <div className={cn("px-2.5 lg:px-3 pt-4 pb-3 border-b border-sidebar-border", !expanded && "lg:px-2")}>
          <div className={cn("flex items-start gap-3", !expanded && "lg:justify-center lg:gap-0")}>
            <div
              className={cn(
                "flex-1 min-w-0 transition-opacity duration-200",
                desktopExpanded
                  ? "lg:opacity-100 lg:pointer-events-auto"
                  : "lg:opacity-0 lg:pointer-events-none",
              )}
            >
            </div>
            <button
              onClick={collapseSidebar}
              aria-label={tCommon("closeMenu")}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-xl bg-sidebar-accent hover:bg-sidebar-accent/80 text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {activeOrg && (
            <div
              className={cn(
                "mt-3 flex items-center gap-2.5 rounded-xl bg-sidebar-accent border border-sidebar-border px-3 py-2 transition-opacity duration-200",
                desktopExpanded
                  ? "lg:opacity-100 lg:pointer-events-auto"
                  : "lg:opacity-0 lg:pointer-events-none",
              )}
            >
                <img
                src="https://skylightad.com/wp-content/uploads/elementor/thumbs/logo-1080-qz82xj5nel49tz0etciq6bxtjqy8yu6tnelutr5wx4.png"
                alt="Sky Light"
                className="size-8 object-contain rounded-lg p-1"
                />
              <div className="flex-1 text-start min-w-0">
                <p className="text-xs font-semibold text-sidebar-foreground truncate">{activeOrg.nameAr}</p>
                <p className="text-[10px] text-sidebar-foreground/65">{tApp("demoOrg")}</p>
              </div>
              <span className="size-1.5 rounded-full bg-cc-green animate-pulse" aria-hidden />
            </div>
          )}
        </div>

        {/* Grouped nav */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden px-2 lg:px-2 pt-3 pb-2 space-y-3 scrollbar-hide",
            "transition-opacity duration-200",
            desktopExpanded
              ? "lg:opacity-100 lg:pointer-events-auto"
              : "lg:opacity-0 lg:pointer-events-none",
          )}
        >
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter(isItemVisible);
            if (visibleItems.length === 0) return null;
            const groupLabel = tGroups(group.labelKey);
            return (
              <div key={group.labelKey}>
                <div
                  className={cn(
                    "px-3 pb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/55 transition-opacity duration-200",
                    desktopExpanded ? "lg:opacity-100" : "lg:opacity-0",
                  )}
                >
                  {groupLabel}
                </div>
                <ul className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    const itemLabel = tNav(item.labelKey);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={collapseSidebar}
                          title={itemLabel}
                          className={cn(
                            "group relative flex items-center gap-3 overflow-hidden rounded-xl px-2 py-2 text-[13px] transition-all duration-200",
                            active
                              ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold shadow-[0_4px_14px_rgba(0,0,0,0.18)]"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                          )}
                        >
                          {active && (
                            <span className="absolute inset-y-1.5 rtl:right-0 ltr:left-0 w-[3px] rounded-full bg-sidebar-primary-foreground/80" />
                          )}
                          <span
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 shrink-0",
                              active
                                ? "bg-sidebar-primary-foreground/15 text-sidebar-primary-foreground"
                                : "bg-sidebar-accent text-sidebar-foreground/85 group-hover:text-sidebar-foreground",
                            )}
                          >
                            <Icon className="w-[15px] h-[15px]" />
                          </span>
                          <span
                            className={cn(
                              "flex-1 truncate transition-opacity duration-200 whitespace-nowrap",
                              desktopExpanded ? "lg:opacity-100" : "lg:opacity-0",
                            )}
                          >
                            {itemLabel}
                          </span>
                          {item.comingSoon && (
                            <span
                              className={cn(
                                "rounded-full bg-amber-dim px-1.5 py-0.5 text-[9px] font-medium text-amber tracking-tight transition-opacity duration-200",
                                desktopExpanded ? "lg:opacity-100" : "lg:opacity-0",
                              )}
                            >
                              {tCommon("comingSoon")}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div
          className={cn(
            "m-2 lg:m-2 mt-0 rounded-2xl border border-sidebar-border bg-sidebar-accent p-2.5 transition-all duration-200",
            !expanded && "lg:border-transparent lg:bg-transparent lg:p-0",
            desktopExpanded
              ? "lg:opacity-100 lg:pointer-events-auto"
              : "lg:opacity-0 lg:pointer-events-none",
          )}
        >
          <div
            className={cn(
              "mb-2.5 flex items-center justify-between gap-2 text-[10px] transition-opacity duration-200",
              desktopExpanded ? "lg:opacity-100" : "lg:opacity-0",
            )}
          >
            <span className="text-sidebar-foreground/65">{tApp("operationalStatus")}</span>
            <div className="flex items-center gap-1.5">
              <LanguageSwitcher showLabel />
              <span className="rounded-full bg-green-dim px-2 py-0.5 text-cc-green">{tApp("live")}</span>
            </div>
          </div>
          <div className={cn("flex items-center gap-2", !expanded && "lg:justify-center lg:gap-0")}>
            <div
              className={cn(
                "flex items-center justify-center overflow-hidden shrink-0 transition-all duration-200",
                !expanded
                  ? "lg:h-11 lg:w-11 lg:rounded-2xl lg:bg-sidebar-primary/15 lg:ring-1 lg:ring-sidebar-border"
                  : "h-9 w-9 rounded-xl bg-sidebar-primary/20 text-sidebar-primary ring-1 ring-sidebar-border",
              )}
            >
              <Avatar
                size="default"
                className={cn(
                  "size-full",
                  !expanded && "lg:rounded-2xl lg:after:hidden",
                )}
              >
                {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
                <AvatarFallback
                  className={cn(
                    "bg-transparent font-bold",
                    expanded ? "text-xs text-sidebar-primary" : "lg:text-sm lg:tracking-[0.2em] lg:text-sidebar-primary",
                  )}
                >
                  {user?.name?.[0] || "م"}
                </AvatarFallback>
              </Avatar>
            </div>
            <div
              className={cn(
                "flex-1 min-w-0 transition-all duration-200",
                desktopExpanded
                  ? "lg:opacity-100 lg:w-auto lg:overflow-visible"
                  : "lg:w-0 lg:min-w-0 lg:overflow-hidden lg:opacity-0",
              )}
            >
              <p className="text-[13px] font-semibold text-sidebar-foreground truncate whitespace-nowrap">{user?.name || "..."}</p>
              <p className="text-[10px] text-sidebar-foreground/65 truncate whitespace-nowrap">{user?.roleName || ""}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                signOut();
              }}
              aria-label={tCommon("signOut")}
              title={tCommon("signOut")}
              className={cn(
                "flex items-center justify-center w-7 h-7 rounded-lg bg-sidebar-accent hover:bg-cc-red/15 text-sidebar-foreground/75 hover:text-cc-red transition-all duration-200 shrink-0",
                "lg:w-0 lg:opacity-0 lg:overflow-hidden lg:pointer-events-none lg:group-hover/sidebar:w-7 lg:group-hover/sidebar:opacity-100 lg:group-hover/sidebar:pointer-events-auto",
                expanded && "lg:opacity-100 lg:w-7 lg:pointer-events-auto",
              )}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
