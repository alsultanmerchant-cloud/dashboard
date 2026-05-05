import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface StatCardProps {
  value: string;
  label: string;
  color: "cyan" | "green" | "amber" | "red" | "purple" | "blue" | "pink";
  progress?: number;
  icon?: React.ReactNode;
  subtext?: string;
  muted?: boolean;
  tooltip?: string;
  onClick?: () => void;
  active?: boolean;
}

const COLOR_MAP: Record<string, {
  text: string;
  bg: string;
  bar: string;
  border: string;
  glow: string;
}> = {
  cyan: {
    text: "text-cyan",
    bg: "bg-cyan-dim",
    bar: "bg-cyan",
    border: "rgba(0,212,255,0.35)",
    glow: "0 0 18px rgba(0,212,255,0.12)",
  },
  green: {
    text: "text-cc-green",
    bg: "bg-green-dim",
    bar: "bg-cc-green",
    border: "rgba(16,185,129,0.35)",
    glow: "0 0 18px rgba(16,185,129,0.12)",
  },
  amber: {
    text: "text-amber",
    bg: "bg-amber-dim",
    bar: "bg-amber",
    border: "rgba(245,158,11,0.35)",
    glow: "0 0 18px rgba(245,158,11,0.12)",
  },
  red: {
    text: "text-cc-red",
    bg: "bg-red-dim",
    bar: "bg-cc-red",
    border: "rgba(239,68,68,0.35)",
    glow: "0 0 18px rgba(239,68,68,0.12)",
  },
  purple: {
    text: "text-cc-purple",
    bg: "bg-purple-dim",
    bar: "bg-cc-purple",
    border: "rgba(139,92,246,0.35)",
    glow: "0 0 18px rgba(139,92,246,0.12)",
  },
  blue: {
    text: "text-cc-blue",
    bg: "bg-blue-dim",
    bar: "bg-cc-blue",
    border: "rgba(125,166,255,0.35)",
    glow: "0 0 18px rgba(125,166,255,0.12)",
  },
  pink: {
    text: "text-pink",
    bg: "bg-pink/15",
    bar: "bg-pink",
    border: "rgba(236,72,153,0.35)",
    glow: "0 0 18px rgba(236,72,153,0.12)",
  },
};

export function StatCard({ value, label, color, progress, icon, subtext, muted, tooltip, onClick, active }: StatCardProps) {
  const c = COLOR_MAP[color];
  const content = (
    <div
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-2xl p-4 transition-all",
        muted && "opacity-60",
        onClick && "cursor-pointer hover:scale-[1.02]",
        active && "ring-2 ring-offset-1 ring-offset-transparent"
      )}
      style={{
        backgroundColor: "#111827",
        border: `1px solid ${active ? c.border.replace(/0\.35/, "0.8") : c.border}`,
        boxShadow: active ? c.glow.replace(/0\.12/, "0.3") : c.glow,
      }}
    >
      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
          <p className={cn("mt-2 text-3xl font-extrabold tracking-tight", c.text)}>{value}</p>
          {subtext && <p className="text-[11px] text-muted-foreground mt-1.5">{subtext}</p>}
        </div>
        {icon && (
          <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center ring-1 ring-white/8", c.bg)}>
            {icon}
          </div>
        )}
      </div>
      {progress !== undefined && (
        <div className="mt-4 w-full h-1.5 bg-soft-1 rounded-full overflow-hidden relative z-10">
          <div
            className={cn("h-full rounded-full transition-all", c.bar)}
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
    </div>
  );

  if (!tooltip) {
    return content;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<div />}>{content}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
