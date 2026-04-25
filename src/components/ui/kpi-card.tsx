import { cn } from "@/lib/utils";
import { KPI_STATUS_STYLES } from "@/lib/utils/constants";
import { Check, X } from "lucide-react";

interface KPICardProps {
  label: string;
  value: string;
  target: string;
  status: "excellent" | "improving" | "behind";
  icon?: React.ReactNode;
}

const STATUS_COLORS: Record<string, { border: string; glow: string; orb: string; text: string }> = {
  excellent: {
    border: "rgba(16, 185, 129, 0.5)",
    glow: "0 0 20px rgba(16, 185, 129, 0.15), inset 0 1px 0 rgba(16, 185, 129, 0.1)",
    orb: "radial-gradient(circle, rgba(16, 185, 129, 0.25) 0%, rgba(16, 185, 129, 0.08) 40%, transparent 70%)",
    text: "text-cc-green",
  },
  improving: {
    border: "rgba(245, 158, 11, 0.5)",
    glow: "0 0 20px rgba(245, 158, 11, 0.15), inset 0 1px 0 rgba(245, 158, 11, 0.1)",
    orb: "radial-gradient(circle, rgba(245, 158, 11, 0.25) 0%, rgba(245, 158, 11, 0.08) 40%, transparent 70%)",
    text: "text-amber",
  },
  behind: {
    border: "rgba(239, 68, 68, 0.5)",
    glow: "0 0 20px rgba(239, 68, 68, 0.15), inset 0 1px 0 rgba(239, 68, 68, 0.1)",
    orb: "radial-gradient(circle, rgba(239, 68, 68, 0.25) 0%, rgba(239, 68, 68, 0.08) 40%, transparent 70%)",
    text: "text-cc-red",
  },
};

const STATUS_BG = "#111827";

export function KPICard({ label, value, target, status, icon }: KPICardProps) {
  const styles = KPI_STATUS_STYLES[status];
  const colors = STATUS_COLORS[status];
  const StatusIcon = status === "behind" ? X : Check;

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 min-h-[160px] flex flex-col justify-between"
      style={{
        backgroundColor: STATUS_BG,
        border: `1px solid ${colors.border}`,
        boxShadow: colors.glow,
      }}
    >

      {/* Top: Label */}
      <p className="text-xs text-muted-foreground relative z-10">{label}</p>

      {/* Center: Value */}
      <p className={cn("text-3xl font-extrabold relative z-10 my-2", colors.text)}>
        {value}
      </p>

      {/* Bottom: Status + Target */}
      <div className="flex items-center justify-between relative z-10">
        <StatusIcon className={cn("w-5 h-5", colors.text)} />
        <span className="text-[11px] text-muted-foreground">
          الهدف: {target}
        </span>
      </div>
    </div>
  );
}
