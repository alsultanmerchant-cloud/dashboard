"use client";

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string;
}

export function DonutChart({
  segments,
  size = 180,
  strokeWidth = 28,
  centerLabel,
  centerValue,
}: DonutChartProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4">
      <svg width={size} height={size} className="transform -rotate-90">
        {segments.map((segment, i) => {
          const percentage = total > 0 ? segment.value / total : 0;
          const dash = circumference * percentage;
          const gap = circumference - dash;
          const currentOffset = offset;
          offset += dash;

          return (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-currentOffset}
              className="transition-all duration-500"
            />
          );
        })}
        {/* Center text */}
        {(centerLabel || centerValue) && (
          <g className="transform rotate-90" style={{ transformOrigin: "center" }}>
            {centerValue && (
              <text
                x={size / 2}
                y={size / 2 - 6}
                textAnchor="middle"
                className="fill-foreground text-xl font-bold"
                style={{ fontSize: "20px" }}
              >
                {centerValue}
              </text>
            )}
            {centerLabel && (
              <text
                x={size / 2}
                y={size / 2 + 14}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: "11px" }}
              >
                {centerLabel}
              </text>
            )}
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {segments.map((segment, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span className="text-muted-foreground">{segment.label}</span>
            <span className="text-foreground font-medium">{segment.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
