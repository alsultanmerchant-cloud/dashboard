"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  RefreshCw,
  Heart,
  Headphones,
  Code,
  Handshake,
  Users,
  Banknote,
  X,
  Shield,
  LogOut,
  ChevronDown,
  Upload,
  ClipboardList,
  BookOpen,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

const NAV_ITEMS = [
  { label: "نظرة عامة", href: "/dashboard", slug: "dashboard", icon: LayoutDashboard },
  { label: "المبيعات", href: "/sales", slug: "sales", icon: TrendingUp },
  { label: "دليل المبيعات", href: "/sales-guide", slug: "sales-guide", icon: BookOpen },
  { label: "الاجتماع الأسبوعي", href: "/weekly", slug: "weekly", icon: ClipboardList },
  { label: "التجديدات", href: "/renewals", slug: "renewals", icon: RefreshCw },
  { label: "رضا العملاء", href: "/satisfaction", slug: "satisfaction", icon: Heart },
  { label: "الدعم", href: "/support", slug: "support", icon: Headphones },
  { label: "التطويرات", href: "/development", slug: "development", icon: Code },
  { label: "الشراكات", href: "/partnerships", slug: "partnerships", icon: Handshake },
  { label: "المسوقين", href: "/marketers", slug: "marketers", icon: Megaphone },
  { label: "الفريق", href: "/team", slug: "team", icon: Users },
  { label: "المالية", href: "/finance", slug: "finance", icon: Banknote },
  { label: "رفع الملفات", href: "/upload", slug: "upload", icon: Upload },
  { label: "إدارة المستخدمين", href: "/users", slug: "users", icon: Shield },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, loading, signOut, activeOrgId, switchOrg, orgs } = useAuth();
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);

  const isSuperAdmin = user?.isSuperAdmin ?? false;

  // Filter nav items by user permissions
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (isSuperAdmin) return true;
    return user?.allowedPages.includes(item.slug);
  });

  // Find active org info
  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  return (
    <>
      {/* Backdrop for mobile/tablet */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed top-3 right-3 bottom-3 z-50 w-[244px] overflow-hidden rounded-[28px] glass-surface border-l-0 flex flex-col transition-transform duration-300 ease-in-out",
          "lg:translate-x-0",
          open ? "translate-x-0" : "translate-x-[260px] lg:translate-x-0"
        )}
      >
        {/* Logo + close button on mobile */}
        <div className="px-5 pt-5 pb-4 border-b border-white/6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-linear-to-br from-cyan/30 to-cc-purple/30 ring-1 ring-white/10 shrink-0">
              <span className="text-sm font-extrabold tracking-[0.2em] text-cyan">CC</span>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-[1.05rem] font-extrabold text-foreground">لوحة التحكم</h1>
              <p className="mt-1 text-[11px] text-muted-foreground">مركز متابعة حي للمبيعات والتشغيل</p>
            </div>
            {/* Close button — only on mobile/tablet */}
            <button
              onClick={onClose}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Org switcher — super admin only */}
          {isSuperAdmin && orgs.length > 0 ? (
            <div className="mt-3 relative">
              <button
                onClick={() => setOrgMenuOpen((v) => !v)}
                className="w-full flex items-center gap-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/6 px-3 py-2 transition-colors"
              >
                <div className="w-7 h-7 rounded-lg bg-cyan-dim flex items-center justify-center text-cyan text-xs font-bold ring-1 ring-cyan/20 shrink-0">
                  {activeOrg?.nameAr?.[0] || "O"}
                </div>
                <div className="flex-1 text-right min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{activeOrg?.nameAr || "المنظمة"}</p>
                  <p className="text-[10px] text-muted-foreground">{activeOrg?.name || ""}</p>
                </div>
                <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", orgMenuOpen && "rotate-180")} />
              </button>

              {orgMenuOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-xl bg-[#111827] border border-white/10 shadow-lg overflow-hidden z-50">
                  {orgs.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => {
                        switchOrg(o.id);
                        setOrgMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.06] transition-colors",
                        o.id === activeOrgId && "bg-white/[0.04]"
                      )}
                    >
                      <div className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ring-1 shrink-0",
                        o.id === activeOrgId
                          ? "bg-cyan-dim text-cyan ring-cyan/20"
                          : "bg-white/[0.06] text-muted-foreground ring-white/10"
                      )}>
                        {o.nameAr?.[0] || "O"}
                      </div>
                      <div className="flex-1 text-right min-w-0">
                        <p className={cn("text-xs font-semibold truncate", o.id === activeOrgId ? "text-foreground" : "text-muted-foreground")}>{o.nameAr}</p>
                        <p className="text-[10px] text-muted-foreground">{o.name}</p>
                      </div>
                      {o.id === activeOrgId && (
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Static org badge for non-super-admin */
            !loading && user && (
              <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-white/[0.04] border border-white/6 px-3 py-2">
                <div className="w-7 h-7 rounded-lg bg-cyan-dim flex items-center justify-center text-cyan text-xs font-bold ring-1 ring-cyan/20 shrink-0">
                  {activeOrg?.nameAr?.[0] || "O"}
                </div>
                <div className="flex-1 text-right min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{activeOrg?.nameAr || "المنظمة"}</p>
                  <p className="text-[10px] text-muted-foreground">{activeOrg?.name || ""}</p>
                </div>
              </div>
            )
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1.5 overflow-y-auto">
          {visibleItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "group relative flex items-center gap-3 overflow-hidden rounded-2xl px-3.5 py-3 text-[13px] transition-all duration-200",
                  isActive
                    ? "bg-gradient-to-l from-cyan/[0.12] to-transparent text-foreground font-semibold border border-cyan/[0.15] shadow-[0_0_20px_rgba(0,212,255,0.08)]"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground border border-transparent"
                )}
              >
                {isActive && (
                  <span className="absolute inset-y-2 right-0.5 w-[3px] rounded-full bg-gradient-to-b from-cyan via-cyan to-cc-purple shadow-[0_0_8px_rgba(0,212,255,0.6)]" />
                )}
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200",
                    isActive ? "bg-cyan/[0.15] text-cyan ring-1 ring-cyan/20 shadow-[0_0_10px_rgba(0,212,255,0.15)]" : "bg-white/[0.03] text-muted-foreground group-hover:text-foreground group-hover:bg-white/[0.06]"
                  )}
                >
                  <Icon className="w-[17px] h-[17px]" />
                </span>
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="m-3 mt-0 rounded-2xl border border-white/6 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">الحالة التشغيلية</span>
            <span className="rounded-full bg-green-dim px-2 py-0.5 text-cc-green">مباشر</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-cyan-dim flex items-center justify-center text-cyan text-xs font-bold ring-1 ring-cyan/20">
              {user?.name?.[0] || "م"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{user?.name || "..."}</p>
              <p className="text-[11px] text-muted-foreground truncate">{user?.roleName || ""}</p>
            </div>
            <button
              onClick={signOut}
              className="flex items-center justify-center w-8 h-8 rounded-xl bg-white/[0.04] hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors shrink-0"
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
