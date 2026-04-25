"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { NAV_GROUPS, type NavItem } from "@/lib/nav";

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, signOut, orgs, hasPermission } = useAuth();

  const isItemVisible = (item: NavItem) => {
    if (!user) return false;
    if (user.isOwner) return true;
    if (!item.perm) return true; // public-to-org item
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
        className={cn(
          "fixed top-3 right-3 bottom-3 z-50 w-[252px] overflow-hidden rounded-[28px] glass-surface border-l-0 flex flex-col transition-transform duration-300 ease-in-out",
          "lg:translate-x-0",
          open ? "translate-x-0" : "translate-x-[268px] lg:translate-x-0",
        )}
      >
        {/* Logo + org */}
        <div className="px-5 pt-5 pb-4 border-b border-white/6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-linear-to-br from-cyan/30 to-cc-purple/30 ring-1 ring-white/10 shrink-0">
              <span className="text-sm font-extrabold tracking-[0.2em] text-cyan">CC</span>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-[1.05rem] font-extrabold text-foreground">
                مركز قيادة الوكالة
              </h1>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Agency Command Center
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="إغلاق القائمة"
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {activeOrg && (
            <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-white/[0.04] border border-white/6 px-3 py-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-dim flex items-center justify-center text-cyan text-xs font-bold ring-1 ring-cyan/20 shrink-0">
                {activeOrg.nameAr?.[0] || "م"}
              </div>
              <div className="flex-1 text-right min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{activeOrg.nameAr}</p>
                <p className="text-[10px] text-muted-foreground">العرض التجريبي</p>
              </div>
              <span className="size-1.5 rounded-full bg-cc-green animate-pulse" aria-hidden />
            </div>
          )}
        </div>

        {/* Grouped nav */}
        <nav className="flex-1 overflow-y-auto px-2.5 pt-3 pb-2 space-y-4">
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter(isItemVisible);
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className={cn(
                            "group relative flex items-center gap-3 overflow-hidden rounded-xl px-2.5 py-2 text-[13px] transition-all duration-200",
                            active
                              ? "bg-gradient-to-l from-cyan/[0.14] to-transparent text-foreground font-semibold border border-cyan/[0.18] shadow-[0_0_18px_rgba(0,212,255,0.08)]"
                              : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground border border-transparent",
                          )}
                        >
                          {active && (
                            <span className="absolute inset-y-1.5 right-0 w-[3px] rounded-full bg-gradient-to-b from-cyan to-cc-purple shadow-[0_0_8px_rgba(0,212,255,0.6)]" />
                          )}
                          <span
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 shrink-0",
                              active
                                ? "bg-cyan/[0.15] text-cyan ring-1 ring-cyan/20"
                                : "bg-white/[0.03] text-muted-foreground group-hover:text-foreground group-hover:bg-white/[0.06]",
                            )}
                          >
                            <Icon className="w-[15px] h-[15px]" />
                          </span>
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.comingSoon && (
                            <span className="rounded-full bg-amber-dim px-1.5 py-0.5 text-[9px] font-medium text-amber tracking-tight">
                              قريبًا
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
        <div className="m-3 mt-0 rounded-2xl border border-white/6 bg-white/[0.03] p-3.5">
          <div className="mb-2.5 flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">الحالة التشغيلية</span>
            <span className="rounded-full bg-green-dim px-2 py-0.5 text-cc-green">مباشر</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-dim flex items-center justify-center text-cyan text-xs font-bold ring-1 ring-cyan/20">
              {user?.name?.[0] || "م"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-foreground truncate">{user?.name || "..."}</p>
              <p className="text-[10px] text-muted-foreground truncate">{user?.roleName || ""}</p>
            </div>
            <button
              onClick={signOut}
              aria-label="تسجيل الخروج"
              title="تسجيل الخروج"
              className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-cc-red/10 text-muted-foreground hover:text-cc-red transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
