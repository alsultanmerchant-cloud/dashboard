"use client";

interface BarGroup {
  label: string;
  values: { value: number; color: string; label?: string }[];
}

interface BarChartProps {
  data: BarGroup[];
  height?: number;
  showLegend?: boolean;
}

export function BarChart({ data, height = 200, showLegend = true }: BarChartProps) {
  if (data.length === 0) return null;

  const padding = { top: 10, right: 20, bottom: 30, left: 50 };
  const width = 600;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...data.flatMap((d) => d.values.map((v) => v.value))) * 1.1;
  const groupWidth = chartW / data.length;
  const barCount = data[0]?.values.length || 1;
  const barWidth = Math.min(groupWidth / (barCount + 1), 30);
  const barGap = 4;

  const getY = (v: number) => padding.top + chartH - (v / maxVal) * chartH;

  const legendItems = data[0]?.values.map((v) => ({
    label: v.label || "",
    color: v.color,
  })) || [];

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = padding.top + chartH * (1 - pct);
          const val = maxVal * pct;
          return (
            <g key={pct}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#1e293b"
                strokeWidth="1"
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground"
                style={{ fontSize: "10px" }}
              >
                {val >= 1000 ? `${(val / 1000).toFixed(0)}K` : val.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((group, gi) => {
          const groupX = padding.left + gi * groupWidth + groupWidth / 2;
          const totalBarWidth = barCount * barWidth + (barCount - 1) * barGap;
          const startX = groupX - totalBarWidth / 2;

          return (
            <g key={gi}>
              {group.values.map((v, vi) => {
                const barH = (v.value / maxVal) * chartH;
                const x = startX + vi * (barWidth + barGap);
                return (
                  <rect
                    key={vi}
                    x={x}
                    y={getY(v.value)}
                    width={barWidth}
                    height={barH}
                    rx={3}
                    fill={v.color}
                    opacity={0.85}
                    className="transition-all hover:opacity-100"
                  />
                );
              })}
              <text
                x={groupX}
                y={height - 5}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: "10px" }}
              >
                {group.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      {showLegend && legendItems.length > 0 && (
        <div className="flex justify-center gap-4 mt-2">
          {legendItems.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <span
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
