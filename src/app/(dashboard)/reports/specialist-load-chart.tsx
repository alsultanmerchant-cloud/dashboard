"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

export function SpecialistLoadChart({
  rows,
}: {
  rows: Array<{
    employee_id: string;
    full_name: string;
    open_count: number;
    allocated_hours: number;
  }>;
}) {
  const data = rows.map((r) => ({
    name: r.full_name,
    open: r.open_count,
    hours: r.allocated_hours,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
        <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} />
        <YAxis
          dataKey="name"
          type="category"
          width={140}
          tick={{ fontSize: 11, fill: "#F1F5F9" }}
        />
        <Tooltip
          cursor={{ fill: "rgba(139,92,246,0.06)" }}
          contentStyle={{
            background: "#0D1117",
            border: "1px solid #1E2A3A",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(_, __, payload) => {
            const d = payload.payload as typeof data[number];
            return [`${d.open} مهمة · ${d.hours} ساعة مخصصة`, "الحمل المفتوح"];
          }}
        />
        <Bar dataKey="open" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
