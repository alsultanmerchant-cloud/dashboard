"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";

const COLORS: Record<TaskStage, string> = {
  new: "#94A3B8",
  in_progress: "#00D4FF",
  manager_review: "#8B5CF6",
  specialist_review: "#A78BFA",
  ready_to_send: "#10B981",
  sent_to_client: "#06B6D4",
  client_changes: "#F59E0B",
  done: "#475569",
};

export function StageDwellChart({
  rows,
}: {
  rows: Array<{ stage: TaskStage; avg_hours: number; segments: number }>;
}) {
  const data = rows.map((r) => ({
    name: TASK_STAGE_LABELS[r.stage],
    days: Math.round((r.avg_hours / 24) * 10) / 10,
    hours: Math.round(r.avg_hours * 10) / 10,
    segments: r.segments,
    fill: COLORS[r.stage],
  }));

  // Bind chart text/tooltip colors to the dashboard's theme tokens so the
  // chart renders correctly in both light and dark modes. Hardcoded hex
  // colors (Sky Light feedback #8) made labels invisible on light theme
  // and the tooltip render as a black banner.
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
        <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
        <YAxis
          dataKey="name"
          type="category"
          width={120}
          tick={{ fontSize: 11, fill: "var(--foreground)" }}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,212,255,0.06)" }}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--foreground)",
            fontSize: 12,
          }}
          formatter={(_, __, payload) => {
            const d = payload.payload as typeof data[number];
            return [`${d.days} يوم (${d.hours} ساعة) · ${d.segments} عيّنة`, "متوسط البقاء"];
          }}
        />
        <Bar dataKey="days" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
