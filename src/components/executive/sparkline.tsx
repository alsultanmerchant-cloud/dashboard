// Pure-SVG sparkline. Server component, no JS, no library.
// Accepts a series of nullable numbers; null = gap (no sample that day).

import { cn } from "@/lib/utils";

interface SparklineProps {
  data: Array<number | null>;
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
  fill?: string;
  // Optional reference band shown as a faint horizontal line (e.g. 85%).
  reference?: number;
}

export function Sparkline({
  data,
  width = 160,
  height = 36,
  className,
  stroke = "currentColor",
  fill,
  reference,
}: SparklineProps) {
  if (!data || data.length === 0) return null;
  const min = 0;
  const max = 100;
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const xAt = (i: number) => pad + (i / Math.max(1, data.length - 1)) * innerW;
  const yAt = (v: number) => pad + innerH - ((v - min) / (max - min)) * innerH;

  // Forward-fill nulls so the line is continuous. For an on-time rate, a day
  // with no deliveries doesn't mean the rate dropped to 0 — it means "no new
  // sample" so the previous value still holds. Leading nulls fall back to the
  // first known value (or 0 if the whole series is null).
  const filled = (() => {
    const arr: number[] = [];
    let last: number | null = null;
    for (const v of data) {
      if (v !== null) last = v;
      arr.push(last ?? 0);
    }
    // Back-fill the head if it started null.
    if (data.length > 0 && data[0] === null) {
      const firstKnown = data.find((v) => v !== null) ?? 0;
      for (let i = 0; i < arr.length; i++) {
        if (data[i] !== null) break;
        arr[i] = firstKnown;
      }
    }
    return arr;
  })();

  const linePoints = filled.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(v)}`);
  const linePath = linePoints.join(" ");
  const areaPath =
    linePath + ` L ${xAt(filled.length - 1)} ${height - pad} L ${xAt(0)} ${height - pad} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block", className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      {reference !== undefined && (
        <line
          x1={pad}
          x2={width - pad}
          y1={yAt(reference)}
          y2={yAt(reference)}
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeDasharray="2 3"
          strokeWidth={1}
        />
      )}
      {fill && (
        <path d={areaPath} fill={fill} fillOpacity={0.18} />
      )}
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Endpoint dot on the most-recent point */}
      {filled.length > 0 && (
        <circle
          cx={xAt(filled.length - 1)}
          cy={yAt(filled[filled.length - 1])}
          r={2}
          fill={stroke}
        />
      )}
    </svg>
  );
}
