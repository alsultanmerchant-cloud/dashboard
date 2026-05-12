"use client";

// Rwasem-parity grouped board for the projects list.
// Renders one horizontally-scrolling column per group key (manager / status /
// tags) with a sticky column header showing the group label + count, and the
// project cards stacked vertically inside each column.

import { useMemo } from "react";
import { User2 } from "lucide-react";
import type { LiveProject } from "@/lib/odoo/live";
import { ProjectCard } from "./project-card";

type Bucket = {
  key: string;
  label: string;
  avatarUrl?: string | null;
  items: LiveProject[];
};

const STATUS_LABEL: Record<string, string> = {
  on_track: "على المسار",
  at_risk: "تحت المراقبة",
  off_track: "خارج المسار",
  on_hold: "متوقّف",
  done: "منجز",
};
const STATUS_DOT: Record<string, string> = {
  on_track: "bg-emerald-500",
  at_risk: "bg-amber-500",
  off_track: "bg-rose-500",
  on_hold: "bg-slate-400",
  done: "bg-cyan-500",
};

const NONE_KEY = "__none__";

function bucketByManager(items: LiveProject[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const p of items) {
    const key = p.managerId ? String(p.managerId) : NONE_KEY;
    const label = p.managerName ?? "بدون مدير";
    const b = map.get(key) ?? {
      key,
      label,
      avatarUrl: p.managerAvatarUrl ?? null,
      items: [],
    };
    b.items.push(p);
    map.set(key, b);
  }
  // Stable order: assigned managers (descending count) then "بدون مدير" last.
  return [...map.values()].sort((a, b) => {
    if (a.key === NONE_KEY) return 1;
    if (b.key === NONE_KEY) return -1;
    return b.items.length - a.items.length;
  });
}

function bucketByStatus(items: LiveProject[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const p of items) {
    const key = p.lastUpdateStatus ?? NONE_KEY;
    const label = p.lastUpdateStatus
      ? STATUS_LABEL[p.lastUpdateStatus] ?? p.lastUpdateStatus
      : "بدون حالة";
    const b = map.get(key) ?? { key, label, items: [] };
    b.items.push(p);
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === NONE_KEY) return 1;
    if (b.key === NONE_KEY) return -1;
    return b.items.length - a.items.length;
  });
}

function bucketByTag(items: LiveProject[]): Bucket[] {
  // A project with multiple tags appears in EACH tag's column (Rwasem behaviour).
  const map = new Map<string, Bucket>();
  for (const p of items) {
    if (p.tagIds.length === 0) {
      const b = map.get(NONE_KEY) ?? { key: NONE_KEY, label: "بدون تصنيف", items: [] };
      b.items.push(p);
      map.set(NONE_KEY, b);
      continue;
    }
    p.tagIds.forEach((id, idx) => {
      const key = String(id);
      const label = p.tagNames[idx] ?? `#${id}`;
      const b = map.get(key) ?? { key, label, items: [] };
      b.items.push(p);
      map.set(key, b);
    });
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === NONE_KEY) return 1;
    if (b.key === NONE_KEY) return -1;
    return b.items.length - a.items.length;
  });
}

function bucketByAccountManager(items: LiveProject[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const p of items) {
    const key = p.accountManagerId ? String(p.accountManagerId) : NONE_KEY;
    const label = p.accountManagerName ?? "بدون مدير حساب";
    const b = map.get(key) ?? {
      key,
      label,
      avatarUrl: p.accountManagerAvatarUrl ?? null,
      items: [],
    };
    b.items.push(p);
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === NONE_KEY) return 1;
    if (b.key === NONE_KEY) return -1;
    return b.items.length - a.items.length;
  });
}

function bucketByClient(items: LiveProject[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const p of items) {
    const key = p.clientId ? String(p.clientId) : NONE_KEY;
    const label = p.clientName ?? "بدون عميل";
    const b = map.get(key) ?? { key, label, items: [] };
    b.items.push(p);
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === NONE_KEY) return 1;
    if (b.key === NONE_KEY) return -1;
    return b.items.length - a.items.length;
  });
}

const TARGET_LABEL: Record<string, string> = {
  on_target: "على الهدف",
  off_target: "خارج الهدف",
  out: "خرج",
  sales_deposit: "دفعة مبيعات",
  renewed: "مجدَّد",
};

function bucketByTarget(items: LiveProject[]): Bucket[] {
  const order = ["on_target", "off_target", "out", "sales_deposit", "renewed"] as const;
  const map = new Map<string, Bucket>(
    order.map((k) => [k, { key: k, label: TARGET_LABEL[k], items: [] }]),
  );
  map.set(NONE_KEY, { key: NONE_KEY, label: "بدون هدف", items: [] });
  for (const p of items) {
    const k = p.target ?? NONE_KEY;
    if (!map.has(k)) map.set(k, { key: k, label: TARGET_LABEL[k] ?? k, items: [] });
    map.get(k)!.items.push(p);
  }
  return [...map.values()].filter((b) => b.items.length > 0);
}

const MONTH_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function bucketByMonth(
  items: LiveProject[],
  pick: (p: LiveProject) => string | null,
  noneLabel: string,
): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const p of items) {
    const raw = pick(p);
    if (!raw) {
      const b = map.get(NONE_KEY) ?? { key: NONE_KEY, label: noneLabel, items: [] };
      b.items.push(p);
      map.set(NONE_KEY, b);
      continue;
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      const b = map.get(NONE_KEY) ?? { key: NONE_KEY, label: noneLabel, items: [] };
      b.items.push(p);
      map.set(NONE_KEY, b);
      continue;
    }
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${MONTH_AR[d.getMonth()]} ${d.getFullYear()}`;
    const b = map.get(key) ?? { key, label, items: [] };
    b.items.push(p);
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === NONE_KEY) return 1;
    if (b.key === NONE_KEY) return -1;
    return a.key.localeCompare(b.key);
  });
}

function bucket(items: LiveProject[], groupBy: string): Bucket[] {
  switch (groupBy) {
    case "project_manager":
    case "manager":
    case "user_id":
      return bucketByManager(items);
    case "status":
    case "last_update_status_display":
      return bucketByStatus(items);
    case "tags":
    case "tag_ids":
      return bucketByTag(items);
    case "account_manager":
      return bucketByAccountManager(items);
    case "client":
      return bucketByClient(items);
    case "target":
      return bucketByTarget(items);
    case "start_month":
      return bucketByMonth(items, (p) => p.startDate, "بدون تاريخ بدء");
    case "end_month":
      return bucketByMonth(items, (p) => p.endDate, "بدون تاريخ انتهاء");
    default:
      return [{ key: "all", label: "الكل", items }];
  }
}

export function ProjectsBoard({
  items,
  groupBy,
}: {
  items: LiveProject[];
  groupBy: string;
}) {
  const buckets = useMemo(() => bucket(items, groupBy), [items, groupBy]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {buckets.map((b) => (
        <div
          key={b.key}
          className="flex w-[300px] shrink-0 flex-col gap-2 rounded-lg border border-soft bg-card/40 p-2"
        >
          <div className="sticky top-0 flex items-center justify-between gap-2 rounded-md bg-card/95 px-1.5 py-1.5 backdrop-blur">
            <div className="flex min-w-0 items-center gap-1.5">
              {b.avatarUrl !== undefined && (
                b.avatarUrl ? (
                  <img
                    src={b.avatarUrl}
                    alt=""
                    className="size-5 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <User2 className="size-3" />
                  </span>
                )
              )}
              {!b.avatarUrl && groupBy.startsWith("status") && (
                <span
                  className={`inline-block size-2.5 shrink-0 rounded-full ${STATUS_DOT[b.key] ?? "bg-slate-400"}`}
                  aria-hidden
                />
              )}
              <span className="truncate text-[13px] font-semibold">{b.label}</span>
            </div>
            <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {b.items.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {b.items.map((p) => (
              <ProjectCard key={p.id ?? `odoo-${p.odooId}`} project={p} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
