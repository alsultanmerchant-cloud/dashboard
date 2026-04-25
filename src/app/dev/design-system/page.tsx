"use client";

import { useState } from "react";
import {
  Briefcase,
  CheckCircle2,
  AlertTriangle,
  Bell,
  Plus,
  Users,
  Target,
  Sparkles,
  Inbox,
  Search,
  ChevronDown,
  Send,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import {
  PageHeaderSkeleton,
  StatRowSkeleton,
  CardListSkeleton,
  TableSkeleton,
} from "@/components/skeletons";
import {
  TaskStatusBadge,
  PriorityBadge,
  ProjectStatusBadge,
  HandoverStatusBadge,
  ClientStatusBadge,
  UrgencyBadge,
  EmploymentStatusBadge,
  ServiceBadge,
} from "@/components/status-badges";
import { FilterBar } from "@/components/filter-bar";
import {
  CommandPaletteProvider,
  CommandPaletteTrigger,
} from "@/components/command-palette";
import {
  DataTableShell,
  DataTable,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  DataTableCell,
} from "@/components/data-table-shell";
import { Kbd } from "@/components/kbd";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SWATCHES = [
  { name: "primary / cyan", token: "--color-cyan", hex: "#00D4FF" },
  { name: "success / cc-green", token: "--color-cc-green", hex: "#10B981" },
  { name: "warning / amber", token: "--color-amber", hex: "#F59E0B" },
  { name: "destructive / cc-red", token: "--color-cc-red", hex: "#EF4444" },
  { name: "info / cc-blue", token: "--color-cc-blue", hex: "#7da6ff" },
  { name: "purple", token: "--color-cc-purple", hex: "#8B5CF6" },
  { name: "pink", token: "--color-pink", hex: "#EC4899" },
  { name: "background", token: "--background", hex: "#07090F" },
  { name: "card", token: "--card", hex: "#111827" },
  { name: "border", token: "--border", hex: "#1E2A3A" },
];

const RADII = [
  { name: "sm", token: "--radius-sm" },
  { name: "md", token: "--radius-md" },
  { name: "lg", token: "--radius-lg" },
  { name: "xl", token: "--radius-xl" },
  { name: "2xl", token: "--radius-2xl" },
  { name: "3xl", token: "--radius-3xl" },
];

export default function DesignSystemPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const hasFilter = search.length > 0 || filter !== "all";

  return (
    <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 lg:py-14">
      <CommandPaletteProvider />

      <PageHeader
        title="نظام التصميم — Agency Command Center"
        description="عرض شامل لرموز التصميم والمكونات الأساسية والوحدات النطاقية والحالات. هذه الصفحة تجريبية ومتاحة دون تسجيل دخول."
        breadcrumbs={[{ label: "الجذر", href: "/dev" }, { label: "نظام التصميم" }]}
        actions={
          <>
            <CommandPaletteTrigger />
            <Button onClick={() => toast.success("تم الحفظ بنجاح")}>
              <Plus />
              عرض إشعار نجاح
            </Button>
          </>
        }
      />

      {/* Color tokens */}
      <section className="mb-12">
        <SectionTitle title="رموز الألوان" description="ألوان الإشارات الأساسية للوحة القيادة" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SWATCHES.map((s) => (
            <div
              key={s.name}
              className="overflow-hidden rounded-xl border border-white/[0.06] bg-card"
            >
              <div className="h-16" style={{ background: s.hex }} />
              <div className="p-3">
                <div className="text-xs font-semibold text-foreground">{s.name}</div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{s.token}</div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{s.hex}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Typography */}
      <section className="mb-12">
        <SectionTitle title="مستويات النصوص" description="مقياس الخطوط والأوزان" />
        <div className="space-y-2 rounded-2xl border border-white/[0.06] bg-card p-5">
          <div className="text-4xl font-extrabold tracking-tight">Display — للعناوين الرئيسية</div>
          <div className="text-2xl font-bold tracking-tight">H1 — عنوان الصفحة</div>
          <div className="text-xl font-semibold">H2 — عنوان قسم</div>
          <div className="text-base font-medium">H3 — عنوان فرعي</div>
          <div className="text-sm text-foreground">نص عادي — Body</div>
          <div className="text-xs text-muted-foreground">نص مساعد — Caption</div>
          <div className="font-mono text-[11px] text-muted-foreground">monospaced — alsultain@agency.com</div>
        </div>
      </section>

      {/* Radii */}
      <section className="mb-12">
        <SectionTitle title="نصف الأقطار" />
        <div className="flex flex-wrap gap-3">
          {RADII.map((r) => (
            <div key={r.name} className="flex flex-col items-center gap-1.5">
              <div
                className="size-16 border border-white/10 bg-cyan-dim"
                style={{ borderRadius: `var(${r.token})` }}
              />
              <div className="text-xs text-foreground">{r.name}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{r.token}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Buttons */}
      <section className="mb-12">
        <SectionTitle title="الأزرار" />
        <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-card p-5">
          <div className="flex flex-wrap gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs">XS</Button>
            <Button size="sm">SM</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon"><Plus /></Button>
            <Button>
              <Send /> مع أيقونة
            </Button>
            <Button disabled>
              <Loader2 className="animate-spin" />
              قيد المعالجة…
            </Button>
          </div>
        </div>
      </section>

      {/* Form controls */}
      <section className="mb-12">
        <SectionTitle title="حقول النماذج" />
        <div className="grid gap-4 rounded-2xl border border-white/[0.06] bg-card p-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ds-email">البريد الإلكتروني</Label>
            <Input id="ds-email" type="email" placeholder="name@company.com" defaultValue="alsultain@agency.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ds-priority">الأولوية</Label>
            <Select defaultValue="high">
              <SelectTrigger id="ds-priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">منخفضة</SelectItem>
                <SelectItem value="medium">متوسطة</SelectItem>
                <SelectItem value="high">عالية</SelectItem>
                <SelectItem value="urgent">عاجلة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ds-notes">ملاحظات المبيعات</Label>
            <Textarea id="ds-notes" placeholder="اكتب ملاحظات مفصلة هنا…" rows={3} />
          </div>
        </div>
      </section>

      {/* Domain badges */}
      <section className="mb-12">
        <SectionTitle title="الشارات النطاقية" description="حالات الكيانات الأساسية في النظام" />
        <div className="grid gap-4 rounded-2xl border border-white/[0.06] bg-card p-5 sm:grid-cols-2">
          <BadgeRow label="حالة المهمة">
            {["todo", "in_progress", "review", "blocked", "done", "cancelled"].map((s) => (
              <TaskStatusBadge key={s} status={s} />
            ))}
          </BadgeRow>
          <BadgeRow label="الأولوية">
            {["low", "medium", "high", "urgent"].map((p) => (
              <PriorityBadge key={p} priority={p} />
            ))}
          </BadgeRow>
          <BadgeRow label="حالة المشروع">
            {["active", "on_hold", "completed", "cancelled"].map((s) => (
              <ProjectStatusBadge key={s} status={s} />
            ))}
          </BadgeRow>
          <BadgeRow label="حالة التسليم">
            {["submitted", "in_review", "accepted", "rejected"].map((s) => (
              <HandoverStatusBadge key={s} status={s} />
            ))}
          </BadgeRow>
          <BadgeRow label="حالة العميل">
            {["lead", "active", "inactive"].map((s) => (
              <ClientStatusBadge key={s} status={s} />
            ))}
          </BadgeRow>
          <BadgeRow label="مستوى العاجلية">
            {["low", "normal", "high", "critical"].map((l) => (
              <UrgencyBadge key={l} level={l} />
            ))}
          </BadgeRow>
          <BadgeRow label="حالة الموظف">
            {["active", "on_leave", "suspended", "terminated"].map((s) => (
              <EmploymentStatusBadge key={s} status={s} />
            ))}
          </BadgeRow>
          <BadgeRow label="الخدمات">
            <ServiceBadge slug="social-media-management" name="إدارة السوشيال ميديا" />
            <ServiceBadge slug="seo" name="تحسين محركات البحث" />
            <ServiceBadge slug="media-buying" name="إعلانات ممولة" />
          </BadgeRow>
        </div>
      </section>

      {/* Metric cards */}
      <section className="mb-12">
        <SectionTitle title="بطاقات المؤشرات" description="بطاقات الإحصاءات الرئيسية في لوحة القيادة" />
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="عملاء نشطون"
            value={12}
            hint="+2 هذا الشهر"
            icon={<Users className="size-5" />}
            tone="default"
            href="/clients"
            trend={{ value: "+18%", direction: "up" }}
          />
          <MetricCard
            label="مشاريع جارية"
            value={8}
            hint="3 ذات أولوية عالية"
            icon={<Briefcase className="size-5" />}
            tone="info"
          />
          <MetricCard
            label="مهام مكتملة هذا الأسبوع"
            value={47}
            icon={<CheckCircle2 className="size-5" />}
            tone="success"
            trend={{ value: "+12%", direction: "up" }}
          />
          <MetricCard
            label="مهام متأخرة"
            value={4}
            hint="تحتاج متابعة عاجلة"
            icon={<AlertTriangle className="size-5" />}
            tone="destructive"
            trend={{ value: "-2", direction: "down" }}
          />
          <MetricCard
            label="تسليمات جديدة"
            value={3}
            icon={<Inbox className="size-5" />}
            tone="warning"
          />
          <MetricCard
            label="تنبيهات لم تُقرأ"
            value={9}
            icon={<Bell className="size-5" />}
            tone="purple"
          />
          <MetricCard
            label="أحداث ذكية اليوم"
            value={28}
            icon={<Sparkles className="size-5" />}
            tone="default"
          />
          <MetricCard
            label="هدف الشهر"
            value="73%"
            hint="على المسار الصحيح"
            icon={<Target className="size-5" />}
            tone="success"
          />
        </div>
      </section>

      {/* Filter Bar live */}
      <section className="mb-12">
        <SectionTitle title="شريط التصفية" description="بحث + مرشحات + إعادة تعيين" />
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "ابحث في المهام…" }}
          hasActiveFilters={hasFilter}
          onClear={() => {
            setSearch("");
            setFilter("all");
          }}
        >
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 min-w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              <SelectItem value="todo">قيد الانتظار</SelectItem>
              <SelectItem value="in_progress">قيد التنفيذ</SelectItem>
              <SelectItem value="done">مكتملة</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm">
            <ChevronDown className="size-3.5" />
            مرشح متقدم
          </Button>
        </FilterBar>
      </section>

      {/* Empty / Error / Skeleton */}
      <section className="mb-12">
        <SectionTitle title="حالات العرض" description="تحميل · فارغ · خطأ" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <div className="mb-2 text-xs text-muted-foreground">تحميل (skeleton)</div>
            <CardListSkeleton rows={3} />
          </div>
          <div>
            <div className="mb-2 text-xs text-muted-foreground">فارغ</div>
            <EmptyState
              icon={<Inbox className="size-6" />}
              title="لا يوجد عملاء بعد"
              description="أضف أول عميل لتبدأ في إنشاء المشاريع وتوزيع المهام."
              action={<Button><Plus />إضافة عميل</Button>}
              variant="compact"
            />
          </div>
          <div>
            <div className="mb-2 text-xs text-muted-foreground">خطأ</div>
            <ErrorState
              title="تعذّر تحميل البيانات"
              description="حدث خطأ في الاتصال بالخادم. حاول مرة أخرى."
              onRetry={() => toast.info("جارٍ إعادة المحاولة…")}
            />
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 text-xs text-muted-foreground">page header skeleton + stat row + table</div>
          <PageHeaderSkeleton />
          <StatRowSkeleton count={4} />
          <div className="h-4" />
          <TableSkeleton rows={4} cols={5} />
        </div>
      </section>

      {/* Data table sample */}
      <section className="mb-12">
        <SectionTitle title="جداول البيانات" description="هيكل جدول مرتب بالحالة والأولوية" />
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>المهمة</DataTableHeaderCell>
                <DataTableHeaderCell>المشروع</DataTableHeaderCell>
                <DataTableHeaderCell>الحالة</DataTableHeaderCell>
                <DataTableHeaderCell>الأولوية</DataTableHeaderCell>
                <DataTableHeaderCell>تاريخ التسليم</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {[
                { t: "تهيئة العميل", p: "مطعم البندر", s: "in_progress", pr: "high", d: "2026-04-28" },
                { t: "استراتيجية المحتوى", p: "مطعم البندر", s: "review", pr: "medium", d: "2026-04-29" },
                { t: "إطلاق الحملة", p: "متجر الأرز", s: "blocked", pr: "urgent", d: "2026-04-26" },
                { t: "تقرير شهري", p: "كلينك ابتسامة", s: "done", pr: "low", d: "2026-04-20" },
              ].map((row, i) => (
                <DataTableRow key={i}>
                  <DataTableCell className="font-medium">{row.t}</DataTableCell>
                  <DataTableCell className="text-muted-foreground">{row.p}</DataTableCell>
                  <DataTableCell><TaskStatusBadge status={row.s} /></DataTableCell>
                  <DataTableCell><PriorityBadge priority={row.pr} /></DataTableCell>
                  <DataTableCell className="font-mono text-xs text-muted-foreground">{row.d}</DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableShell>
      </section>

      {/* Cards / Surfaces */}
      <section className="mb-12">
        <SectionTitle title="الأسطح والبطاقات" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>بطاقة افتراضية</CardTitle>
              <CardDescription>سطح أساسي بحدود سيان خفيفة وتوهج داخلي.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                تستخدم لتجميع المعلومات. متوفرة بحجم default وحجم sm.
              </p>
            </CardContent>
          </Card>
          <div className="glass-surface rounded-2xl p-5">
            <h3 className="text-sm font-semibold">سطح زجاجي — glass-surface</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              يستخدم في الشريط الجانبي والشرائح الأنيقة.
            </p>
            <div className="mt-3 flex gap-2">
              <Badge>افتراضي</Badge>
              <Badge variant="secondary">ثانوي</Badge>
            </div>
          </div>
          <div className="cc-card rounded-2xl p-5">
            <h3 className="text-sm font-semibold">بطاقة CC — cc-card</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              متغيّر سطحٍ مع توهج محيطي. مناسب للعناصر التفاعلية.
            </p>
            <Skeleton className="mt-3 h-3 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
        </div>
      </section>

      {/* Overlays */}
      <section className="mb-12">
        <SectionTitle title="النوافذ المنبثقة" description="Dialog · Dropdown · Toast · Command palette" />
        <div className="flex flex-wrap gap-2 rounded-2xl border border-white/[0.06] bg-card p-5">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>افتح حواراً</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>هل أنت متأكد؟</DialogTitle>
                <DialogDescription>
                  هذا إجراء لا يمكن التراجع عنه. سيتم إرسال نموذج التسليم إلى مدير الحساب فورًا.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2">
                <Button variant="outline">إلغاء</Button>
                <Button>تأكيد</Button>
              </div>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>قائمة منسدلة</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>إجراءات سريعة</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem><Plus /> إضافة عميل</DropdownMenuItem>
              <DropdownMenuItem><Briefcase /> إنشاء مشروع</DropdownMenuItem>
              <DropdownMenuItem><Send /> إرسال تسليم</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button onClick={() => toast.success("تم الإرسال بنجاح")}>إشعار نجاح</Button>
          <Button variant="outline" onClick={() => toast.error("تعذّر الحفظ")}>إشعار خطأ</Button>
          <Button variant="outline" onClick={() => toast.info("تم تحديث البيانات")}>إشعار معلومة</Button>

          <CommandPaletteTrigger />
        </div>
      </section>

      {/* Keyboard hints */}
      <section className="mb-12">
        <SectionTitle title="اختصارات لوحة المفاتيح" />
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.06] bg-card p-5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Kbd>⌘</Kbd><Kbd>K</Kbd> فتح لوحة الأوامر</span>
          <Separator orientation="vertical" className="h-4" />
          <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd> إغلاق النافذة</span>
          <Separator orientation="vertical" className="h-4" />
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> إرسال النموذج</span>
        </div>
      </section>

      <footer className="mt-10 flex items-center justify-between border-t border-white/5 pt-6 text-xs text-muted-foreground">
        <span>Agency Command Center · Phase 1 design system</span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 animate-pulse rounded-full bg-cc-green" /> مباشر
        </span>
      </footer>
    </main>
  );
}

function BadgeRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
