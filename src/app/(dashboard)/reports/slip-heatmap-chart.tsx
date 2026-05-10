"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { SlipBucket } from "@/lib/data/reports-extras";

const COLORS: Record<SlipBucket, string> = {
  ahead: "#10B981",
  on_track: "#06B6D4",
  minor: "#FACC15",
  moderate: "#F59E0B",
  severe: "#EF4444",
  critical: "#B91C1C",
};

export function SlipHeatmapChart({
  rows,
}: {
  rows: Array<{ bucket: SlipBucket; label: string; count: number }>;
}) {
  const data = rows.map((r) => ({
    name: r.label,
    count: r.count,
    fill: COLORS[r.bucket],
  }));

  // Theme-aware colors so the chart renders on both light and dark themes
  // (feedback #8: hardcoded dark-theme colors caused invisible axis labels
  // and a black tooltip banner on light mode).
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ left: 8, right: 24, top: 8 }}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--foreground)" }}
          interval={0}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
        <Tooltip
          cursor={{ fill: "rgba(239,68,68,0.06)" }}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--foreground)",
            fontSize: 12,
          }}
          formatter={(value) => [`${value} مهمة`, "العدد"]}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
