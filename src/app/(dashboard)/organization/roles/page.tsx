import { Shield, Check } from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import { listRolesWithPermissions, listAllPermissions } from "@/lib/data/organization";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export default async function RolesPage() {
  const session = await requireSession();
  const [roles, permissions] = await Promise.all([
    listRolesWithPermissions(session.orgId),
    listAllPermissions(),
  ]);

  // Build role → Set<permissionKey>
  const roleHas = new Map<string, Set<string>>();
  for (const r of roles) {
    const set = new Set<string>();
    for (const rp of r.role_permissions ?? []) {
      const perm = Array.isArray(rp.permission) ? rp.permission[0] : rp.permission;
      if (perm?.key) set.add(perm.key);
    }
    roleHas.set(r.id, set);
  }

  return (
    <div>
      <PageHeader
        title="الأدوار والصلاحيات"
        description="مصفوفة كاملة للأدوار الـ 8 والصلاحيات الـ 16. للتعديل التفصيلي قريبًا — حاليًا للعرض فقط."
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Shield className="size-3 text-cyan" />
            {roles.length} دور · {permissions.length} صلاحية
          </Badge>
        }
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02] text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0">
              <tr>
                <th className="px-3 py-2.5 text-start font-medium sticky right-0 bg-card/95 backdrop-blur-sm z-10 min-w-44">الصلاحية</th>
                {roles.map((r) => (
                  <th key={r.id} className="px-2 py-2.5 text-center font-medium whitespace-nowrap">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[11px] text-foreground">{ROLE_LABELS[r.key] ?? r.name}</span>
                      <span className="text-[9px] font-mono text-muted-foreground/70" dir="ltr">{r.key}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-3 py-2.5 sticky right-0 bg-card/95 backdrop-blur-sm">
                    <div>
                      <p className="text-sm font-medium">{p.description ?? p.key}</p>
                      <p className="text-[10px] font-mono text-muted-foreground" dir="ltr">{p.key}</p>
                    </div>
                  </td>
                  {roles.map((r) => {
                    const has = roleHas.get(r.id)?.has(p.key);
                    return (
                      <td key={r.id} className="px-2 py-2.5 text-center">
                        {has ? (
                          <span className={cn(
                            "inline-flex size-6 items-center justify-center rounded-full",
                            r.key === "owner" ? "bg-cyan-dim text-cyan" : "bg-green-dim text-cc-green",
                          )}>
                            <Check className="size-3.5" />
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {roles.map((r) => {
          const count = roleHas.get(r.id)?.size ?? 0;
          return (
            <Card key={r.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold truncate">{ROLE_LABELS[r.key] ?? r.name}</h3>
                    <p className="text-[10px] font-mono text-muted-foreground" dir="ltr">{r.key}</p>
                  </div>
                  <Badge variant={r.is_system ? "default" : "secondary"} className="text-[10px]">
                    {r.is_system ? "نظامي" : "مخصص"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{r.description ?? "—"}</p>
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">عدد الصلاحيات</span>
                  <span className="font-bold text-cyan tabular-nums">{count}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
