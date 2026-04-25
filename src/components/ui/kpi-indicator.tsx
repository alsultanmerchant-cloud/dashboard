import { getKpiStatus, KPI_STATUS_STYLES } from "@/lib/utils/constants";

interface KPIIndicatorProps {
  actual: number;
  target: number;
  inverted?: boolean;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function KPIIndicator({
  actual,
  target,
  inverted = false,
  showLabel = false,
  size = "sm",
}: KPIIndicatorProps) {
  const status = getKpiStatus(actual, target, inverted);
  const styles = KPI_STATUS_STYLES[status];
  const dotSize = size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5";

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`${dotSize} rounded-full ${styles.dot}`} />
      {showLabel && (
        <span className={`text-[10px] font-medium ${styles.text}`}>
          {styles.label}
        </span>
      )}
    </span>
  );
}
