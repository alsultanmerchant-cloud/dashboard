export type LogTypeKey =
  | "lost"
  | "renew"
  | "hold"
  | "holdLifted"
  | "editOn"
  | "editOff";

export type LogTypeMeta = {
  key: LogTypeKey | string;
  badge: string;
};

const LOG_TYPE_META: Record<string, LogTypeMeta> = {
  "Contract Close (Lost)": {
    key: "lost",
    badge: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  },
  "Contract Close (Renew)": {
    key: "renew",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  "ON HOLD": {
    key: "hold",
    badge: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-300",
  },
  "HOLD LIFTED": {
    key: "holdLifted",
    badge: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/35 dark:bg-cyan-500/10 dark:text-cyan-300",
  },
  "EDIT MODE ON": {
    key: "editOn",
    badge: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  },
  "EDIT MODE OFF": {
    key: "editOff",
    badge: "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-500/30 dark:bg-muted dark:text-muted-foreground",
  },
};

function fallbackKey(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

export function logTypeMeta(raw: string): LogTypeMeta {
  return (
    LOG_TYPE_META[raw] ?? {
      key: fallbackKey(raw),
      badge: "border-zinc-500/30 bg-muted text-muted-foreground",
    }
  );
}
