"use client";

interface DataPoint {
  label: string;
  value: number;
  target?: number;
}

interface LineChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  targetColor?: string;
  showArea?: boolean;
}

export function LineChart({
  data,
  height = 200,
  color = "#00e5ff",
  targetColor = "#64748b",
  showArea = true,
}: LineChartProps) {
  if (data.length === 0) return null;

  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const width = 600;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const allValues = data.flatMap((d) => [d.value, d.target ?? 0]);
  const maxVal = Math.max(...allValues) * 1.1;
  const minVal = 0;

  const getX = (i: number) => padding.left + (i / (data.length - 1)) * chartW;
  const getY = (v: number) =>
    padding.top + chartH - ((v - minVal) / (maxVal - minVal)) * chartH;

  const mainPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.value)}`)
    .join(" ");

  const areaPath = `${mainPath} L ${getX(data.length - 1)} ${getY(0)} L ${getX(0)} ${getY(0)} Z`;

  const targetPath = data
    .filter((d) => d.target !== undefined)
    .map((d, i) => `${i === 0 ? "M" : "L"} ${getX(data.indexOf(d))} ${getY(d.target!)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const y = padding.top + chartH * (1 - pct);
        const val = minVal + (maxVal - minVal) * pct;
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

      {/* X labels */}
      {data.map((d, i) => (
        <text
          key={i}
          x={getX(i)}
          y={height - 5}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: "10px" }}
        >
          {d.label}
        </text>
      ))}

      {/* Area fill */}
      {showArea && (
        <path d={areaPath} fill={color} opacity={0.08} />
      )}

      {/* Target line */}
      {targetPath && (
        <path
          d={targetPath}
          fill="none"
          stroke={targetColor}
          strokeWidth="1.5"
          strokeDasharray="5,5"
        />
      )}

      {/* Main line */}
      <path d={mainPath} fill="none" stroke={color} strokeWidth="2.5" />

      {/* Dots */}
      {data.map((d, i) => (
        <circle
          key={i}
          cx={getX(i)}
          cy={getY(d.value)}
          r="3.5"
          fill={color}
          className="transition-all"
        />
      ))}
    </svg>
  );
}
