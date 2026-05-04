import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Briefcase, Mail, Phone, Globe, MapPin, Calendar, ChevronLeft,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getLiveClient } from "@/lib/odoo/live";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { formatArabicShortDate } from "@/lib/utils-format";

export default async function OdooClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePagePermission("clients.view");

  const client = await getLiveClient(Number(id));
  if (!client) notFound();

  const totalTasks = client.projects.reduce((sum, p) => sum + p.taskCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={client.name}
        breadcrumbs={[
          { label: "العملاء", href: "/clients" },
          { label: client.name },
        ]}
      />

      {/* Contact strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">الهاتف</p>
            <div className="flex items-center gap-1.5 text-sm font-medium" dir="ltr">
              <Phone className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{client.phone ?? "—"}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">البريد</p>
            <div className="flex items-center gap-1.5 text-sm font-medium" dir="ltr">
              <Mail className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{client.email ?? "—"}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">الموقع الإلكتروني</p>
            {client.website ? (
              <a
                href={client.website.startsWith("http") ? client.website : `https://${client.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm font-medium hover:text-cyan transition-colors"
                dir="ltr"
              >
                <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{client.website}</span>
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">العنوان</p>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {[client.city, client.street].filter(Boolean).join("، ") || "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="إجمالي المشاريع"
          value={client.projectCount}
          icon={<Briefcase className="size-5" />}
          tone="default"
        />
        <MetricCard
          label="إجمالي المهام"
          value={totalTasks}
          tone="info"
        />
        <MetricCard
          label="عميل منذ"
          value={formatArabicShortDate(client.createdAt) || "—"}
          icon={<Calendar className="size-5" />}
          tone="purple"
        />
      </div>

      {/* Notes */}
      {client.comment && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">ملاحظات</p>
            <div
              className="prose prose-invert prose-sm max-w-none text-sm leading-relaxed text-foreground"
              dangerouslySetInnerHTML={{ __html: client.comment }}
            />
          </CardContent>
        </Card>
      )}

      {/* Projects list */}
      <div>
        <h2 className="mb-3 text-base font-semibold">المشاريع ({client.projects.length})</h2>
        {client.projects.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              لا توجد مشاريع لهذا العميل.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-white/[0.04]">
                {client.projects.map((p) => (
                  <li key={p.odooId}>
                    <Link
                      href={`/projects/odoo/${p.odooId}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                          {p.managerName && (
                            <span className="truncate">{p.managerName}</span>
                          )}
                          <span className="tabular-nums">{p.taskCount} مهمة</span>
                          {p.startDate && (
                            <span dir="ltr" className="tabular-nums">
                              {p.startDate}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronLeft className="size-4 shrink-0 text-muted-foreground icon-flip-rtl" />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
